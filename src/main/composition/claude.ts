/** Claude Code (4A/4B) e entrega (5C): worktrees, execuções, artefatos, terminal e editor. */
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { statSync } from 'node:fs'
import { ArtifactsService, type ArtifactsDeps } from '../claude/artifacts.service'
import { ClaudeService, type ClaudeServiceDeps } from '../claude/claude.service'
import { detectClaude } from '../claude/detect'
import { ClaudeRun } from '../claude/runner'
import { RunService } from '../claude/run.service'
import { onPath, terminalCandidates } from '../claude/terminal'
import { WorktreeService } from '../claude/worktree.service'
import type { OrkioConfig } from '../config/orkio-config'
import type { ConfigStore } from '../storage/config-store'
import { projectById } from '../config/queries'
import type { Db } from '../db/database'
import type { BoardStore } from '../board/board.store'
import { DeliveryService, parseGhAliases } from '../delivery/delivery.service'
import { FlowError, type FlowRunner } from '../flows/flow-runner'
import type { createGit } from '../git/git'
import type { Emit } from '../ipc/emit'
import { execExitCode, spawnDetached } from '../platform/process'
import type { UserDataPaths } from '../platform/paths'
import { late, type Late } from './late'

export interface ClaudeParts {
  runs: RunService
  service: ClaudeService
  worktrees: WorktreeService
  delivery: DeliveryService
}

/** Worktrees por tarefa: existem antes do resto (os sinais leem as branches registradas). */
export function createWorktrees(deps: {
  db: Db
  git: ReturnType<typeof createGit>
  paths: UserDataPaths
}): WorktreeService {
  return new WorktreeService({ git: deps.git, db: deps.db, root: deps.paths.worktrees })
}

export function createClaude(deps: {
  boardStore: BoardStore
  git: ReturnType<typeof createGit>
  configStore: ConfigStore<OrkioConfig>
  paths: UserDataPaths
  env: NodeJS.ProcessEnv
  worktrees: WorktreeService
  listTasks: ClaudeServiceDeps['listTasks']
  signals: ClaudeServiceDeps['signals']
  prFor: (projectId: string, branch: string) => number | null
  getBlockChildren: ClaudeServiceDeps['getBlockChildren']
  agentFor: NonNullable<ClaudeServiceDeps['agentFor']>
  agentInfo: NonNullable<ClaudeServiceDeps['agentInfo']>
  /** Escritas no Notion para publicar artefatos (o token fica no conector). */
  notionInsert: ArtifactsDeps['notion']
  /** O executor de fluxos nasce depois (ele usa o Claude Code). */
  flowRunner: Late<FlowRunner>
  notify: (title: string, body: string, ref: { projectId: string; taskId: string }) => void
  emit: Emit
}): ClaudeParts {
  const { env, worktrees } = deps
  const delivery = new DeliveryService({
    git: deps.git,
    project: (id) => projectById(deps.configStore.get(), id),
    worktree: (taskId) => worktrees.get(taskId),
    settings: (projectId) => deps.configStore.get().delivery[projectId]
  })
  // O RunService avisa o ClaudeService de cada evento, e o ClaudeService usa o RunService.
  const service: Late<ClaudeService> = late('ClaudeService')
  const runs = new RunService({
    db: deps.boardStore.db,
    store: deps.boardStore,
    worktrees,
    git: deps.git,
    runsDir: deps.paths.runs,
    createRun: (options) =>
      new ClaudeRun({
        ...options,
        claudeCommand: 'claude',
        // O servidor MCP de permissões roda no Node do próprio Electron.
        nodePath: process.execPath,
        bridgeScript: join(__dirname, 'permission-mcp.js'),
        tmpDir: deps.paths.runTmp,
        env
      }),
    // Aliases do git/gh e push.default: a política resolve `git p`/`gh m` antes de decidir.
    policyInputs: async (dir) => {
      const [gitAliases, pushDefault, ghAliases] = await Promise.all([
        deps.git.aliases(dir).catch(() => ({})),
        deps.git.configValue(dir, 'push.default'),
        execExitCode('gh', ['alias', 'list'], { cwd: dir, env, timeoutMs: 5_000 }).then(
          (r) => (r.code === 0 ? parseGhAliases(r.stdout) : {}),
          () => ({})
        )
      ])
      return { aliases: { git: gitAliases, gh: ghAliases }, pushDefault }
    },
    currentBranch: (dir) => deps.git.currentBranch(dir),
    prFor: deps.prFor,
    emit: (message) => {
      service().onRunEvent(message.event)
      deps.emit('runEvent', message)
    },
    notify: deps.notify
  })
  service.set(
    new ClaudeService({
      deliveryTarget: (projectId, taskId) => {
        const t = delivery.target(projectId, taskId)
        return {
          target: {
            owner: t.owner,
            repo: t.repo,
            remote: t.remote,
            branch: t.branch,
            defaultBranch: t.defaultBranch,
            displayId: t.displayId
          },
          requirePushApproval: delivery.settings(projectId).requirePushApproval
        }
      },
      config: deps.configStore,
      worktrees,
      runs,
      git: deps.git,
      listTasks: deps.listTasks,
      signals: deps.signals,
      getBlockChildren: deps.getBlockChildren,
      detect: () => detectClaude({ env }),
      agentFor: deps.agentFor,
      agentInfo: deps.agentInfo,
      flowActive: (taskId) => deps.flowRunner().hasActive(taskId),
      flowBusy: (taskId) => deps.flowRunner().isBusy(taskId),
      flowMessage: async (taskId, text, note) => {
        try {
          return { used: (await deps.flowRunner().handleMessage(taskId, text, note)) != null }
        } catch (error) {
          if (error instanceof FlowError) return { error: error.message }
          throw error
        }
      },
      artifacts: new ArtifactsService({
        db: deps.boardStore.db,
        store: deps.boardStore,
        worktrees,
        git: deps.git,
        notion: deps.notionInsert
      }),
      openTerminal: (path) => openTerminalAt(path, env),
      openEditor: (editor, path) => spawnDetached(editor, [path], { env, windowsHide: true })
    })
  )
  void mkdir(deps.paths.runTmp, { recursive: true, mode: 0o700 }).catch(() => undefined)
  return { runs, service: service(), worktrees, delivery }
}

/** Abre o terminal do sistema na pasta (spawn sem shell; o primeiro terminal achado no PATH). */
async function openTerminalAt(dir: string, env: NodeJS.ProcessEnv): Promise<void> {
  const isFile = (p: string): boolean => {
    try {
      return statSync(p).isFile()
    } catch {
      return false
    }
  }
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error('no_workspace')
  }
  const candidate = terminalCandidates(process.platform, env, dir).find((c) =>
    process.platform === 'darwin' ? true : onPath(c.cmd, env, process.platform, isFile)
  )
  if (!candidate) throw new Error('no_terminal')
  // Terminais sem argumento de pasta ($TERMINAL, x-terminal-emulator) abrem no cwd.
  await spawnDetached(candidate.cmd, candidate.args, { cwd: dir, env, windowsHide: false })
}
