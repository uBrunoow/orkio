/**
 * O IPC do Orkio declarado uma vez: cada método de `window.orkio` com o canal, a validação de cada
 * argumento (o main confere tudo, `unknown`), o fallback de erro inesperado e o que precisa no main
 * (`needs`); cada evento main → renderer com o canal, a validação do payload e o efeito no main.
 * O preload gera `window.orkio` daqui (`buildApi`); o main registra os handlers daqui
 * (`main/ipc/register.ts`); o tipo `OrkioApi` sai daqui. Tipos de domínio moram nos módulos do
 * assunto em `shared/`. Sem Node nem DOM.
 */
import type {
  AgentBadge,
  AgentKey,
  AgentProfile,
  AgentScope,
  AgentsState,
  ProjectAgents
} from '../agent'
import {
  ARTIFACT_PUBLISH_MODES,
  CLAUDE_MIN_VERSION,
  EDITOR_IDS,
  MESSAGE_MAX,
  PERMISSION_ANSWERS,
  type ArtifactCandidate,
  type ArtifactPublishMode,
  type ArtifactView,
  type CatalogGroup,
  type ClaudeCodeStatus,
  type ClaudeDiff,
  type EditorId,
  type PermissionAnswer,
  type RunEventMessage,
  type RunLogEvent,
  type RunPreparation,
  type SendMessageRequest,
  type StartRunRequest,
  type TaskBranchesView,
  type TaskRunsState
} from '../agent-run'
import type { AlvaPrecheck, AlvaStatusView, BacklogTaskDocument, BacklogTaskInfo } from '../alva'
import type { AutomationStatus } from '../automation'
import type {
  BoardCard,
  BoardHistoryEntry,
  BoardSaveInput,
  BoardSyncEvent,
  BoardView
} from '../board'
import type {
  AuthOptions,
  ConnectionStatus,
  ConnectorCredentials,
  DeviceFlowStartResult
} from '../connection'
import type { DeliverySettings } from '../delivery'
import type { ConfigEvent, FlowDraft, FlowFileResult } from '../flow'
import { isRecord } from '../guards'
import type {
  NotionDataSourceList,
  NotionProjectChoice,
  NotionTaskSearchResult,
  NotionTasksResult,
  NotionTasksSchemaInfo,
  NotionWorkspaceInput,
  NotionWorkspaceStatus
} from '../notion'
import type { OrchestratorConfig, OrchestratorState } from '../orchestrator'
import type { OrkioBotStatus } from '../orkio-bot'
import {
  TASK_SECTIONS,
  type ActivityPage,
  type ActivityQuery,
  type BoardTaskRef,
  type OverviewSnapshot
} from '../overview'
import type {
  BranchChangedEvent,
  CreateProjectInput,
  PickFolderResult,
  ProjectMutationResult,
  ProjectsListResult
} from '../projects'
import type { Result } from '../result'
import type { ReviewThreadsResult } from '../review'
import type {
  Flow,
  FlowRunView,
  OpenPrResult,
  TaskFlowActivity,
  TaskFlowsProject
} from '../task-flow'
import type { TaskSignalsResult } from '../task-signals'
import {
  UPDATE_CHANNELS,
  UPDATE_INSTALL_MODES,
  type AboutInfo,
  type ReleaseNotes,
  type UpdateChannel,
  type UpdateInstallMode,
  type UpdateInstallResult,
  type UpdateStatus
} from '../updates'
import { INVALID, call, event, group, sameAs, type ApiOf, type Parser } from './define'
import {
  isProfileHash,
  isRepoPath,
  isRequestId,
  parseActivityQuery,
  parseAgentRules,
  parseAgentSaveInput,
  parseAlvaBindings,
  parseAnswers,
  parseBoardSaveInput,
  parseCreateProjectInput,
  parseDataSourceQuery,
  parseDeliverySettings,
  parseFlowDraft,
  parseFlows,
  parseGateValues,
  parseOrchestratorConfig,
  parseSendMessageRequest,
  parseStartRunRequest,
  parseWorkspaceInput
} from './payloads'
import {
  agentKey,
  bool,
  finiteNumber,
  forceOption,
  guard,
  isNotionPropertyId,
  isTokenCredentials,
  localId,
  notionId,
  nullable,
  oneOf,
  projectId,
  stageId,
  taskId,
  text,
  type ForceOption
} from './validate'

const projectRef: Parser<{ projectId: string }> = (v) =>
  isRecord(v) && typeof v['projectId'] === 'string' ? { projectId: v['projectId'] } : INVALID

const taskRef: Parser<{ projectId: string; taskId: string }> = (v) =>
  isRecord(v) && typeof v['projectId'] === 'string' && typeof v['taskId'] === 'string'
    ? { projectId: v['projectId'], taskId: v['taskId'] }
    : INVALID

const optionalString = (v: unknown): v is string | undefined =>
  v === undefined || typeof v === 'string'

/** Eventos que o main manda ao renderer (`emit` no main, `on*` em `window.orkio`). */
export const IPC_EVENTS = {
  /** A conta do Notion conectou, desconectou ou foi conferida (o renderer relê o que depende dela). */
  notionChanged: event<Record<string, never>>({ channel: 'notion:changed', parse: () => ({}) }),
  githubChanged: event<Record<string, never>>({ channel: 'github:changed', parse: () => ({}) }),
  branchChanged: event<BranchChangedEvent>({
    channel: 'projects:branch-changed',
    parse: (v) =>
      isRecord(v) &&
      typeof v['projectId'] === 'string' &&
      (v['branch'] === null || typeof v['branch'] === 'string')
        ? { projectId: v['projectId'], branch: v['branch'] }
        : INVALID
  }),
  /** O quadro do projeto mudou (automação, orquestrador). */
  boardChanged: event({
    channel: 'board:changed',
    parse: projectRef,
    affects: ['overview', 'keepAwake']
  }),
  /** Abrir uma tarefa (clique na notificação). */
  openTask: event<BoardTaskRef>({
    channel: 'board:open-task',
    parse: (v) => {
      const ref = taskRef(v)
      if (ref === INVALID) return INVALID
      const section = TASK_SECTIONS.find((x) => isRecord(v) && x === v['section'])
      return section ? { ...ref, section } : ref
    }
  }),
  boardSync: event<BoardSyncEvent>({
    channel: 'board:sync-changed',
    parse: (v) => {
      const ref = taskRef(v)
      if (ref === INVALID || !isRecord(v)) return INVALID
      const { state, stageId, blocked, message, canReconnect } = v
      if (
        (state !== 'synced' && state !== 'pending' && state !== 'failed') ||
        !(stageId === null || typeof stageId === 'string') ||
        typeof blocked !== 'boolean' ||
        !optionalString(message) ||
        !(canReconnect === undefined || typeof canReconnect === 'boolean')
      ) {
        return INVALID
      }
      return {
        ...ref,
        state,
        stageId,
        blocked,
        ...(message !== undefined ? { message } : {}),
        ...(canReconnect !== undefined ? { canReconnect } : {})
      }
    },
    affects: ['overview']
  }),
  /** Agentes ou atribuições de um projeto mudaram. */
  agentsChanged: event({ channel: 'agents:changed', parse: projectRef }),
  taskFlowChanged: event({
    channel: 'task-flows:changed',
    parse: taskRef,
    affects: ['overview', 'keepAwake']
  }),
  /** Evento normalizado de uma execução do Claude Code. */
  runEvent: event<RunEventMessage>({
    channel: 'claude:run-event',
    parse: (v) =>
      isRecord(v) &&
      typeof v['runId'] === 'string' &&
      typeof v['projectId'] === 'string' &&
      typeof v['taskId'] === 'string' &&
      isRecord(v['event']) &&
      typeof v['event']['kind'] === 'string'
        ? (v as unknown as RunEventMessage)
        : INVALID,
    affects: ['overview', 'keepAwake'],
    // Texto do log não muda "Esperando você" nem "Em execução".
    affectsWhen: (m) =>
      m.event.kind === 'status' || m.event.kind === 'permission' || m.event.kind === 'question'
  }),
  updateStatus: event<UpdateStatus>({
    channel: 'updates:status-changed',
    parse: (v) =>
      isRecord(v) && typeof v['mode'] === 'string' && typeof v['phase'] === 'string'
        ? (v as unknown as UpdateStatus)
        : INVALID
  }),
  /** Algo relevante mudou, com o total de "Esperando você". */
  overviewChanged: event<{ waiting: number }>({
    channel: 'overview:changed',
    parse: (v) => {
      const waiting = isRecord(v) ? v['waiting'] : undefined
      return typeof waiting === 'number' && Number.isSafeInteger(waiting) && waiting >= 0
        ? { waiting }
        : INVALID
    }
  })
} as const

export type IpcEvents = typeof IPC_EVENTS
export type IpcEventName = keyof IpcEvents
export type IpcEventPayload<K extends IpcEventName> = IpcEvents[K] extends {
  parse: Parser<infer T>
}
  ? T
  : never

// Validadores com argumento ficam fora da declaração (a inferência da tupla `args` pede nomes).
const anything: Parser<unknown> = (v) => v
const notionPropertyId = guard(isNotionPropertyId)
const profileHash = guard(isProfileHash)
const agentKeyOrNull = nullable(agentKey)
const leftChoice = oneOf(['cancel', 'continue'])
const requestId = guard(isRequestId)
const permissionAnswer = oneOf(PERMISSION_ANSWERS)
const editorId = oneOf(EDITOR_IDS)
const repoPath = guard(isRepoPath)
const localIdOrNull = nullable(localId)
const taskIdOrNull = nullable(taskId)
const publishMode = oneOf(ARTIFACT_PUBLISH_MODES)
const updateChannel = oneOf(UPDATE_CHANNELS)
const installMode = oneOf(UPDATE_INSTALL_MODES)
const searchQuery = text(200)
const stepId = text(100, 1)
const messageText = text(MESSAGE_MAX)
const choiceValue = text(200)
const branchName = text(250)
const url = text(2048)
const tokenCredentials: Parser<ConnectorCredentials> = (v) =>
  isTokenCredentials(v) ? { kind: 'token', token: v.token } : INVALID

const notionError: ConnectionStatus = {
  state: 'error',
  message: 'Algo deu errado na integração com o Notion. Tente novamente.'
}
const githubError: ConnectionStatus = {
  state: 'error',
  message: 'Algo deu errado na integração com o GitHub. Tente novamente.'
}
const projectsError = {
  code: 'git_error' as const,
  message: 'Algo deu errado com os projetos. Tente novamente.'
}
const projectsListFallback: ProjectsListResult = {
  projects: [],
  warning: 'Não foi possível carregar os projetos.'
}
const projectMutationFallback: ProjectMutationResult = {
  ok: false,
  cancelled: false,
  error: projectsError
}
const workspaceStatusFallback: NotionWorkspaceStatus = {
  config: null,
  health: 'unverified',
  messages: ['Não foi possível carregar a configuração do Notion.'],
  connection: null
}
const automationFallback: AutomationStatus = {
  paused: false,
  github: 'unknown',
  lastRunAt: null,
  nextRunAt: null,
  error: 'Não foi possível consultar as automações.'
}
const claudeUnknownStatus: ClaudeCodeStatus = {
  installed: false,
  version: null,
  loggedIn: null,
  authMethod: null,
  meetsMinimum: false,
  minimumVersion: CLAUDE_MIN_VERSION,
  supportsEffort: false
}

type FlowRunResult = Promise<Result<FlowRunView>>

export const ORKIO_API = {
  notion: group(
    { needs: 'none', unexpected: notionError.message ?? '' },
    {
      getStatus: call<() => Promise<ConnectionStatus>>()({
        channel: 'notion:get-status',
        args: [],
        fallback: notionError
      }),
      connect: call<(credentials: ConnectorCredentials) => Promise<ConnectionStatus>>()({
        channel: 'notion:connect',
        args: [tokenCredentials],
        fallback: notionError,
        invalid: { state: 'error', message: 'Cole o token do Notion para conectar.' }
      }),
      disconnect: call<() => Promise<ConnectionStatus>>()({
        channel: 'notion:disconnect',
        args: [],
        fallback: notionError
      }),
      testConnection: call<() => Promise<ConnectionStatus>>()({
        channel: 'notion:test-connection',
        args: [],
        fallback: notionError
      }),
      getAuthOptions: call<() => Promise<AuthOptions>>()({
        channel: 'notion:get-auth-options',
        args: [],
        fallback: { oauth: false }
      }),
      /**
       * Abre o Notion no navegador para o usuário autorizar o Orkio.
       * Resolve quando o fluxo termina (conectado, erro ou cancelado — neste caso, o status salvo).
       */
      startOAuth: call<() => Promise<ConnectionStatus>>()({
        channel: 'notion:oauth-start',
        args: [],
        fallback: notionError
      }),
      cancelOAuth: call<() => Promise<void>>()({
        channel: 'notion:oauth-cancel',
        args: [],
        fallback: undefined
      }),
      onChanged: IPC_EVENTS.notionChanged
    }
  ),
  github: group(
    { needs: 'none', unexpected: githubError.message ?? '' },
    {
      getStatus: call<() => Promise<ConnectionStatus>>()({
        channel: 'github:get-status',
        args: [],
        fallback: githubError
      }),
      connect: call<(credentials: ConnectorCredentials) => Promise<ConnectionStatus>>()({
        channel: 'github:connect',
        args: [tokenCredentials],
        fallback: githubError,
        invalid: { state: 'error', message: 'Cole o token do GitHub para conectar.' }
      }),
      disconnect: call<() => Promise<ConnectionStatus>>()({
        channel: 'github:disconnect',
        args: [],
        fallback: githubError
      }),
      testConnection: call<() => Promise<ConnectionStatus>>()({
        channel: 'github:test-connection',
        args: [],
        fallback: githubError
      }),
      getAuthOptions: call<() => Promise<AuthOptions>>()({
        channel: 'github:get-auth-options',
        args: [],
        fallback: { oauth: false }
      }),
      /**
       * Pede um código ao GitHub e começa a aguardar a autorização (no main).
       * Se já houver um fluxo em andamento, devolve o mesmo código.
       */
      startDeviceFlow: call<() => Promise<DeviceFlowStartResult>>()({
        channel: 'github:device-flow-start',
        args: [],
        fallback: { ok: false, status: githubError }
      }),
      /** Resolve quando o fluxo termina: conectado, erro ou cancelado (status salvo). */
      waitDeviceFlow: call<() => Promise<ConnectionStatus>>()({
        channel: 'github:device-flow-wait',
        args: [],
        fallback: githubError
      }),
      cancelDeviceFlow: call<() => Promise<void>>()({
        channel: 'github:device-flow-cancel',
        args: [],
        fallback: undefined
      }),
      /** O orkio[bot] (GitHub App) está instalado nos repositórios dos projetos? Só leitura. */
      orkioBot: call<(options?: ForceOption) => Promise<OrkioBotStatus>>()({
        channel: 'github:orkio-bot',
        args: [forceOption],
        fallback: { github: 'connected', repos: [], checkedAt: null }
      }),
      onChanged: IPC_EVENTS.githubChanged
    }
  ),
  /** Bancos do Notion (Projetos/Tarefas), vínculo com projetos locais e tarefas (só leitura). */
  notionWorkspace: group(
    {
      needs: 'config',
      unexpected: 'Algo deu errado ao falar com o Notion. Tente novamente.'
    },
    {
      /** Estado da configuração; na primeira chamada revalida o schema no Notion. */
      getStatus: call<() => Promise<NotionWorkspaceStatus>>()({
        channel: 'notion-workspace:get-status',
        args: [],
        fallback: workspaceStatusFallback
      }),
      revalidate: call<() => Promise<NotionWorkspaceStatus>>()({
        channel: 'notion-workspace:revalidate',
        args: [],
        fallback: workspaceStatusFallback
      }),
      listDataSources: call<(query?: string) => Promise<Result<NotionDataSourceList>>>()({
        channel: 'notion-workspace:list-data-sources',
        args: [parseDataSourceQuery]
      }),
      getTasksSchema: call<
        (
          tasksDataSourceId: string,
          projectsDataSourceId: string
        ) => Promise<Result<NotionTasksSchemaInfo>>
      >()({
        channel: 'notion-workspace:get-tasks-schema',
        args: [notionId, notionId]
      }),
      save: call<(input: NotionWorkspaceInput) => Promise<Result<NotionWorkspaceStatus>>>()({
        channel: 'notion-workspace:save',
        args: [parseWorkspaceInput]
      }),
      listProjectChoices: call<
        (
          projectId: string,
          options?: ForceOption
        ) => Promise<Result<{ choices: NotionProjectChoice[]; truncated: boolean }>>
      >()({
        channel: 'notion-workspace:list-project-choices',
        args: [projectId, forceOption]
      }),
      link: call<
        (projectId: string, pageId: string) => Promise<Result<{ id: string; name: string }>>
      >()({
        channel: 'notion-workspace:link',
        args: [projectId, notionId]
      }),
      unlink: call<(projectId: string) => Promise<Result<null>>>()({
        channel: 'notion-workspace:unlink',
        args: [projectId]
      }),
      listTasks: call<
        (projectId: string, options?: ForceOption) => Promise<Result<NotionTasksResult>>
      >()({
        channel: 'notion-workspace:list-tasks',
        args: [projectId, forceOption]
      }),
      /**
       * Busca no banco de Tarefas inteiro (qualquer responsável, qualquer projeto) por título ou ID.
       * Texto vazio = as editadas mais recentemente.
       */
      searchTasks: call<(query: string) => Promise<Result<NotionTaskSearchResult>>>()({
        channel: 'notion-workspace:search-tasks',
        args: [searchQuery]
      })
    }
  ),
  /** O renderer nunca manda caminhos: só ids de projeto e o `selectionId` emitido pelo main. */
  projects: group(
    { needs: 'config', unexpected: projectsError.message },
    {
      /** Lista rápida (só checagens locais). */
      list: call<() => Promise<ProjectsListResult>>()({
        channel: 'projects:list',
        args: [],
        fallback: projectsListFallback
      }),
      /** Lista revalidando cada projeto também no GitHub. */
      revalidate: call<() => Promise<ProjectsListResult>>()({
        channel: 'projects:revalidate',
        args: [],
        fallback: projectsListFallback
      }),
      /** Abre o seletor de pasta (no main) e analisa o repositório. */
      pickFolder: call<() => Promise<PickFolderResult>>()({
        channel: 'projects:pick-folder',
        args: [],
        fallback: { ok: false, cancelled: false, error: projectsError }
      }),
      create: call<(input: CreateProjectInput) => Promise<ProjectMutationResult>>()({
        channel: 'projects:create',
        args: [parseCreateProjectInput],
        fallback: projectMutationFallback,
        invalid: {
          ok: false,
          cancelled: false,
          error: { code: 'project_not_found', message: 'Dados inválidos para criar o projeto.' }
        }
      }),
      /** Abre o seletor de pasta para apontar o projeto para outra pasta do mesmo repositório. */
      relocate: call<(projectId: string) => Promise<ProjectMutationResult>>()({
        channel: 'projects:relocate',
        args: [projectId],
        fallback: projectMutationFallback,
        invalid: {
          ok: false,
          cancelled: false,
          error: { code: 'project_not_found', message: 'Projeto inválido.' }
        }
      }),
      /** Só remove do Orkio; nunca apaga arquivos. */
      remove: call<(projectId: string) => Promise<{ ok: boolean }>>()({
        channel: 'projects:remove',
        args: [projectId],
        fallback: { ok: false }
      }),
      /** Mudanças de branch (só id do projeto e branch atual). */
      onBranchChanged: IPC_EVENTS.branchChanged
    }
  ),
  /** Branches e PRs ligadas às tarefas de um projeto pelo ID (só leitura). */
  signals: group(
    {
      needs: 'config',
      unexpected: 'Algo deu errado ao ler branches e PRs. Tente novamente.'
    },
    {
      get: call<(projectId: string, options?: ForceOption) => Promise<Result<TaskSignalsResult>>>()(
        {
          channel: 'signals:get',
          args: [projectId, forceOption]
        }
      ),
      /** Threads de review da PR da tarefa (o main acha a PR pelos sinais e lê o texto). */
      reviewThreads: call<
        (
          projectId: string,
          taskId: string,
          options?: ForceOption
        ) => Promise<Result<ReviewThreadsResult>>
      >()({
        channel: 'signals:review-threads',
        args: [projectId, taskId, forceOption]
      })
    }
  ),
  /** Quadro kanban por projeto (Etapa 3A). */
  board: group(
    { needs: 'db', unexpected: 'Algo deu errado no quadro. Tente novamente.' },
    {
      get: call<(projectId: string, options?: ForceOption) => Promise<Result<BoardView>>>()({
        channel: 'board:get',
        args: [projectId, forceOption]
      }),
      save: call<(projectId: string, input: BoardSaveInput) => Promise<Result<BoardView>>>()({
        channel: 'board:save',
        args: [projectId, parseBoardSaveInput]
      }),
      move: call<
        (projectId: string, taskId: string, stageId: string) => Promise<Result<BoardCard>>
      >()({
        channel: 'board:move',
        args: [projectId, taskId, stageId]
      }),
      setBlocked: call<
        (projectId: string, taskId: string, blocked: boolean) => Promise<Result<BoardCard>>
      >()({
        channel: 'board:set-blocked',
        args: [projectId, taskId, bool]
      }),
      history: call<(projectId: string, taskId: string) => Promise<Result<BoardHistoryEntry[]>>>()({
        channel: 'board:history',
        args: [projectId, taskId]
      }),
      /** Tenta agora as escritas pendentes. */
      retryNow: call<() => Promise<void>>()({
        channel: 'board:retry-now',
        args: [],
        fallback: undefined
      }),
      setAutomationPaused: call<
        (projectId: string, taskId: string, paused: boolean) => Promise<Result<BoardCard>>
      >()({
        channel: 'board:set-automation-paused',
        args: [projectId, taskId, bool]
      }),
      /** O quadro mudou por automação (recarregar). */
      onChanged: IPC_EVENTS.boardChanged,
      /** Pedido para abrir uma tarefa (clique na notificação). */
      onOpenTask: IPC_EVENTS.openTask,
      onSyncChanged: IPC_EVENTS.boardSync
    }
  ),
  /** Editor do fluxo (3C): etapas + automações. */
  flow: group(
    { needs: 'db', unexpected: 'Algo deu errado ao salvar o fluxo. Tente novamente.' },
    {
      /** Valida de novo no main e salva; tarefas de etapas removidas vão para o destino escolhido. */
      save: call<(projectId: string, draft: FlowDraft) => Promise<Result<BoardView>>>()({
        channel: 'flow:save',
        args: [projectId, parseFlowDraft]
      }),
      events: call<(projectId: string) => Promise<ConfigEvent[]>>()({
        channel: 'flow:events',
        args: [projectId],
        fallback: []
      }),
      /** Abre "Salvar como…" no main e grava o JSON (o renderer nunca escolhe caminhos). */
      exportFile: call<(content: unknown) => Promise<FlowFileResult>>()({
        channel: 'flow:export-file',
        args: [anything],
        fallback: { ok: false, cancelled: false, message: 'Não foi possível exportar o fluxo.' }
      }),
      /** Abre o seletor no main e devolve o JSON lido (validação no renderer, função pura). */
      importFile: call<() => Promise<FlowFileResult>>()({
        channel: 'flow:import-file',
        args: [],
        fallback: { ok: false, cancelled: false, message: 'Não foi possível ler o arquivo.' }
      })
    }
  ),
  /** Motor de automações (3B). */
  automation: group(
    { needs: 'db', unexpected: automationFallback.error ?? '' },
    {
      status: call<(projectId: string) => Promise<AutomationStatus>>()({
        channel: 'automation:status',
        args: [projectId],
        fallback: automationFallback
      }),
      /** Verifica agora (git + GitHub) e devolve o novo estado. */
      runNow: call<(projectId: string) => Promise<AutomationStatus>>()({
        channel: 'automation:run-now',
        args: [projectId],
        fallback: automationFallback
      }),
      /** "Pausar todas" / "Retomar" (vale para todos); devolve o estado do projeto da tela. */
      setPaused: call<(projectId: string, paused: boolean) => Promise<AutomationStatus>>()({
        channel: 'automation:set-paused',
        args: [projectId, bool],
        fallback: automationFallback
      })
    }
  ),
  /** Integração com o plugin alva-flow (5B). */
  alva: group(
    { needs: 'db', unexpected: 'Algo deu errado. Tente novamente.' },
    {
      /** "Pronto para o alva-flow?" (`force` verifica de novo). */
      precheck: call<(projectId: string, options?: ForceOption) => Promise<Result<AlvaPrecheck>>>()(
        {
          channel: 'alva:precheck',
          args: [projectId, forceOption]
        }
      ),
      status: call<(projectId: string) => Promise<Result<AlvaStatusView>>>()({
        channel: 'alva:status',
        args: [projectId]
      }),
      /** Cria os templates "Fluxo Alva" e liga nas colunas escolhidas (ao entrar). */
      createTemplates: call<
        (
          projectId: string,
          bindings: {
            plan: string | null
            deliver: string | null
            review: string | null
            reviewed: string | null
          }
        ) => Promise<Result<AlvaStatusView>>
      >()({
        channel: 'alva:create-templates',
        args: [projectId, parseAlvaBindings]
      }),
      /** Coluna "Planejando" (entre Prioridades e Em andamento) com o status do Notion escolhido. */
      addPlanningStage: call<
        (projectId: string, notionStatusId: string) => Promise<Result<string>>
      >()({
        channel: 'alva:add-planning-stage',
        args: [projectId, notionPropertyId]
      }),
      setMaxParallel: call<(projectId: string, value: number) => Promise<Result<AlvaStatusView>>>()(
        {
          channel: 'alva:set-max-parallel',
          args: [projectId, finiteNumber]
        }
      ),
      /** Task do Backlog.md vinculada (id, título, status, critérios). */
      taskSummary: call<
        (
          projectId: string,
          taskId: string
        ) => Promise<Result<{ linked: string | null; task: BacklogTaskInfo | null }>>
      >()({
        channel: 'alva:task-summary',
        args: [projectId, taskId]
      }),
      /** Texto da task (spec, critérios, plano) para ler e aprovar; só leitura, segredos ocultados. */
      taskDocument: call<
        (
          projectId: string,
          taskId: string
        ) => Promise<Result<{ linked: string | null; doc: BacklogTaskDocument | null }>>
      >()({
        channel: 'alva:task-document',
        args: [projectId, taskId]
      })
    }
  ),
  /**
   * Agentes (8A): perfis (arquivos `.md`), aprovação dos perfis do repositório e atribuição de
   * tarefas. Agentes não ganham permissões: só instruções, modelo, fluxo preferido e limites.
   */
  agents: group(
    { needs: 'db', unexpected: 'Algo deu errado com os agentes. Tente novamente.' },
    {
      list: call<(projectId: string) => Promise<Result<AgentsState>>>()({
        channel: 'agents:list',
        args: [projectId]
      }),
      save: call<
        (input: {
          projectId: string
          scope: AgentScope
          profile: AgentProfile
          isNew: boolean
        }) => Promise<Result<AgentsState>>
      >()({
        channel: 'agents:save',
        args: [parseAgentSaveInput]
      }),
      /** Aprova o perfil do repositório exatamente como visto (`hash`). */
      approve: call<
        (projectId: string, key: AgentKey, hash: string) => Promise<Result<AgentsState>>
      >()({
        channel: 'agents:approve',
        args: [projectId, agentKey, profileHash]
      }),
      /** `key = null` tira a atribuição. */
      assign: call<
        (projectId: string, taskId: string, key: AgentKey | null) => Promise<Result<null>>
      >()({
        channel: 'agents:assign',
        args: [projectId, taskId, agentKeyOrNull]
      }),
      setRules: call<
        (projectId: string, rules: ProjectAgents['assignOnEnter']) => Promise<Result<AgentsState>>
      >()({
        channel: 'agents:set-rules',
        args: [projectId, parseAgentRules]
      }),
      /** Avatar de cada tarefa atribuída (cards do quadro). */
      badges: call<(projectId: string) => Promise<Record<string, AgentBadge>>>()({
        channel: 'agents:badges',
        args: [projectId],
        fallback: {}
      }),
      /** 8B: orquestrador do projeto (config, validação, carga dos agentes, última rodada). */
      orchestrator: call<(projectId: string) => Promise<Result<OrchestratorState>>>()({
        channel: 'agents:orchestrator',
        args: [projectId],
        unexpected: 'Algo deu errado com o orquestrador. Tente novamente.'
      }),
      /** Valida de novo no main; erros bloqueiam. */
      saveOrchestrator: call<
        (projectId: string, config: OrchestratorConfig) => Promise<Result<OrchestratorState>>
      >()({
        channel: 'agents:save-orchestrator',
        args: [projectId, parseOrchestratorConfig],
        unexpected: 'Algo deu errado com o orquestrador. Tente novamente.'
      }),
      /** Uma rodada agora (sem esperar o ciclo de ~60 s). */
      runOrchestrator: call<(projectId: string) => Promise<Result<OrchestratorState>>>()({
        channel: 'agents:run-orchestrator',
        args: [projectId],
        unexpected: 'Algo deu errado com o orquestrador. Tente novamente.'
      }),
      onChanged: IPC_EVENTS.agentsChanged
    }
  ),
  /** Fluxos de tarefa (5A): sequências de passos ligadas às colunas do quadro. */
  taskFlows: group(
    { needs: 'db', unexpected: 'Algo deu errado no fluxo. Tente novamente.' },
    {
      getProject: call<(projectId: string) => Promise<Result<TaskFlowsProject>>>()({
        channel: 'task-flows:get-project',
        args: [projectId]
      }),
      /** Valida de novo no main; erros bloqueiam. */
      saveFlows: call<(projectId: string, flows: Flow[]) => Promise<Result<TaskFlowsProject>>>()({
        channel: 'task-flows:save-flows',
        args: [projectId, parseFlows]
      }),
      /** Execuções da tarefa (a ativa ou a mais recente primeiro). */
      runs: call<(taskId: string) => Promise<FlowRunView[]>>()({
        channel: 'task-flows:runs',
        args: [taskId],
        fallback: []
      }),
      /** Para os cards: tarefas com fluxo ativo e se ele espera você. */
      active: call<(projectId: string) => Promise<Record<string, TaskFlowActivity>>>()({
        channel: 'task-flows:active',
        args: [projectId],
        fallback: {}
      }),
      /** "Rodar fluxo": o fluxo ligado à etapa atual da tarefa. */
      start: call<(projectId: string, taskId: string) => FlowRunResult>()({
        channel: 'task-flows:start',
        args: [projectId, taskId]
      }),
      /** Aprovar um gate; numa ação com escolha (ex.: revisores), os valores escolhidos. */
      approve: call<(flowRunId: string, values?: string[]) => FlowRunResult>()({
        channel: 'task-flows:approve',
        args: [localId, parseGateValues]
      }),
      /** "Exigir minha aprovação para push" (5C). */
      setDelivery: call<
        (projectId: string, settings: DeliverySettings) => Promise<Result<TaskFlowsProject>>
      >()({
        channel: 'task-flows:set-delivery',
        args: [projectId, parseDeliverySettings]
      }),
      /** Rodar um fluxo específico à mão (ex.: "Alva: CI vermelho"). */
      startById: call<(projectId: string, taskId: string, flowId: string) => FlowRunResult>()({
        channel: 'task-flows:start-by-id',
        args: [projectId, taskId, localId]
      }),
      /** "Abrir PR": push (com o gate) e /alva-flow:pr em modo entrega, ou só o push (sem vínculo). */
      openPr: call<(projectId: string, taskId: string) => Promise<Result<OpenPrResult>>>()({
        channel: 'task-flows:open-pr',
        args: [projectId, taskId]
      }),
      reject: call<(flowRunId: string) => FlowRunResult>()({
        channel: 'task-flows:reject',
        args: [localId]
      }),
      resume: call<(flowRunId: string) => FlowRunResult>()({
        channel: 'task-flows:resume',
        args: [localId]
      }),
      /** Volta a um comando anterior ao passo parado (ex.: /commit antes do push) e segue dali. */
      rerunFrom: call<(flowRunId: string, stepId: string) => FlowRunResult>()({
        channel: 'task-flows:rerun-from',
        args: [localId, stepId]
      }),
      /** Responde ao Claude no passo parado e segue na mesma sessão. */
      resumeWithReply: call<(flowRunId: string, text: string) => FlowRunResult>()({
        channel: 'task-flows:resume-reply',
        args: [localId, messageText]
      }),
      /**
       * "Pedir ajustes…" no gate que espera você: o texto volta ao passo de ajustes (mesma sessão do
       * Claude Code) e o gate aparece de novo. Recusado depois do limite de voltas.
       */
      reviseGate: call<(projectId: string, taskId: string, text: string) => FlowRunResult>()({
        channel: 'task-flows:revise-gate',
        args: [projectId, taskId, messageText]
      }),
      skip: call<(flowRunId: string) => FlowRunResult>()({
        channel: 'task-flows:skip',
        args: [localId]
      }),
      cancel: call<(flowRunId: string) => FlowRunResult>()({
        channel: 'task-flows:cancel',
        args: [localId]
      }),
      decideLeft: call<(flowRunId: string, choice: 'cancel' | 'continue') => FlowRunResult>()({
        channel: 'task-flows:decide-left',
        args: [localId, leftChoice]
      }),
      /** Escolha pedida por um extrator (ex.: qual task do Backlog é desta tarefa). */
      choose: call<(flowRunId: string, value: string) => FlowRunResult>()({
        channel: 'task-flows:choose',
        args: [localId, choiceValue]
      }),
      onChanged: IPC_EVENTS.taskFlowChanged
    }
  ),
  /** Claude Code (4A): CLI do usuário rodando a tarefa num worktree isolado. */
  claude: group(
    { needs: 'db', unexpected: 'Algo deu errado. Tente novamente.' },
    {
      /** Instalado, versão e login (nunca credenciais). `force` detecta de novo. */
      status: call<(options?: ForceOption) => Promise<ClaudeCodeStatus>>()({
        channel: 'claude:status',
        args: [forceOption],
        fallback: claudeUnknownStatus
      }),
      /** Execuções e ambiente da tarefa (local, sem rede). */
      state: call<(projectId: string, taskId: string) => Promise<Result<TaskRunsState>>>()({
        channel: 'claude:state',
        args: [projectId, taskId]
      }),
      /** Briefing do Notion (editável) e a branch que será usada. Não cria nada. */
      prepare: call<(projectId: string, taskId: string) => Promise<Result<RunPreparation>>>()({
        channel: 'claude:prepare',
        args: [projectId, taskId]
      }),
      /** Cria/reutiliza o worktree e inicia (ou enfileira) a execução. */
      start: call<(request: StartRunRequest) => Promise<Result<TaskRunsState>>>()({
        channel: 'claude:start',
        args: [parseStartRunRequest]
      }),
      /** Mensagem do campo da sessão: continua a última sessão da tarefa ou começa uma. */
      send: call<(request: SendMessageRequest) => Promise<Result<TaskRunsState>>>()({
        channel: 'claude:send',
        args: [parseSendMessageRequest]
      }),
      cancel: call<(runId: string) => Promise<void>>()({
        channel: 'claude:cancel',
        args: [localId],
        fallback: undefined
      }),
      answerPermission: call<
        (runId: string, requestId: string, answer: PermissionAnswer) => Promise<void>
      >()({
        channel: 'claude:answer-permission',
        args: [localId, requestId, permissionAnswer],
        fallback: undefined
      }),
      answerQuestion: call<
        (runId: string, requestId: string, answers: Record<string, string>) => Promise<void>
      >()({
        channel: 'claude:answer-question',
        args: [localId, requestId, parseAnswers],
        fallback: undefined
      }),
      readLog: call<(runId: string) => Promise<RunLogEvent[]>>()({
        channel: 'claude:read-log',
        args: [localId],
        fallback: []
      }),
      /** Remove o worktree (a branch fica). Com mudanças pendentes, exige `force`. */
      cleanup: call<
        (projectId: string, taskId: string, force: boolean) => Promise<Result<TaskRunsState>>
      >()({
        channel: 'claude:cleanup',
        args: [projectId, taskId, bool]
      }),
      openEditor: call<
        (projectId: string, taskId: string, editor: EditorId) => Promise<Result<null>>
      >()({
        channel: 'claude:open-editor',
        args: [projectId, taskId, editorId]
      }),
      /** Abre o terminal do sistema na pasta de trabalho da tarefa (o main resolve a pasta). */
      openTerminal: call<(projectId: string, taskId: string) => Promise<Result<null>>>()({
        channel: 'claude:open-terminal',
        args: [projectId, taskId]
      }),
      diff: call<(projectId: string, taskId: string) => Promise<Result<ClaudeDiff>>>()({
        channel: 'claude:diff',
        args: [projectId, taskId]
      }),
      /** Branches ligadas à tarefa e as do projeto ("Vincular branch"). */
      branches: call<(projectId: string, taskId: string) => Promise<Result<TaskBranchesView>>>()({
        channel: 'claude:branches',
        args: [projectId, taskId]
      }),
      linkBranch: call<
        (projectId: string, taskId: string, branch: string) => Promise<Result<TaskBranchesView>>
      >()({
        channel: 'claude:link-branch',
        args: [projectId, taskId, branchName]
      }),
      unlinkBranch: call<
        (projectId: string, taskId: string, branch: string) => Promise<Result<TaskBranchesView>>
      >()({
        channel: 'claude:unlink-branch',
        args: [projectId, taskId, branchName]
      }),
      /**
       * Comandos/skills instalados (usuário, projeto, plugins). Só metadados; recarrega a cada
       * chamada. `taskId` `null` = os da pasta do projeto (editor de fluxos).
       */
      catalog: call<
        (projectId: string, taskId: string | null) => Promise<Result<CatalogGroup[]>>
      >()({
        channel: 'claude:catalog',
        args: [projectId, taskIdOrNull]
      }),
      /** Documentos alterados no ambiente (candidatos) e artefatos anexados à tarefa. */
      artifacts: call<
        (
          projectId: string,
          taskId: string
        ) => Promise<Result<{ candidates: ArtifactCandidate[]; attached: ArtifactView[] }>>
      >()({
        channel: 'claude:artifacts',
        args: [projectId, taskId]
      }),
      /** Anexa um documento commitado (caminho relativo da lista de candidatos). */
      attachArtifact: call<
        (
          projectId: string,
          taskId: string,
          path: string,
          runId: string | null
        ) => Promise<Result<ArtifactView>>
      >()({
        channel: 'claude:attach-artifact',
        args: [projectId, taskId, repoPath, localIdOrNull]
      }),
      /** Publica no Notion (seção no fim da página da tarefa ou subpágina). */
      publishArtifact: call<
        (
          projectId: string,
          artifactId: string,
          mode: ArtifactPublishMode
        ) => Promise<Result<{ artifact: ArtifactView; url: string | null }>>
      >()({
        channel: 'claude:publish-artifact',
        args: [projectId, localId, publishMode]
      }),
      onRunEvent: IPC_EVENTS.runEvent
    }
  ),
  /** Atualizações automáticas (6C). Tudo roda no main; o renderer só vê o status. */
  updates: group(
    { needs: 'none', unexpected: 'Algo deu errado. Tente novamente.' },
    {
      status: call<() => Promise<UpdateStatus>>()({
        channel: 'updates:status',
        args: [],
        fallback: sameAs('status')
      }),
      /** "Procurar atualizações". */
      check: call<() => Promise<UpdateStatus>>()({
        channel: 'updates:check',
        args: [],
        fallback: sameAs('status')
      }),
      setChannel: call<(channel: UpdateChannel) => Promise<UpdateStatus>>()({
        channel: 'updates:set-channel',
        args: [updateChannel],
        fallback: sameAs('status')
      }),
      /** `if_idle`: instala se nada estiver rodando, senão devolve o que está rodando. */
      install: call<(mode: UpdateInstallMode) => Promise<UpdateInstallResult>>()({
        channel: 'updates:install',
        args: [installMode],
        fallback: {
          state: 'unavailable',
          message: 'Não foi possível instalar a atualização agora.'
        },
        invalid: { state: 'unavailable', message: 'Pedido inválido.' }
      }),
      /** macOS sem assinatura: abre o DMG da arquitetura no navegador (URL montada no main). */
      openDownload: call<() => Promise<boolean>>()({
        channel: 'updates:open-download',
        args: [],
        fallback: false
      }),
      /** Notas para mostrar uma vez depois de atualizar (`null` = nada). */
      whatsNew: call<() => Promise<ReleaseNotes | null>>()({
        channel: 'updates:whats-new',
        args: [],
        fallback: null
      }),
      markWhatsNewSeen: call<() => Promise<void>>()({
        channel: 'updates:mark-whats-new-seen',
        args: [],
        fallback: undefined
      }),
      /** Notas da versão atual (botão "Ver novidades desta versão"). */
      releaseNotes: call<() => Promise<ReleaseNotes | null>>()({
        channel: 'updates:release-notes',
        args: [],
        fallback: null
      }),
      about: call<() => Promise<AboutInfo>>()({
        channel: 'updates:about',
        args: [],
        fallback: sameAs('about')
      }),
      /** Diagnóstico sem segredos (versões, banco, filas, conexões) para copiar e pedir ajuda. */
      diagnostics: call<() => Promise<string>>()({
        channel: 'updates:diagnostics',
        args: [],
        fallback: 'Não foi possível montar o diagnóstico agora.'
      }),
      onStatus: IPC_EVENTS.updateStatus
    }
  ),
  /** Energia: "Manter o computador acordado enquanto agentes trabalham" (desligado por padrão). */
  power: group(
    { needs: 'none', unexpected: 'Algo deu errado. Tente novamente.' },
    {
      keepAwake: call<() => Promise<boolean>>()({
        channel: 'power:get',
        args: [],
        fallback: false
      }),
      setKeepAwake: call<(enabled: boolean) => Promise<boolean>>()({
        channel: 'power:set-keep-awake',
        args: [bool],
        fallback: sameAs('keepAwake')
      })
    }
  ),
  /** Visão geral (6D): tudo de todos os projetos, sem chamar APIs ao abrir. */
  overview: group(
    {
      needs: 'db',
      unexpected: 'Não foi possível montar a Visão geral. Tente atualizar.'
    },
    {
      get: call<() => Promise<Result<OverviewSnapshot>>>()({
        channel: 'overview:get',
        args: []
      }),
      /** Verifica git/GitHub/Notion agora (ciclo das automações) e devolve a visão nova. */
      refresh: call<() => Promise<Result<OverviewSnapshot>>>()({
        channel: 'overview:refresh',
        args: []
      }),
      activity: call<(query?: ActivityQuery) => Promise<Result<ActivityPage>>>()({
        channel: 'overview:activity',
        args: [parseActivityQuery]
      }),
      /** Algo mudou (gate, pergunta, execução, automação). */
      onChanged: IPC_EVENTS.overviewChanged
    }
  ),
  /** Abre um link no navegador padrão. Só domínios da allowlist do main são aceitos. */
  openExternal: call<(url: string) => Promise<boolean>>()({
    channel: 'shell:open-external',
    args: [url],
    needs: 'none',
    fallback: false
  })
}

/** API exposta pelo preload em `window.orkio`. */
export type OrkioApi = ApiOf<typeof ORKIO_API>
