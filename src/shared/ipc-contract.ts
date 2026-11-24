/**
 * Contrato do IPC entre main, preload e renderer: canais e o tipo da API (`window.orkio`).
 * Os tipos de domínio moram nos módulos de `shared/` de cada assunto. Sem Node nem DOM.
 */

import type {
  AgentBadge,
  AgentKey,
  AgentProfile,
  AgentScope,
  AgentsState,
  ProjectAgents
} from './agent'
import type {
  ArtifactCandidate,
  ArtifactPublishMode,
  ArtifactView,
  CatalogGroup,
  ClaudeCodeStatus,
  ClaudeDiff,
  EditorId,
  PermissionAnswer,
  RunEventMessage,
  RunLogEvent,
  RunPreparation,
  SendMessageRequest,
  StartRunRequest,
  TaskBranchesView,
  TaskRunsState
} from './agent-run'
import type { AlvaPrecheck, AlvaStatusView, BacklogTaskDocument, BacklogTaskInfo } from './alva'
import type { AutomationStatus } from './automation'
import type {
  BoardCard,
  BoardHistoryEntry,
  BoardSaveInput,
  BoardSyncEvent,
  BoardView
} from './board'
import type {
  AuthOptions,
  ConnectionStatus,
  ConnectorCredentials,
  DeviceFlowStartResult
} from './connection'
import type { DeliverySettings } from './delivery'
import type { ConfigEvent, FlowDraft, FlowFileResult } from './flow'
import type {
  NotionDataSourceList,
  NotionProjectChoice,
  NotionTaskSearchResult,
  NotionTasksResult,
  NotionTasksSchemaInfo,
  NotionWorkspaceInput,
  NotionWorkspaceStatus
} from './notion'
import type { OrchestratorConfig, OrchestratorState } from './orchestrator'
import type { OrkioBotStatus } from './orkio-bot'
import type { ActivityPage, ActivityQuery, BoardTaskRef, OverviewSnapshot } from './overview'
import type {
  BranchChangedEvent,
  CreateProjectInput,
  PickFolderResult,
  ProjectMutationResult,
  ProjectsListResult
} from './projects'
import type { Result } from './result'
import type { ReviewThreadsResult } from './review'
import type {
  Flow,
  FlowRunView,
  OpenPrResult,
  TaskFlowActivity,
  TaskFlowsProject
} from './task-flow'
import type { TaskSignalsResult } from './task-signals'
import type {
  AboutInfo,
  ReleaseNotes,
  UpdateChannel,
  UpdateInstallMode,
  UpdateInstallResult,
  UpdateStatus
} from './updates'

export const IPC_CHANNELS = {
  notion: {
    getStatus: 'notion:get-status',
    connect: 'notion:connect',
    disconnect: 'notion:disconnect',
    testConnection: 'notion:test-connection',
    getAuthOptions: 'notion:get-auth-options',
    startOAuth: 'notion:oauth-start',
    cancelOAuth: 'notion:oauth-cancel'
  },
  github: {
    getStatus: 'github:get-status',
    connect: 'github:connect',
    disconnect: 'github:disconnect',
    testConnection: 'github:test-connection',
    getAuthOptions: 'github:get-auth-options',
    startDeviceFlow: 'github:device-flow-start',
    waitDeviceFlow: 'github:device-flow-wait',
    cancelDeviceFlow: 'github:device-flow-cancel',
    orkioBot: 'github:orkio-bot'
  },
  signals: {
    get: 'signals:get',
    reviewThreads: 'signals:review-threads'
  },
  alva: {
    precheck: 'alva:precheck',
    status: 'alva:status',
    createTemplates: 'alva:create-templates',
    addPlanningStage: 'alva:add-planning-stage',
    setMaxParallel: 'alva:set-max-parallel',
    taskSummary: 'alva:task-summary',
    taskDocument: 'alva:task-document'
  },
  agents: {
    list: 'agents:list',
    save: 'agents:save',
    approve: 'agents:approve',
    assign: 'agents:assign',
    setRules: 'agents:set-rules',
    badges: 'agents:badges',
    /** 8B: orquestrador (estado, salvar, rodar agora). */
    orchestrator: 'agents:orchestrator',
    saveOrchestrator: 'agents:save-orchestrator',
    runOrchestrator: 'agents:run-orchestrator',
    /** Evento main → renderer: agentes ou atribuições de um projeto mudaram. */
    changed: 'agents:changed'
  },
  taskFlows: {
    getProject: 'task-flows:get-project',
    saveFlows: 'task-flows:save-flows',
    runs: 'task-flows:runs',
    active: 'task-flows:active',
    start: 'task-flows:start',
    approve: 'task-flows:approve',
    setDelivery: 'task-flows:set-delivery',
    startById: 'task-flows:start-by-id',
    openPr: 'task-flows:open-pr',
    reject: 'task-flows:reject',
    resume: 'task-flows:resume',
    rerunFrom: 'task-flows:rerun-from',
    resumeWithReply: 'task-flows:resume-reply',
    reviseGate: 'task-flows:revise-gate',
    skip: 'task-flows:skip',
    cancel: 'task-flows:cancel',
    decideLeft: 'task-flows:decide-left',
    choose: 'task-flows:choose',
    /** Evento main → renderer: o fluxo de uma tarefa mudou. */
    changed: 'task-flows:changed'
  },
  claude: {
    status: 'claude:status',
    state: 'claude:state',
    prepare: 'claude:prepare',
    start: 'claude:start',
    send: 'claude:send',
    cancel: 'claude:cancel',
    answerPermission: 'claude:answer-permission',
    answerQuestion: 'claude:answer-question',
    readLog: 'claude:read-log',
    cleanup: 'claude:cleanup',
    openEditor: 'claude:open-editor',
    openTerminal: 'claude:open-terminal',
    diff: 'claude:diff',
    branches: 'claude:branches',
    linkBranch: 'claude:link-branch',
    unlinkBranch: 'claude:unlink-branch',
    catalog: 'claude:catalog',
    artifacts: 'claude:artifacts',
    attachArtifact: 'claude:attach-artifact',
    publishArtifact: 'claude:publish-artifact',
    /** Evento main → renderer: evento normalizado de uma execução. */
    runEvent: 'claude:run-event'
  },
  flow: {
    save: 'flow:save',
    events: 'flow:events',
    exportFile: 'flow:export-file',
    importFile: 'flow:import-file'
  },
  automation: {
    status: 'automation:status',
    runNow: 'automation:run-now',
    setPaused: 'automation:set-paused'
  },
  board: {
    get: 'board:get',
    save: 'board:save',
    move: 'board:move',
    setBlocked: 'board:set-blocked',
    history: 'board:history',
    retryNow: 'board:retry-now',
    setAutomationPaused: 'board:set-automation-paused',
    /** Evento main → renderer: o quadro do projeto mudou (automação). */
    changed: 'board:changed',
    /** Evento main → renderer: abrir uma tarefa (clique na notificação). */
    openTask: 'board:open-task',
    /** Evento main → renderer: resultado/estado de uma escrita no Notion. */
    syncChanged: 'board:sync-changed'
  },
  notionWorkspace: {
    getStatus: 'notion-workspace:get-status',
    revalidate: 'notion-workspace:revalidate',
    listDataSources: 'notion-workspace:list-data-sources',
    getTasksSchema: 'notion-workspace:get-tasks-schema',
    save: 'notion-workspace:save',
    clear: 'notion-workspace:clear',
    listProjectChoices: 'notion-workspace:list-project-choices',
    link: 'notion-workspace:link',
    unlink: 'notion-workspace:unlink',
    listTasks: 'notion-workspace:list-tasks',
    searchTasks: 'notion-workspace:search-tasks'
  },
  projects: {
    list: 'projects:list',
    revalidate: 'projects:revalidate',
    pickFolder: 'projects:pick-folder',
    create: 'projects:create',
    relocate: 'projects:relocate',
    remove: 'projects:remove',
    /** Evento main → renderer: a branch atual de um projeto mudou. */
    branchChanged: 'projects:branch-changed'
  },
  shell: {
    openExternal: 'shell:open-external'
  },
  updates: {
    status: 'updates:status',
    check: 'updates:check',
    setChannel: 'updates:set-channel',
    install: 'updates:install',
    openDownload: 'updates:open-download',
    whatsNew: 'updates:whats-new',
    markWhatsNewSeen: 'updates:mark-whats-new-seen',
    releaseNotes: 'updates:release-notes',
    about: 'updates:about',
    diagnostics: 'updates:diagnostics',
    /** Evento main → renderer: o status das atualizações mudou. */
    statusChanged: 'updates:status-changed'
  },
  /** Energia: manter o computador acordado enquanto agentes trabalham. */
  power: {
    get: 'power:get',
    setKeepAwake: 'power:set-keep-awake'
  },
  /** Visão geral (6D): agregação de todos os projetos, só dados locais e caches. */
  overview: {
    get: 'overview:get',
    refresh: 'overview:refresh',
    activity: 'overview:activity',
    /** Evento main → renderer: algo relevante mudou (com o total de "Esperando você"). */
    changed: 'overview:changed'
  }
} as const

/** API exposta pelo preload em `window.orkio`. */
export interface OrkioApi {
  notion: {
    getStatus(): Promise<ConnectionStatus>
    connect(credentials: ConnectorCredentials): Promise<ConnectionStatus>
    disconnect(): Promise<ConnectionStatus>
    testConnection(): Promise<ConnectionStatus>
    getAuthOptions(): Promise<AuthOptions>
    /**
     * Abre o Notion no navegador para o usuário autorizar o Orkio.
     * Resolve quando o fluxo termina (conectado, erro ou cancelado — neste caso, o status salvo).
     */
    startOAuth(): Promise<ConnectionStatus>
    cancelOAuth(): Promise<void>
  }
  github: {
    getStatus(): Promise<ConnectionStatus>
    connect(credentials: ConnectorCredentials): Promise<ConnectionStatus>
    disconnect(): Promise<ConnectionStatus>
    testConnection(): Promise<ConnectionStatus>
    getAuthOptions(): Promise<AuthOptions>
    /**
     * Pede um código ao GitHub e começa a aguardar a autorização (no main).
     * Se já houver um fluxo em andamento, devolve o mesmo código.
     */
    startDeviceFlow(): Promise<DeviceFlowStartResult>
    /** Resolve quando o fluxo termina: conectado, erro ou cancelado (status salvo). */
    waitDeviceFlow(): Promise<ConnectionStatus>
    cancelDeviceFlow(): Promise<void>
    /** O orkio[bot] (GitHub App) está instalado nos repositórios dos projetos? Só leitura. */
    orkioBot(options?: { force?: boolean }): Promise<OrkioBotStatus>
  }
  /** Quadro kanban por projeto (Etapa 3A). */
  board: {
    get(projectId: string, options?: { force?: boolean }): Promise<Result<BoardView>>
    save(projectId: string, input: BoardSaveInput): Promise<Result<BoardView>>
    move(projectId: string, taskId: string, stageId: string): Promise<Result<BoardCard>>
    setBlocked(projectId: string, taskId: string, blocked: boolean): Promise<Result<BoardCard>>
    history(projectId: string, taskId: string): Promise<Result<BoardHistoryEntry[]>>
    /** Tenta agora as escritas pendentes. */
    retryNow(): Promise<void>
    onSyncChanged(listener: (event: BoardSyncEvent) => void): () => void
    setAutomationPaused(
      projectId: string,
      taskId: string,
      paused: boolean
    ): Promise<Result<BoardCard>>
    /** O quadro mudou por automação (recarregar). */
    onChanged(listener: (event: { projectId: string }) => void): () => void
    /** Pedido para abrir uma tarefa (clique na notificação). */
    onOpenTask(listener: (event: BoardTaskRef) => void): () => void
  }
  /** Editor do fluxo (3C): etapas + automações. */
  flow: {
    /** Valida de novo no main e salva; tarefas de etapas removidas vão para o destino escolhido. */
    save(projectId: string, draft: FlowDraft): Promise<Result<BoardView>>
    events(projectId: string): Promise<ConfigEvent[]>
    /** Abre "Salvar como…" no main e grava o JSON (o renderer nunca escolhe caminhos). */
    exportFile(content: unknown): Promise<FlowFileResult>
    /** Abre o seletor no main e devolve o JSON lido (validação no renderer, função pura). */
    importFile(): Promise<FlowFileResult>
  }
  /** Motor de automações (3B). */
  automation: {
    status(projectId: string): Promise<AutomationStatus>
    /** Verifica agora (git + GitHub) e devolve o novo estado. */
    runNow(projectId: string): Promise<AutomationStatus>
    /** "Pausar todas" / "Retomar". */
    setPaused(paused: boolean): Promise<AutomationStatus>
  }
  /** Integração com o plugin alva-flow (5B). */
  alva: {
    /** "Pronto para o alva-flow?" (`force` verifica de novo). */
    precheck(projectId: string, options?: { force?: boolean }): Promise<Result<AlvaPrecheck>>
    status(projectId: string): Promise<Result<AlvaStatusView>>
    /** Cria os templates "Fluxo Alva" e liga nas colunas escolhidas (ao entrar). */
    createTemplates(
      projectId: string,
      bindings: {
        plan: string | null
        deliver: string | null
        review: string | null
        reviewed: string | null
      }
    ): Promise<Result<AlvaStatusView>>
    /** Coluna "Planejando" (entre Prioridades e Em andamento) com o status do Notion escolhido. */
    addPlanningStage(projectId: string, notionStatusId: string): Promise<Result<string>>
    setMaxParallel(projectId: string, value: number): Promise<Result<AlvaStatusView>>
    /** Task do Backlog.md vinculada (id, título, status, critérios). */
    taskSummary(
      projectId: string,
      taskId: string
    ): Promise<Result<{ linked: string | null; task: BacklogTaskInfo | null }>>
    /** Texto da task (spec, critérios, plano) para ler e aprovar; só leitura, segredos ocultados. */
    taskDocument(
      projectId: string,
      taskId: string
    ): Promise<Result<{ linked: string | null; doc: BacklogTaskDocument | null }>>
  }
  /**
   * Agentes (8A): perfis (arquivos `.md`), aprovação dos perfis do repositório e atribuição de
   * tarefas. Agentes não ganham permissões: só instruções, modelo, fluxo preferido e limites.
   */
  agents: {
    list(projectId: string): Promise<Result<AgentsState>>
    save(input: {
      projectId: string
      scope: AgentScope
      profile: AgentProfile
      isNew: boolean
    }): Promise<Result<AgentsState>>
    /** Aprova o perfil do repositório exatamente como visto (`hash`). */
    approve(projectId: string, key: AgentKey, hash: string): Promise<Result<AgentsState>>
    /** `key = null` tira a atribuição. */
    assign(projectId: string, taskId: string, key: AgentKey | null): Promise<Result<null>>
    setRules(projectId: string, rules: ProjectAgents['assignOnEnter']): Promise<Result<AgentsState>>
    /** Avatar de cada tarefa atribuída (cards do quadro). */
    badges(projectId: string): Promise<Record<string, AgentBadge>>
    /** 8B: orquestrador do projeto (config, validação, carga dos agentes, última rodada). */
    orchestrator(projectId: string): Promise<Result<OrchestratorState>>
    /** Valida de novo no main; erros bloqueiam. */
    saveOrchestrator(
      projectId: string,
      config: OrchestratorConfig
    ): Promise<Result<OrchestratorState>>
    /** Uma rodada agora (sem esperar o ciclo de ~60 s). */
    runOrchestrator(projectId: string): Promise<Result<OrchestratorState>>
    onChanged(listener: (event: { projectId: string }) => void): () => void
  }
  /** Fluxos de tarefa (5A): sequências de passos ligadas às colunas do quadro. */
  taskFlows: {
    getProject(projectId: string): Promise<Result<TaskFlowsProject>>
    /** Valida de novo no main; erros bloqueiam. */
    saveFlows(projectId: string, flows: Flow[]): Promise<Result<TaskFlowsProject>>
    /** Execuções da tarefa (a ativa ou a mais recente primeiro). */
    runs(taskId: string): Promise<FlowRunView[]>
    /** Para os cards: tarefas com fluxo ativo e se ele espera você. */
    active(projectId: string): Promise<Record<string, TaskFlowActivity>>
    /** "Rodar fluxo": o fluxo ligado à etapa atual da tarefa. */
    start(projectId: string, taskId: string): Promise<Result<FlowRunView>>
    /** Aprovar um gate; numa ação com escolha (ex.: revisores), os valores escolhidos. */
    approve(flowRunId: string, values?: string[]): Promise<Result<FlowRunView>>
    /** "Exigir minha aprovação para push" (5C). */
    setDelivery(projectId: string, settings: DeliverySettings): Promise<Result<TaskFlowsProject>>
    /** Rodar um fluxo específico à mão (ex.: "Alva: CI vermelho"). */
    startById(projectId: string, taskId: string, flowId: string): Promise<Result<FlowRunView>>
    /** "Abrir PR": push (com o gate) e /alva-flow:pr em modo entrega, ou só o push (sem vínculo). */
    openPr(projectId: string, taskId: string): Promise<Result<OpenPrResult>>
    reject(flowRunId: string): Promise<Result<FlowRunView>>
    resume(flowRunId: string): Promise<Result<FlowRunView>>
    /** Volta a um comando anterior ao passo parado (ex.: /commit antes do push) e segue dali. */
    rerunFrom(flowRunId: string, stepId: string): Promise<Result<FlowRunView>>
    /** Responde ao Claude no passo parado e segue na mesma sessão. */
    resumeWithReply(flowRunId: string, text: string): Promise<Result<FlowRunView>>
    /**
     * "Pedir ajustes…" no gate que espera você: o texto volta ao passo de ajustes (mesma sessão do
     * Claude Code) e o gate aparece de novo. Recusado depois do limite de voltas.
     */
    reviseGate(projectId: string, taskId: string, text: string): Promise<Result<FlowRunView>>
    skip(flowRunId: string): Promise<Result<FlowRunView>>
    cancel(flowRunId: string): Promise<Result<FlowRunView>>
    decideLeft(flowRunId: string, choice: 'cancel' | 'continue'): Promise<Result<FlowRunView>>
    /** Escolha pedida por um extrator (ex.: qual task do Backlog é desta tarefa). */
    choose(flowRunId: string, value: string): Promise<Result<FlowRunView>>
    onChanged(listener: (event: { projectId: string; taskId: string }) => void): () => void
  }
  /** Claude Code (4A): CLI do usuário rodando a tarefa num worktree isolado. */
  claude: {
    /** Instalado, versão e login (nunca credenciais). `force` detecta de novo. */
    status(options?: { force?: boolean }): Promise<ClaudeCodeStatus>
    /** Execuções e ambiente da tarefa (local, sem rede). */
    state(projectId: string, taskId: string): Promise<Result<TaskRunsState>>
    /** Briefing do Notion (editável) e a branch que será usada. Não cria nada. */
    prepare(projectId: string, taskId: string): Promise<Result<RunPreparation>>
    /** Cria/reutiliza o worktree e inicia (ou enfileira) a execução. */
    start(request: StartRunRequest): Promise<Result<TaskRunsState>>
    /** Mensagem do campo da sessão: continua a última sessão da tarefa ou começa uma. */
    send(request: SendMessageRequest): Promise<Result<TaskRunsState>>
    cancel(runId: string): Promise<void>
    answerPermission(runId: string, requestId: string, answer: PermissionAnswer): Promise<void>
    answerQuestion(runId: string, requestId: string, answers: Record<string, string>): Promise<void>
    readLog(runId: string): Promise<RunLogEvent[]>
    /** Remove o worktree (a branch fica). Com mudanças pendentes, exige `force`. */
    cleanup(projectId: string, taskId: string, force: boolean): Promise<Result<TaskRunsState>>
    openEditor(projectId: string, taskId: string, editor: EditorId): Promise<Result<null>>
    /** Abre o terminal do sistema na pasta de trabalho da tarefa (o main resolve a pasta). */
    openTerminal(projectId: string, taskId: string): Promise<Result<null>>
    diff(projectId: string, taskId: string): Promise<Result<ClaudeDiff>>
    /** Branches ligadas à tarefa e as do projeto ("Vincular branch"). */
    branches(projectId: string, taskId: string): Promise<Result<TaskBranchesView>>
    linkBranch(projectId: string, taskId: string, branch: string): Promise<Result<TaskBranchesView>>
    unlinkBranch(
      projectId: string,
      taskId: string,
      branch: string
    ): Promise<Result<TaskBranchesView>>
    /** Comandos/skills instalados (usuário, projeto, plugins). Só metadados; recarrega a cada chamada. */
    catalog(projectId: string, taskId: string): Promise<Result<CatalogGroup[]>>
    /** Documentos alterados no ambiente (candidatos) e artefatos anexados à tarefa. */
    artifacts(
      projectId: string,
      taskId: string
    ): Promise<Result<{ candidates: ArtifactCandidate[]; attached: ArtifactView[] }>>
    /** Anexa um documento commitado (caminho relativo da lista de candidatos). */
    attachArtifact(
      projectId: string,
      taskId: string,
      path: string,
      runId: string | null
    ): Promise<Result<ArtifactView>>
    /** Publica no Notion (seção no fim da página da tarefa ou subpágina). */
    publishArtifact(
      projectId: string,
      artifactId: string,
      mode: ArtifactPublishMode
    ): Promise<Result<{ artifact: ArtifactView; url: string | null }>>
    /** Assina os eventos das execuções. Devolve a função para cancelar a inscrição. */
    onRunEvent(listener: (message: RunEventMessage) => void): () => void
  }
  /** Branches e PRs ligadas às tarefas de um projeto pelo ID (só leitura). */
  signals: {
    get(projectId: string, options?: { force?: boolean }): Promise<Result<TaskSignalsResult>>
    /** Threads de review da PR da tarefa (texto lido pelo main; Task 15). */
    reviewThreads(
      projectId: string,
      taskId: string,
      options?: { force?: boolean }
    ): Promise<Result<ReviewThreadsResult>>
  }
  /** Bancos do Notion (Projetos/Tarefas), vínculo com projetos locais e tarefas (só leitura). */
  notionWorkspace: {
    /** Estado da configuração; na primeira chamada revalida o schema no Notion. */
    getStatus(): Promise<NotionWorkspaceStatus>
    revalidate(): Promise<NotionWorkspaceStatus>
    listDataSources(query?: string): Promise<Result<NotionDataSourceList>>
    getTasksSchema(
      tasksDataSourceId: string,
      projectsDataSourceId: string
    ): Promise<Result<NotionTasksSchemaInfo>>
    save(input: NotionWorkspaceInput): Promise<Result<NotionWorkspaceStatus>>
    /** Esquece os bancos e os vínculos (nada muda no Notion). */
    clear(): Promise<Result<NotionWorkspaceStatus>>
    listProjectChoices(
      projectId: string,
      options?: { force?: boolean }
    ): Promise<Result<{ choices: NotionProjectChoice[]; truncated: boolean }>>
    link(projectId: string, pageId: string): Promise<Result<{ id: string; name: string }>>
    unlink(projectId: string): Promise<Result<null>>
    listTasks(projectId: string, options?: { force?: boolean }): Promise<Result<NotionTasksResult>>
    /**
     * Busca no banco de Tarefas inteiro (qualquer responsável, qualquer projeto) por título ou ID.
     * Texto vazio = as editadas mais recentemente.
     */
    searchTasks(query: string): Promise<Result<NotionTaskSearchResult>>
  }
  projects: {
    /** Lista rápida (só checagens locais). */
    list(): Promise<ProjectsListResult>
    /** Lista revalidando cada projeto também no GitHub. */
    revalidate(): Promise<ProjectsListResult>
    /** Abre o seletor de pasta (no main) e analisa o repositório. */
    pickFolder(): Promise<PickFolderResult>
    create(input: CreateProjectInput): Promise<ProjectMutationResult>
    /** Abre o seletor de pasta para apontar o projeto para outra pasta do mesmo repositório. */
    relocate(projectId: string): Promise<ProjectMutationResult>
    /** Só remove do Orkio; nunca apaga arquivos. */
    remove(projectId: string): Promise<{ ok: boolean }>
    /** Assina mudanças de branch. Devolve a função para cancelar a inscrição. */
    onBranchChanged(listener: (event: BranchChangedEvent) => void): () => void
  }
  /** Atualizações automáticas (6C). Tudo roda no main; o renderer só vê o status. */
  updates: {
    status(): Promise<UpdateStatus>
    /** "Procurar atualizações". */
    check(): Promise<UpdateStatus>
    setChannel(channel: UpdateChannel): Promise<UpdateStatus>
    /** `if_idle`: instala se nada estiver rodando, senão devolve o que está rodando. */
    install(mode: UpdateInstallMode): Promise<UpdateInstallResult>
    /** macOS sem assinatura: abre o DMG da arquitetura no navegador (URL montada no main). */
    openDownload(): Promise<boolean>
    /** Notas para mostrar uma vez depois de atualizar (`null` = nada). */
    whatsNew(): Promise<ReleaseNotes | null>
    markWhatsNewSeen(): Promise<void>
    /** Notas da versão atual (botão "Ver novidades desta versão"). */
    releaseNotes(): Promise<ReleaseNotes | null>
    about(): Promise<AboutInfo>
    /** Diagnóstico sem segredos (versões, banco, filas, conexões) para copiar e pedir ajuda. */
    diagnostics(): Promise<string>
    onStatus(listener: (status: UpdateStatus) => void): () => void
  }
  /** Energia: "Manter o computador acordado enquanto agentes trabalham" (desligado por padrão). */
  power: {
    keepAwake(): Promise<boolean>
    setKeepAwake(enabled: boolean): Promise<boolean>
  }
  /** Visão geral (6D): tudo de todos os projetos, sem chamar APIs ao abrir. */
  overview: {
    get(): Promise<Result<OverviewSnapshot>>
    /** Verifica git/GitHub/Notion agora (ciclo das automações) e devolve a visão nova. */
    refresh(): Promise<Result<OverviewSnapshot>>
    activity(query?: ActivityQuery): Promise<Result<ActivityPage>>
    /** Algo mudou (gate, pergunta, execução, automação). Devolve a função para cancelar. */
    onChanged(listener: (event: { waiting: number }) => void): () => void
  }
  /** Abre um link no navegador padrão. Só domínios da allowlist do main são aceitos. */
  openExternal(url: string): Promise<boolean>
}
