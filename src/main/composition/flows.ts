/** Fluxos de tarefa (5A) e alva-flow (5B), sobre as execuções do Claude Code (4A). */
import { mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { AgentError, type AgentsService } from '../agents/agents.service'
import { AlvaFlowsService } from '../alva/alva-flows.service'
import { AlvaService } from '../alva/alva.service'
import { runPrecheck } from '../alva/precheck'
import type { BoardService, StageChange } from '../board/board.service'
import type { BoardStore } from '../board/board.store'
import { buildCatalog } from '../claude/catalog'
import type { ClaudeServiceDeps } from '../claude/claude.service'
import type { OrkioConfig } from '../config/orkio-config'
import { projectById } from '../config/queries'
import {
  FlowError,
  FlowRunner,
  NOOP_ACTION,
  ORKIO_LINES_EXTRACTOR,
  type OrkioAction
} from '../flows/flow-runner'
import { FlowsService } from '../flows/flows.service'
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
}): { runner: FlowRunner; handlers: Pick<Handlers, 'alva' | 'taskFlows'> } {
  const { claude } = deps
  // alva-flow (5B): vínculo com o Backlog.md, extrator e pré-checagem.
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
  const actions = [NOOP_ACTION, ...deps.deliveryActions]
  const runner = new FlowRunner({
    db: deps.boardStore.db,
    store: deps.boardStore,
    flows: (projectId) => deps.configStore.get().flows[projectId] ?? { flows: [], bindings: [] },
    currentStage: (_projectId, taskId) =>
      deps.boardStore.db.get<{ stage_id: string | null }>(
        'SELECT stage_id FROM task_state WHERE task_page_id = ?',
        taskId
      )?.stage_id ?? null,
    prepare: async (projectId, taskId) => {
      const r = await claude.service.flowContext(projectId, taskId)
      if (!r.ok) throw new FlowError(r.error.code, r.error.message)
      return r.value
    },
    startClaude: async (input) => {
      const r = await claude.service.startForFlow(input)
      if (!r.ok) throw new FlowError(r.error.code, r.error.message)
      return r.value
    },
    cancelClaude: (runId) => claude.service.cancel(runId),
    extractors,
    actions,
    worktreePath: (taskId) => claude.worktrees.get(taskId)?.path ?? null,
    initialVars: (projectId, taskId, flow) =>
      flow.tags?.includes('alva') ? alva.initialVars(projectId, taskId) : Promise.resolve({}),
    canStart: (projectId, flow) => alvaFlows.blockReason(projectId, flow),
    agentFor: async (projectId, taskId) => {
      try {
        return await deps.agents.runtimeFor(projectId, taskId)
      } catch (error) {
        if (error instanceof AgentError) throw new FlowError(error.code, error.message)
        throw error
      }
    },
    agentLimit: (agent) => deps.agents.limitProblem(agent),
    concurrencyLimit: (projectId, flow) => alvaFlows.concurrencyLimit(projectId, flow),
    notify: deps.notify,
    emit: (ref) => deps.emit('taskFlowChanged', ref),
    onFinished: (ref) => deps.onFlowFinished(ref.projectId),
    enterStage: deps.enterStage
  })
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
    blockReason: (projectId, flow) => alvaFlows.blockReason(projectId, flow),
    compareUrl: (projectId, taskId) => claude.delivery.compareUrl(projectId, taskId),
    alreadyPushed: (projectId, taskId) => claude.delivery.alreadyPushed(projectId, taskId),
    startBuiltin: (projectId, taskId, flow) => runner.startBuiltin(projectId, taskId, flow)
  }
  return {
    runner,
    handlers: {
      alva: alvaHandlers(alvaFlows),
      taskFlows: taskFlowsHandlers(service, runner, openPrDeps)
    }
  }
}
