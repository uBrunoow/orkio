/**
 * Contrato compartilhado entre main, preload e renderer.
 * Só tipos e constantes — nada aqui pode depender de Node ou do DOM.
 */

import type { BoardConfig, BoardStage, StageIssue, StatusOption } from './board'
import type { FlowDraft } from './flow'
import type { TaskSignals } from './task-signals'
import type {
  ProjectClaudeContext,
  ArtifactCandidate,
  ArtifactPublishMode,
  ArtifactView,
  CatalogGroup,
  ClaudeCodeStatus,
  ClaudeResult,
  EditorId,
  PermissionAnswer,
  RunEventMessage,
  RunLogEvent,
  RunPreparation,
  StartRunRequest,
  TaskRunsState
} from './agent-run'

export type { BoardConfig, BoardStage, StageIssue, StatusOption, TaskSignals }

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
    cancelDeviceFlow: 'github:device-flow-cancel'
  },
  signals: {
    get: 'signals:get'
  },
  claude: {
    status: 'claude:status',
    state: 'claude:state',
    prepare: 'claude:prepare',
    start: 'claude:start',
    cancel: 'claude:cancel',
    answerPermission: 'claude:answer-permission',
    answerQuestion: 'claude:answer-question',
    readLog: 'claude:read-log',
    cleanup: 'claude:cleanup',
    openEditor: 'claude:open-editor',
    diff: 'claude:diff',
    catalog: 'claude:catalog',
    artifacts: 'claude:artifacts',
    getContext: 'claude:get-context',
    saveContext: 'claude:save-context',
    searchPages: 'claude:search-pages',
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
    listTasks: 'notion-workspace:list-tasks'
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
  }
} as const

/** Conectores existentes. Depois: 'claude-code'. */
export type ConnectorId = 'notion' | 'github'

export interface ConnectedAccount {
  userName: string
  /** Identificador público da conta (ex.: login do GitHub, sem "@"). */
  handle?: string
  workspaceName?: string
  avatarUrl?: string
}

export type ConnectionStatus =
  | { state: 'disconnected' }
  | { state: 'connecting' }
  | {
      state: 'connected'
      account: ConnectedAccount
      connectedAt: string
      /** Conectado, mas a última verificação falhou por motivo transitório (rede, 5xx, 429). */
      warning?: string
    }
  | {
      state: 'error'
      message: string
      /** true quando ainda existe credencial salva (ex.: token revogado). */
      hasStoredCredentials?: boolean
    }

/**
 * Credenciais que o RENDERER pode enviar (token colado pelo usuário).
 * Credenciais OAuth nunca passam pelo renderer: o fluxo roda inteiro no main
 * (ver `OAuthCredentials` em src/main/connectors/types.ts).
 */
export type TokenCredentials = { kind: 'token'; token: string }
export type ConnectorCredentials = TokenCredentials

/** Métodos de conexão disponíveis neste build. */
export interface AuthOptions {
  /** false quando o build não tem a config OAuth do serviço (client ID etc.). */
  oauth: boolean
}

/** Dados que o usuário precisa para concluir um Device Flow (nunca inclui tokens). */
export interface DeviceFlowInfo {
  /** Código que o usuário digita no navegador (ex.: "WDJB-MJHT"). */
  userCode: string
  /** Página onde o código é digitado (ex.: https://github.com/login/device). */
  verificationUri: string
  /** Quando o código expira (ISO 8601). */
  expiresAt: string
}

export type DeviceFlowStartResult =
  { ok: true; flow: DeviceFlowInfo } | { ok: false; status: ConnectionStatus }

// ---------- Notion: bancos (data sources), mapeamento e tarefas ----------

export type NotionColor =
  'default' | 'gray' | 'brown' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple' | 'pink' | 'red'

export interface NotionDataSourceSummary {
  id: string
  title: string
  url: string | null
}

export interface NotionPropertySummary {
  id: string
  name: string
  /** Tipo do Notion: title, status, select, unique_id, relation, people, number, ... */
  type: string
  options?: { id: string; name: string; color: NotionColor }[]
  /** Para `relation`: o data source apontado. */
  relationDataSourceId?: string | null
  /** Para `unique_id`: o prefixo (ex.: "ORK"). */
  uniqueIdPrefix?: string | null
}

/** Referência a uma propriedade: o id é estável a renomeações; o nome serve para exibir. */
export interface NotionPropertyRef {
  id: string
  name: string
  type: string
}

export type NotionMappingField =
  'title' | 'status' | 'uniqueId' | 'project' | 'priority' | 'assignee'

export interface NotionMapping {
  title: NotionPropertyRef
  status: NotionPropertyRef
  uniqueId: NotionPropertyRef
  /** Relação das Tarefas com o banco de Projetos. */
  project: NotionPropertyRef
  priority?: NotionPropertyRef
  assignee?: NotionPropertyRef
}

export interface NotionWorkspaceConfig {
  projectsDataSource: { id: string; name: string }
  tasksDataSource: { id: string; name: string }
  mapping: NotionMapping
  updatedAt: string
}

/** O que o assistente envia ao salvar: ids dos bancos e, por campo, o id da propriedade. */
export interface NotionWorkspaceInput {
  projectsDataSourceId: string
  tasksDataSourceId: string
  mapping: Partial<Record<NotionMappingField, string | null>>
}

export interface NotionWorkspaceStatus {
  /** null = ainda não configurado. */
  config: NotionWorkspaceConfig | null
  /** checking (revalidando), ok, warning (avisos), broken (tarefas bloqueadas), unverified (sem rede/Notion). */
  health: 'checking' | 'ok' | 'warning' | 'broken' | 'unverified'
  messages: string[]
  /** Como o Notion está conectado (afeta quais bancos aparecem). */
  connection: 'oauth' | 'token' | null
}

export interface NotionDataSourceList {
  dataSources: NotionDataSourceSummary[]
  /** Truncado no limite de leitura. */
  truncated: boolean
  connection: 'oauth' | 'token' | null
}

export interface NotionTasksSchemaInfo {
  schema: { id: string; title: string; properties: NotionPropertySummary[] }
  /** Sugestão automática (pode faltar campos). */
  suggestion: Partial<NotionMapping>
  /** Campos obrigatórios sem nenhuma propriedade possível (ex.: sem `unique_id`). */
  missing: NotionMappingField[]
}

export interface NotionProjectPage {
  id: string
  title: string
  url: string | null
}

export interface NotionProjectChoice extends NotionProjectPage {
  /** Projeto local que já usa esta página (um projeto do Notion → um projeto local). */
  linkedTo: { projectId: string; name: string } | null
  /** Similaridade com o nome do projeto/repositório local (0..1). */
  similarity: number
}

export interface NotionTask {
  id: string
  url: string | null
  /** Ex.: "ORK-142". */
  displayId: string | null
  title: string
  /** `id` da opção (estável a renomeações), quando o Notion informa. */
  status: { id?: string | null; name: string; color: NotionColor } | null
  priority: { name: string; color: NotionColor } | null
  /** Nomes dos responsáveis (se mapeado). */
  assignees: string[]
}

export interface NotionTasksResult {
  tasks: NotionTask[]
  truncated: boolean
  fetchedAt: string
  fromCache: boolean
}

/** Resultado padrão das operações do Notion no renderer. */
export type NotionResult<T> =
  | { ok: true; value: T }
  | {
      ok: false
      error: {
        code: string
        message: string
        /** O usuário pode resolver reconectando o Notion (ex.: escolher mais páginas no OAuth). */
        canReconnect?: boolean
      }
    }

// ---------- Sinais das tarefas (Etapa 2D) ----------

/** Situação da parte do GitHub nos sinais. */
export type SignalsGitHubState =
  | 'ok'
  | 'disconnected'
  | 'no_repo'
  | 'enterprise'
  | 'no_access'
  | 'sso'
  | 'restricted'
  | 'rate_limited'
  | 'unverified'

export interface TaskSignalsResult {
  /** Por id da página da tarefa no Notion. */
  signals: Record<string, TaskSignals>
  github: SignalsGitHubState
  /** Branches locais lidas? (pasta/git indisponível → false) */
  local: boolean
  /** Avisos curtos em pt-BR (sem GitHub, sem acesso, detalhes indisponíveis...). */
  messages: string[]
  /** Link sugerido (autorizar SSO, pedir aprovação da organização). */
  action?: ProjectAction
  /** Tarefas cujo ID não tem prefixo (não dá para casar com branches/PRs). */
  tasksWithoutPrefix: number
  fetchedAt: string
}

// ---------- Quadro (Etapa 3A) ----------

export type CardSyncState = 'synced' | 'pending' | 'failed'

export interface BoardCard {
  taskId: string
  displayId: string | null
  title: string
  url: string | null
  status: { name: string; color: NotionColor } | null
  priority: { name: string; color: NotionColor } | null
  assignees: string[]
  /** `null` = "Sem etapa" (nenhuma etapa usa o status atual do Notion). */
  stageId: string | null
  blocked: boolean
  /** Automações pausadas nesta tarefa (3B). */
  automationPaused: boolean
  sync: { state: CardSyncState; message?: string }
}

export interface BoardView {
  projectId: string
  projectName: string
  /** `null` = quadro ainda não criado: use `setup`. */
  config: BoardConfig | null
  /** Sugestão do template padrão contra as opções reais (só quando `config` é null). */
  suggestion: BoardStage[] | null
  /** Opções atuais do status mapeado na 2C. */
  statusOptions: StatusOption[]
  /** Propriedades do banco de Tarefas elegíveis para "Etapa Orkio" (select) e "Bloqueada" (checkbox). */
  selectProperties: { id: string; name: string; options: StatusOption[] }[]
  checkboxProperties: { id: string; name: string }[]
  issues: StageIssue[]
  cards: BoardCard[]
  truncated: boolean
  pendingCount: number
  fetchedAt: string
}

export type OrkioStageChoice =
  | { mode: 'none' }
  | { mode: 'existing'; propertyId: string }
  /** Cria a propriedade select "Etapa Orkio" no banco de Tarefas (só com confirmação). */
  | { mode: 'create' }

export interface BoardSaveInput {
  stages: { id: string | null; name: string; notionStatusId: string }[]
  orkioStage: OrkioStageChoice
  /** Autoriza adicionar ao select "Etapa Orkio" as opções que faltam. */
  addMissingOptions: boolean
  blockedPropertyId: string | null
}

export interface BoardSyncEvent {
  projectId: string
  taskId: string
  state: CardSyncState
  stageId: string | null
  blocked: boolean
  message?: string
  canReconnect?: boolean
}

export interface BoardHistoryEntry {
  id: number
  at: string
  kind: string
  source: 'manual' | 'notion' | 'automation'
  fromStage: string | null
  toStage: string | null
  detail: Record<string, unknown> | null
}

// ---------- Fluxo do projeto (Etapa 3C) ----------

export interface ConfigEvent {
  id: number
  at: string
  /** Usuário do sistema operacional. */
  actor: string
  changes: string[]
}

export type FlowFileResult =
  { ok: true; content: unknown } | { ok: false; cancelled: boolean; message?: string }

// ---------- Automações (Etapa 3B) ----------

export interface AutomationStatus {
  /** "Pausar todas" ligado. */
  paused: boolean
  /** Situação do GitHub no último ciclo do projeto. */
  github: SignalsGitHubState | 'unknown'
  lastRunAt: string | null
  nextRunAt: string | null
  error: string | null
}

export interface BoardTaskRef {
  projectId: string
  taskId: string
}

// ---------- Projetos ----------

export interface ProjectRepo {
  /** Host da API: github.com (inclusive para aliases de SSH) ou o host do GitHub Enterprise. */
  host: string
  owner: string
  name: string
  /** Remote local que aponta para este repositório (ex.: origin). */
  remoteName: string
  defaultBranch: string | null
  visibility: 'public' | 'private' | 'internal' | 'unknown'
  /** `null` quando não foi possível verificar (ex.: GitHub Enterprise). */
  canPush: boolean | null
  archived: boolean
  /** Confirmado na API do GitHub com a conta conectada. */
  verified: boolean
}

/** Link externo oferecido junto de um erro/estado (sempre dentro da allowlist do main). */
export interface ProjectAction {
  label: string
  url: string
}

export type ProjectHealthState =
  | 'checking'
  | 'ok'
  | 'missing_folder'
  | 'not_a_repo'
  | 'repo_mismatch'
  | 'no_access'
  | 'github_disconnected'
  | 'unverified'
  | 'git_error'

export interface ProjectHealth {
  state: ProjectHealthState
  message?: string
  action?: ProjectAction
}

export interface ProjectNotice {
  code: 'archived' | 'no_push' | 'enterprise_unverified'
  message: string
}

export interface ProjectView {
  id: string
  name: string
  /** Só para exibição: o renderer nunca envia caminhos de volta ao main. */
  localPath: string
  repo: ProjectRepo | null
  createdAt: string
  updatedAt: string
  /** Estado local do git; `null` quando a pasta/repositório não está acessível. */
  local: { branch: string | null; dirty: boolean } | null
  health: ProjectHealth
  notices: ProjectNotice[]
  /** Projeto do Notion vinculado (página do banco de Projetos). */
  notionProject: { id: string; name: string } | null
}

export interface ProjectsListResult {
  projects: ProjectView[]
  /** Ex.: configuração corrompida recuperada, modo só leitura. */
  warning?: string
}

export interface RemoteCandidate {
  remoteName: string
  /** Host como aparece no remote. */
  host: string
  owner: string
  name: string
  /** `ssh-alias` e `enterprise` exigem confirmação do usuário de que é GitHub. */
  hostKind: 'github' | 'ssh-alias' | 'enterprise'
}

/** Pasta escolhida no diálogo do main, já analisada. As próximas chamadas usam `selectionId`. */
export interface ProjectSelection {
  selectionId: string
  rootPath: string
  folderName: string
  /** A pasta escolhida era uma subpasta; usamos a raiz do repositório. */
  resolvedFromSubfolder: boolean
  branch: string | null
  dirty: boolean
  candidates: RemoteCandidate[]
  suggestedRemote: string
}

export type ProjectErrorCode =
  | 'not_a_repo'
  | 'no_remote'
  | 'not_github'
  | 'git_not_found'
  | 'git_error'
  | 'github_disconnected'
  | 'no_access'
  | 'sso_required'
  | 'oauth_restricted'
  | 'host_unconfirmed'
  | 'selection_expired'
  | 'already_added'
  | 'repo_mismatch'
  | 'project_not_found'
  | 'invalid_name'
  | 'storage'
  | 'github_error'

export interface ProjectError {
  code: ProjectErrorCode
  message: string
  action?: ProjectAction
}

export type PickFolderResult =
  | { ok: true; selection: ProjectSelection }
  | { ok: false; cancelled: true }
  | { ok: false; cancelled: false; error: ProjectError }

export interface CreateProjectInput {
  selectionId: string
  remoteName: string
  /** O usuário confirmou que um host de alias/Enterprise é GitHub. */
  hostConfirmed: boolean
  name?: string
}

export type ProjectMutationResult =
  | { ok: true; project: ProjectView }
  | { ok: false; cancelled: true }
  | { ok: false; cancelled: false; error: ProjectError }

export interface BranchChangedEvent {
  projectId: string
  branch: string | null
}

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
  }
  /** Quadro kanban por projeto (Etapa 3A). */
  board: {
    get(projectId: string, options?: { force?: boolean }): Promise<NotionResult<BoardView>>
    save(projectId: string, input: BoardSaveInput): Promise<NotionResult<BoardView>>
    move(projectId: string, taskId: string, stageId: string): Promise<NotionResult<BoardCard>>
    setBlocked(
      projectId: string,
      taskId: string,
      blocked: boolean
    ): Promise<NotionResult<BoardCard>>
    history(projectId: string, taskId: string): Promise<NotionResult<BoardHistoryEntry[]>>
    /** Tenta agora as escritas pendentes. */
    retryNow(): Promise<void>
    onSyncChanged(listener: (event: BoardSyncEvent) => void): () => void
    setAutomationPaused(
      projectId: string,
      taskId: string,
      paused: boolean
    ): Promise<NotionResult<BoardCard>>
    /** O quadro mudou por automação (recarregar). */
    onChanged(listener: (event: { projectId: string }) => void): () => void
    /** Pedido para abrir uma tarefa (clique na notificação). */
    onOpenTask(listener: (event: BoardTaskRef) => void): () => void
  }
  /** Editor do fluxo (3C): etapas + automações. */
  flow: {
    /** Valida de novo no main e salva; tarefas de etapas removidas vão para o destino escolhido. */
    save(projectId: string, draft: FlowDraft): Promise<NotionResult<BoardView>>
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
  /** Claude Code (4A): CLI do usuário rodando a tarefa num worktree isolado. */
  claude: {
    /** Instalado, versão e login (nunca credenciais). `force` detecta de novo. */
    status(options?: { force?: boolean }): Promise<ClaudeCodeStatus>
    /** Execuções e ambiente da tarefa (local, sem rede). */
    state(projectId: string, taskId: string): Promise<ClaudeResult<TaskRunsState>>
    /** Briefing do Notion (editável) e a branch que será usada. Não cria nada. */
    prepare(projectId: string, taskId: string): Promise<ClaudeResult<RunPreparation>>
    /** Cria/reutiliza o worktree e inicia (ou enfileira) a execução. */
    start(request: StartRunRequest): Promise<ClaudeResult<TaskRunsState>>
    cancel(runId: string): Promise<void>
    answerPermission(runId: string, requestId: string, answer: PermissionAnswer): Promise<void>
    answerQuestion(runId: string, requestId: string, answers: Record<string, string>): Promise<void>
    readLog(runId: string): Promise<RunLogEvent[]>
    /** Remove o worktree (a branch fica). Com mudanças pendentes, exige `force`. */
    cleanup(projectId: string, taskId: string, force: boolean): Promise<ClaudeResult<TaskRunsState>>
    openEditor(projectId: string, taskId: string, editor: EditorId): Promise<ClaudeResult<null>>
    diff(
      projectId: string,
      taskId: string
    ): Promise<ClaudeResult<{ diff: string; truncated: boolean; untracked: string[] }>>
    /** Comandos/skills instalados (usuário, projeto, plugins). Só metadados; recarrega a cada chamada. */
    catalog(projectId: string, taskId: string): Promise<ClaudeResult<CatalogGroup[]>>
    /** Contexto do projeto: instruções + páginas de referência do Notion (ids e nomes). */
    getContext(projectId: string): Promise<ClaudeResult<ProjectClaudeContext>>
    saveContext(
      projectId: string,
      context: ProjectClaudeContext
    ): Promise<ClaudeResult<ProjectClaudeContext>>
    /** Busca páginas do Notion por título (para escolher referências). */
    searchPages(query: string): Promise<ClaudeResult<{ id: string; name: string }[]>>
    /** Documentos alterados no ambiente (candidatos) e artefatos anexados à tarefa. */
    artifacts(
      projectId: string,
      taskId: string
    ): Promise<ClaudeResult<{ candidates: ArtifactCandidate[]; attached: ArtifactView[] }>>
    /** Anexa um documento commitado (caminho relativo da lista de candidatos). */
    attachArtifact(
      projectId: string,
      taskId: string,
      path: string,
      runId: string | null
    ): Promise<ClaudeResult<ArtifactView>>
    /** Publica no Notion (seção no fim da página da tarefa ou subpágina). */
    publishArtifact(
      projectId: string,
      artifactId: string,
      mode: ArtifactPublishMode
    ): Promise<ClaudeResult<{ artifact: ArtifactView; url: string | null }>>
    /** Assina os eventos das execuções. Devolve a função para cancelar a inscrição. */
    onRunEvent(listener: (message: RunEventMessage) => void): () => void
  }
  /** Branches e PRs ligadas às tarefas de um projeto pelo ID (só leitura). */
  signals: {
    get(projectId: string, options?: { force?: boolean }): Promise<NotionResult<TaskSignalsResult>>
  }
  /** Bancos do Notion (Projetos/Tarefas), vínculo com projetos locais e tarefas (só leitura). */
  notionWorkspace: {
    /** Estado da configuração; na primeira chamada revalida o schema no Notion. */
    getStatus(): Promise<NotionWorkspaceStatus>
    revalidate(): Promise<NotionWorkspaceStatus>
    listDataSources(query?: string): Promise<NotionResult<NotionDataSourceList>>
    getTasksSchema(
      tasksDataSourceId: string,
      projectsDataSourceId: string
    ): Promise<NotionResult<NotionTasksSchemaInfo>>
    save(input: NotionWorkspaceInput): Promise<NotionResult<NotionWorkspaceStatus>>
    /** Esquece os bancos e os vínculos (nada muda no Notion). */
    clear(): Promise<NotionResult<NotionWorkspaceStatus>>
    listProjectChoices(
      projectId: string,
      options?: { force?: boolean }
    ): Promise<NotionResult<{ choices: NotionProjectChoice[]; truncated: boolean }>>
    link(projectId: string, pageId: string): Promise<NotionResult<{ id: string; name: string }>>
    unlink(projectId: string): Promise<NotionResult<null>>
    listTasks(
      projectId: string,
      options?: { force?: boolean }
    ): Promise<NotionResult<NotionTasksResult>>
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
  /** Abre um link no navegador padrão. Só domínios da allowlist do main são aceitos. */
  openExternal(url: string): Promise<boolean>
}

export const NOTION_TOKEN_DOCS_URL =
  'https://developers.notion.com/guides/get-started/personal-access-tokens'

export const CLAUDE_CODE_DOCS_URL = 'https://code.claude.com/docs/en/setup'

export const GITHUB_TOKEN_DOCS_URL =
  'https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens#creating-a-fine-grained-personal-access-token'
