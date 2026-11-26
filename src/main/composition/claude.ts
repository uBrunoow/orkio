import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { ArtifactsService, type ArtifactsDeps } from '../claude/artifacts.service'
import { ClaudeService, type ClaudeServiceDeps } from '../claude/claude.service'
import { detectClaude } from '../claude/detect'
import { ClaudeRun } from '../claude/runner'
import type { RunExtras } from '../mcp/run-extras'
import { BRIDGE_MEMORY_TOOL_NAME } from '../claude/bridge/protocol'
import type { AgentMemoryStore } from '../agents/agent-memory.store'
import { prBasesOf } from '../../shared/delivery'
import { memoryPrompt } from '../../shared/agent-memory'
import { RunService } from '../claude/run.service'
import { onPath, terminalCommand, TerminalError } from '../claude/terminal'
import { WorktreeService } from '../claude/worktree.service'
import { HandoffError, HandoffService } from '../claude/handoff.service'
import { TerminalService, type SpawnPty } from '../terminal/terminal.service'
import { ServersService } from '../servers/servers.service'
import { portFree, portOpen } from '../servers/ports'
import { serversPromptNote } from '../../shared/servers'
import { envFileValues, isEnvFile } from '../platform/redact'
import { errorName } from '../errors'
import type * as NodePty from 'node-pty'
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
  /** Fase 2: terminal embutido (PTY no main) e "Continuar no Claude". */
  terminals: TerminalService
  handoff: HandoffService
  /** Servidores da tarefa (frontend, backend…) rodando nos worktrees. */
  servers: ServersService
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
  mergedPrFor: (projectId: string, branch: string) => number | null
  getBlockChildren: ClaudeServiceDeps['getBlockChildren']
  agentFor: ClaudeServiceDeps['agentFor']
  agentInfo: ClaudeServiceDeps['agentInfo']
  /** Fase 3: memória por agente (resumo no prompt e a ferramenta `lembrar`). */
  agentMemory: AgentMemoryStore
  /** Escritas no Notion para publicar artefatos (o token fica no conector). */
  notionInsert: ArtifactsDeps['notion']
  /** O executor de fluxos nasce depois (ele usa o Claude Code). */
  flowRunner: Late<FlowRunner>
  notify: (title: string, body: string, ref: { projectId: string; taskId: string }) => void
  /** Fase 4: servidores MCP, segredos do agente e skills negadas de cada execução. */
  runExtras?: (run: { projectId: string; agentKey: string | null }) => Promise<RunExtras>
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
  // Terminal embutido (Fase 2): o node-pty é nativo; se não carregar, o app segue sem ele.
  const terminals = new TerminalService({
    spawnPty: loadPty(),
    env,
    platform: process.platform,
    isFile,
    isDir: (p) => statSync(p, { throwIfNoEntry: false })?.isDirectory() === true,
    emitData: (event) => deps.emit('terminalData', event),
    emitChanged: (event) => deps.emit('terminalChanged', event),
    // Servidores: o `pnpm dev` e os filhos saem juntos (grupo = pid do PTY, que faz `setsid`).
    ...(process.platform === 'win32'
      ? {}
      : {
          killGroup: (pid: number, signal: 'SIGTERM' | 'SIGKILL') => process.kill(-pid, signal),
          atExit: (fn: () => void) => void process.once('exit', fn)
        })
  })
  const servers = new ServersService({
    defs: (projectId) => deps.configStore.get().servers?.[projectId] ?? [],
    saveDefs: async (projectId, defs) => {
      await deps.configStore.update((c) => {
        const all = { ...(c.servers ?? {}) }
        if (defs.length > 0) all[projectId] = defs
        else delete all[projectId]
        const next: OrkioConfig = { ...c, servers: all }
        if (Object.keys(all).length === 0) delete next.servers
        return next
      })
    },
    workspace: (taskId) => worktrees.get(taskId)?.path ?? null,
    isDir: (p) => statSync(p, { throwIfNoEntry: false })?.isDirectory() === true,
    terminals: {
      get available() {
        return terminals.available
      },
      open: (input) => terminals.open(input),
      close: (id) => terminals.close(id),
      snapshot: (id) => terminals.snapshot(id)
    },
    portFree,
    portOpen: (port) => portOpen(port),
    envSecrets: (dir) => {
      const out: string[] = []
      try {
        for (const name of readdirSync(dir)) {
          if (!isEnvFile(name)) continue
          const path = join(dir, name)
          if ((statSync(path, { throwIfNoEntry: false })?.size ?? 0) > 64 * 1024) continue
          out.push(...envFileValues(readFileSync(path, 'utf8')))
        }
      } catch {
        // Sem acesso: nada a esconder além do `redactSecrets`.
      }
      return out
    },
    event: (ref, e) => {
      deps.boardStore.addEvent({
        taskPageId: ref.taskId,
        projectId: ref.projectId,
        at: new Date().toISOString(),
        ...e
      })
      // O histórico da tarefa relê (o mesmo aviso do "Continuar no Claude").
      deps.emit('taskFlowChanged', ref)
    },
    changed: (ref) => deps.emit('serversChanged', ref)
  })
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
    notify: deps.notify,
    ...(deps.runExtras ? { extras: deps.runExtras } : {}),
    remember: (agentKey, projectId, input) => deps.agentMemory.remember(agentKey, projectId, input),
    serverTool: (ref, action, input, readOnly) => servers.agentTool(ref, action, input, readOnly)
  })
  service.set(
    new ClaudeService({
      deliveryTarget: (projectId, taskId) => {
        const t = delivery.target(projectId, taskId)
        const settings = delivery.settings(projectId)
        const agentsDeliver = settings.agentsDeliver === true
        return {
          target: {
            owner: t.owner,
            repo: t.repo,
            remote: t.remote,
            branch: t.branch,
            defaultBranch: t.defaultBranch,
            displayId: t.displayId,
            // Agentes entregando: as PRs (de qualquer passo) só vão para os destinos do projeto.
            ...(agentsDeliver ? { prBases: prBasesOf(settings) } : {})
          },
          requirePushApproval: settings.requirePushApproval,
          agentsDeliver
        }
      },
      config: deps.configStore,
      worktrees,
      runs,
      git: deps.git,
      listTasks: deps.listTasks,
      signals: deps.signals,
      mergedPrFor: deps.mergedPrFor,
      getBlockChildren: deps.getBlockChildren,
      detect: () => detectClaude({ env }),
      agentFor: deps.agentFor,
      agentInfo: deps.agentInfo,
      agentMemory: async (agentKey, projectId) =>
        memoryPrompt(await deps.agentMemory.summary(agentKey, projectId), BRIDGE_MEMORY_TOOL_NAME),
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
      handoff: (taskId) => handoff.get(taskId),
      terminalsRunning: (taskId) =>
        terminals.hasRunning(taskId, 'shell') || terminals.hasRunning(taskId, 'claude'),
      stopServers: (taskId) => servers.stopTask(taskId),
      serversNote: (projectId, taskId, readOnly) =>
        servers.defs(projectId).length > 0
          ? serversPromptNote(servers.list(projectId, taskId), readOnly)
          : null,
      openEditor: (editor, path) => spawnDetached(editor, [path], { env, windowsHide: true })
    })
  )
  // "Continuar no Claude" (Fase 2): a sessão da tarefa vai para o terminal, travada.
  const handoff = new HandoffService({
    db: deps.boardStore.db,
    lastSession: (taskId) => runs.lastSession(taskId),
    activeRun: (taskId) => service().activeRunId(taskId),
    cancelAndWait: (runId) => service().cancelAndWait(runId),
    flow: {
      activeFor: (taskId) => deps.flowRunner().activeFor(taskId),
      continueStep: (flowRunId, text) => deps.flowRunner().resumeWithReply(flowRunId, text),
      completeStep: (flowRunId) => deps.flowRunner().completeByYou(flowRunId)
    },
    sendMessage: async (projectId, taskId, text) => {
      const r = await service().send({ projectId, taskId, text })
      if (!r.ok) throw new HandoffError(r.error.code, r.error.message)
    },
    worktreePath: (taskId) => worktrees.get(taskId)?.path ?? null,
    terminals,
    event: (ref, e) =>
      deps.boardStore.addEvent({
        taskPageId: ref.taskId,
        projectId: ref.projectId,
        at: new Date().toISOString(),
        ...e
      }),
    // A tela da tarefa, o sino e a visão geral releem (o mesmo aviso de um fluxo que mudou).
    changed: (ref) => deps.emit('taskFlowChanged', ref)
  })
  void mkdir(deps.paths.runTmp, { recursive: true, mode: 0o700 }).catch(() => undefined)
  return { runs, service: service(), worktrees, delivery, terminals, handoff, servers }
}

/** Carrega o node-pty (módulo nativo). Falhou = sem terminal embutido, só o do sistema. */
function loadPty(): SpawnPty | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pty = require('node-pty') as typeof NodePty
    return (file, args, options) => pty.spawn(file, args, options)
  } catch (error) {
    console.error(`[orkio] terminal embutido indisponível: ${errorName(error)}`)
    return null
  }
}

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile()
  } catch {
    return false
  }
}

/** Abre o terminal do sistema na pasta (spawn sem shell; o primeiro terminal achado no PATH). */
async function openTerminalAt(dir: string, env: NodeJS.ProcessEnv): Promise<void> {
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) {
    throw new TerminalError('no_workspace')
  }
  const candidate = terminalCommand(process.platform, env, dir, (cmd) =>
    onPath(cmd, env, process.platform, isFile)
  )
  if (!candidate) throw new TerminalError('no_terminal')
  // Terminais sem argumento de pasta ($TERMINAL, x-terminal-emulator) abrem no cwd.
  await spawnDetached(candidate.cmd, candidate.args, { cwd: dir, env, windowsHide: false })
}
