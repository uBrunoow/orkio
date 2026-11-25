import { mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { AgentError, type AgentsService } from '../agents/agents.service'
import { AlvaFlowsService } from '../alva/alva-flows.service'
import { createAlvaIntegration } from '../alva/alva-integration'
import { AlvaService } from '../alva/alva.service'
import { hasComposeFile, runPrecheck } from '../alva/precheck'
import type { BoardService, StageChange } from '../board/board.service'
import type { BoardStore } from '../board/board.store'
import { buildCatalog } from '../claude/catalog'
import type { ClaudeServiceDeps } from '../claude/claude.service'
import type { OrkioConfig } from '../config/orkio-config'
import { projectById, projectFlows } from '../config/queries'
import {
  FlowError,
  FlowRunner,
  NOOP_ACTION,
  type FlowRunnerDeps,
  ORKIO_LINES_EXTRACTOR,
  type OrkioAction
} from '../flows/flow-runner'
import { FlowsService } from '../flows/flows.service'
import { createMoveDoneAction, PrWakeService, WAIT_PR_ACTION } from '../flows/pr-wake'
import type { PrWatch } from '../../shared/pr-wake'
import { isScratchPath } from '../../shared/orkio-scratch'
import type { Git } from '../git/git'
import type { OpenPrDeps } from '../flows/open-pr'
import { alvaHandlers } from '../ipc/alva.ipc'
import type { Emit } from '../ipc/emit'
import type { Handlers } from '../ipc/register'
import { taskFlowsHandlers } from '../ipc/task-flows.ipc'
import { execExitCode } from '../platform/process'
import type { UserDataPaths } from '../platform/paths'
import type { ConfigStore } from '../storage/config-store'
import type { ClaudeParts } from './claude'

export function createFlows(deps: {
  boardStore: BoardStore
  configStore: ConfigStore<OrkioConfig>
  paths: UserDataPaths
  env: NodeJS.ProcessEnv
  board: BoardService
  claude: ClaudeParts
  agents: AgentsService
  listTasks: ClaudeServiceDeps['listTasks']
  deliveryActions: OrkioAction[]
  actor: () => string
  emit: Emit
  notify: (title: string, body: string, ref: { projectId: string; taskId: string }) => void
  onFlowFinished: (projectId: string) => void
  enterStage: (change: StageChange) => void
  /** Fase 1: "Como deve rodar?" (fluxo nativo da tarefa e o revisor). */
  nativePlan: NonNullable<FlowRunnerDeps['nativePlan']>
  /** Texto final de uma execução (o fix recebe a revisão). */
  lastResult: NonNullable<FlowRunnerDeps['lastResult']>
  /** Fase 5: foto da PR da tarefa (sinais em cache). */
  prWatch(projectId: string, taskId: string): PrWatch | null
  /** Fase 5: segurar a automação pelo uso do Claude. */
  usageHold: NonNullable<FlowRunnerDeps['usageHold']>
  git: Pick<Git, 'headCommit' | 'statusPorcelain'>
}): {
  runner: FlowRunner
  prWake: PrWakeService
  handlers: Pick<Handlers, 'alva' | 'taskFlows'>
} {
  const { claude } = deps
  const neutralDir = deps.paths.alvaCheck
  void mkdir(neutralDir, { recursive: true }).catch(() => undefined)
  const alva = new AlvaService({
    db: deps.boardStore.db,
    worktreePath: (taskId) => claude.worktrees.get(taskId)?.path ?? null,
    projectDir: (projectId) => projectById(deps.configStore.get(), projectId)?.localPath ?? null,
    taskInfo: async (projectId, taskId) => {
      const r = await deps.listTasks(projectId)
      const t = r.ok ? r.value.tasks.find((x) => x.id === taskId) : undefined
      return t?.displayId ? { displayId: t.displayId, title: t.title, url: t.url } : null
    }
  })
  const alvaFlows = new AlvaFlowsService({
    config: deps.configStore,
    store: deps.boardStore,
    board: deps.board,
    alva,
    actor: deps.actor,
    usesDocker: hasComposeFile,
    precheck: async (dir) => {
      const catalog = await buildCatalog({ projectDir: dir, home: homedir() })
      return runPrecheck(
        dir,
        catalog.flatMap((g) => g.commands.map((c) => c.name)),
        {
          neutralDir,
          // Comando ausente → rejeita; código ≠ 0 → resolve com o código (só ele importa).
          exec: (command, args, options) =>
            execExitCode(command, args, {
              cwd: options.cwd,
              env: deps.env,
              timeoutMs: options.timeoutMs,
              maxBuffer: 1024 * 1024
            })
        }
      )
    }
  })

  const extractors = [ORKIO_LINES_EXTRACTOR, alva.extractor]
  const actions = [
    NOOP_ACTION,
    ...deps.deliveryActions,
    WAIT_PR_ACTION,
    createMoveDoneAction({
      store: deps.boardStore,
      board: deps.board,
      stages: (projectId) => deps.configStore.get().boards[projectId]?.stages ?? []
    })
  ]
  const runner = new FlowRunner({
    db: deps.boardStore.db,
    store: deps.boardStore,
    flows: (projectId) => projectFlows(deps.configStore.get(), projectId),
    currentStage: (_projectId, taskId) => deps.boardStore.state(taskId)?.stageId ?? null,
    prepare: async (projectId, taskId) => {
      const r = await claude.service.flowContext(projectId, taskId)
      if (!r.ok) throw new FlowError(r.error.code, r.error.message)
      return r.value
    },
    startClaude: async (request) => {
      const r = await claude.service.startRun(request)
      if (!r.ok) throw new FlowError(r.error.code, r.error.message)
      return r.value
    },
    cancelClaude: (runId) => claude.runs.cancel(runId),
    extractors,
    actions,
    worktreePath: (taskId) => claude.worktrees.get(taskId)?.path ?? null,
    integrations: [createAlvaIntegration({ alva, flows: alvaFlows })],
    agentFor: async (projectId, taskId) => {
      try {
        return await deps.agents.runtimeFor(projectId, taskId)
      } catch (error) {
        if (error instanceof AgentError) throw new FlowError(error.code, error.message)
        throw error
      }
    },
    agentLimit: (agent) => deps.agents.limitProblem(agent),
    notify: deps.notify,
    emit: (ref) => deps.emit('taskFlowChanged', ref),
    onFinished: (ref) => deps.onFlowFinished(ref.projectId),
    enterStage: deps.enterStage,
    nativePlan: deps.nativePlan,
    lastResult: deps.lastResult,
    prWatch: deps.prWatch,
    usageHold: deps.usageHold,
    // "Parou sem entregar": o topo e o que falta commitar no worktree (sem a pasta `.orkio/`).
    workState: async (taskId) => {
      const path = claude.worktrees.get(taskId)?.path
      if (!path) return null
      const [head, status] = await Promise.all([
        deps.git.headCommit(path).catch(() => null),
        deps.git.statusPorcelain(path)
      ])
      const dirty = status.some((line) => !isScratchPath(line.slice(3).replace(/^"|"$/g, '')))
      return { head, dirty }
    }
  })
  const prWake = new PrWakeService({ runner, prWatch: deps.prWatch })
  claude.runs.onFinished((info) => runner.onRunFinished(info))
  const service = new FlowsService({
    config: deps.configStore,
    store: deps.boardStore,
    runner,
    extractors,
    actions,
    actor: deps.actor
  })
  const openPrDeps: OpenPrDeps = {
    linked: (taskId) => alva.getLink(taskId) !== null,
    alvaReady: async (projectId) => (await alvaFlows.blockReason(projectId)) === null,
    compareUrl: (projectId, taskId) => claude.delivery.compareUrl(projectId, taskId),
    alreadyPushed: (projectId, taskId) => claude.delivery.alreadyPushed(projectId, taskId),
    startBuiltin: (projectId, taskId, flow) => runner.startBuiltin(projectId, taskId, flow)
  }
  return {
    runner,
    prWake,
    handlers: {
      alva: alvaHandlers(alvaFlows),
      taskFlows: taskFlowsHandlers(service, runner, openPrDeps)
    }
  }
}
