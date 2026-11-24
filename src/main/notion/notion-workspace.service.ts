/**
 * Bancos do Notion do Orkio: escolha dos data sources de Projetos/Tarefas, mapeamento de
 * propriedades, vínculo projeto local ↔ página de Projetos e leitura (só leitura) das tarefas.
 *
 * Roda no main. Fala com o Notion só via `NotionWorkspaceApi` (fornecida pelo NotionConnector,
 * que guarda o token). Salva no ConfigStore apenas ids e nomes, nunca conteúdo de páginas.
 */
import type { StatusOption } from '../../shared/board'
import type { OrkioConfig } from '../config/orkio-config'
import { type NotionListPage, type NotionQueryOptions } from '../connectors/notion/notion.client'
import {
  REQUIRED_FIELDS,
  checkMapping,
  fieldLabel,
  nameSimilarity,
  parseDataSource,
  parseDataSourceSummary,
  parseProjectPage,
  parseTaskPage,
  relationIds,
  simplePropertyValues,
  type SimplePropertyValue,
  sameId,
  suggestMapping,
  toRef,
  type NotionDataSourceSchema
} from '../connectors/notion/notion.schema'
import { ConfigReadOnlyError, type ConfigStore } from '../storage/config-store'
import type {
  NotionDataSourceList,
  NotionDataSourceSummary,
  NotionMapping,
  NotionMappingField,
  NotionProjectChoice,
  NotionProjectPage,
  NotionPropertySummary,
  NotionTask,
  NotionTaskHit,
  NotionTaskSearchResult,
  NotionTasksResult,
  NotionTasksSchemaInfo,
  NotionWorkspaceConfig,
  NotionWorkspaceInput,
  NotionWorkspaceStatus
} from '../../shared/notion'
import type { Result } from '../../shared/result'
import { projectById } from '../config/queries'
import { isApiError } from '../net/http'
import { canReconnect } from '../../shared/notion-errors'

/** O que o serviço precisa do conector do Notion (o token fica lá dentro). */
export interface NotionWorkspaceApi {
  connectionMethod(): Promise<'oauth' | 'token' | null>
  searchDataSources(options?: {
    query?: string
    startCursor?: string | null
  }): Promise<NotionListPage>
  getDataSource(id: string): Promise<unknown>
  queryDataSource(id: string, options?: NotionQueryOptions): Promise<NotionListPage>
  /** Pessoa do Notion dona da conexão; `null` se a conexão é de um bot do workspace. */
  currentPersonId(): Promise<string | null>
}

export interface NotionWorkspaceDeps {
  store: ConfigStore<OrkioConfig>
  notion: NotionWorkspaceApi
  now?: () => Date
  /** TTL do cache em memória de tarefas e projetos do Notion. */
  cacheTtlMs?: number
}

/** Limite de leitura (itens) por lista: 5 páginas de 100. */
export const NOTION_READ_LIMIT = 500
export const NOTION_CACHE_TTL_MS = 60_000

export const WORKSPACE_MESSAGES = {
  notConfigured: 'Configure os bancos do Notion antes de continuar.',
  notLinked: 'Vincule este projeto a um projeto do Notion para ver as tarefas.',
  broken: 'O mapeamento das Tarefas do Notion precisa ser revisto antes de ler tarefas.',
  sameDataSource: 'Escolha bancos diferentes para Projetos e Tarefas.',
  projectNotFound: 'Projeto não encontrado. Atualize a lista.',
  pageNotFound: 'Esse projeto do Notion não está mais no banco de Projetos. Atualize a lista.',
  alreadyLinked: (name: string) => `Esse projeto do Notion já está vinculado a “${name}”.`,
  readOnly: 'As configurações estão em modo só leitura. Atualize o Orkio para salvar mudanças.',
  storage: 'Não foi possível salvar a configuração. Tente novamente.',
  unknown: 'Algo deu errado ao falar com o Notion. Tente novamente.',
  invalidSchema: 'O Notion devolveu um banco em formato inesperado. Tente novamente.',
  notConnected: 'Conecte o Notion para usar os bancos de Projetos e Tarefas.',
  noAssignee:
    'Mapeie o campo Responsável (Pessoas) das Tarefas: o Orkio mostra só as ' +
    'tarefas em que você é responsável.',
  noPerson:
    'Não deu para saber quem é você no Notion: esta conexão é de uma integração do workspace. ' +
    'Conecte com “Entrar com Notion” para ver as suas tarefas.'
} as const

type Err = Extract<Result<never>, { ok: false }>['error']

class WorkspaceError extends Error {
  constructor(readonly info: Err) {
    super(info.message)
    this.name = 'WorkspaceError'
  }
}

export interface CachedTasks {
  tasks: NotionTask[]
  /** Valores select/status/checkbox por id da página e da propriedade. */
  values: Record<string, Record<string, SimplePropertyValue>>
  truncated: boolean
  fetchedAt: string
}

interface CacheEntry<T> {
  value: T
  expiresAt: number
}

export class NotionWorkspaceService {
  private readonly now: () => Date
  private readonly ttl: number
  private status: NotionWorkspaceStatus | null = null
  private checking: Promise<NotionWorkspaceStatus> | null = null
  private readonly tasksCache = new Map<string, CacheEntry<CachedTasks>>()
  private projectsCache: CacheEntry<{ pages: NotionProjectPage[]; truncated: boolean }> | null =
    null
  private configVersion = 0

  constructor(private readonly deps: NotionWorkspaceDeps) {
    this.now = deps.now ?? (() => new Date())
    this.ttl = deps.cacheTtlMs ?? NOTION_CACHE_TTL_MS
  }

  // ---------- Estado e revalidação ----------

  /**
   * Estado atual; na primeira chamada revalida o schema no Notion. Se a conexão do Notion mudou
   * desde a última revalidação (ex.: conectou depois de abrir o app), revalida de novo: o estado
   * guardado diria "Conecte o Notion" com o Notion já conectado.
   */
  async getStatus(): Promise<NotionWorkspaceStatus> {
    if (!this.status) return this.revalidate()
    const connection = await this.deps.notion.connectionMethod().catch(() => null)
    return connection === this.status.connection ? this.status : this.revalidate()
  }

  /**
   * Relê o schema das Tarefas e confere o mapeamento salvo: renomeação → aviso (e nome
   * atualizado); propriedade apagada ou com outro tipo → `broken` (tarefas bloqueadas).
   * Falha de rede → `unverified`, sem apagar nada.
   */
  revalidate(): Promise<NotionWorkspaceStatus> {
    this.checking ??= this.runRevalidation().finally(() => {
      this.checking = null
    })
    return this.checking
  }

  private async runRevalidation(): Promise<NotionWorkspaceStatus> {
    const connection = await this.deps.notion.connectionMethod().catch(() => null)
    const config = this.config().notion
    if (!config) return this.setStatus({ config: null, health: 'ok', messages: [], connection })
    if (!connection) {
      return this.setStatus({
        config,
        health: 'unverified',
        messages: [WORKSPACE_MESSAGES.notConnected],
        connection
      })
    }

    let schema: NotionDataSourceSchema
    try {
      // O banco de Projetos também precisa continuar acessível.
      await this.deps.notion.getDataSource(config.projectsDataSource.id)
      schema = await this.loadSchema(config.tasksDataSource.id)
    } catch (e) {
      const info = toError(e)
      const definitive = info.code === 'not_found' || info.code === 'forbidden'
      return this.setStatus({
        config,
        health: definitive ? 'broken' : 'unverified',
        messages: [
          definitive
            ? `Não foi possível abrir os bancos “${config.projectsDataSource.name}”/“${config.tasksDataSource.name}” no Notion. ${info.message}`
            : info.message
        ],
        connection
      })
    }

    const check = checkMapping(config.mapping, schema, config.projectsDataSource.id)
    let current = config
    const changed =
      JSON.stringify(check.mapping) !== JSON.stringify(config.mapping) ||
      schema.title !== config.tasksDataSource.name
    if (changed && check.errors.length === 0) {
      current = {
        ...config,
        tasksDataSource: { id: config.tasksDataSource.id, name: schema.title },
        mapping: check.mapping
      }
      try {
        await this.deps.store.update((c) => ({ ...c, notion: current }))
      } catch {
        // Atualizar nomes é conveniência; o aviso continua valendo.
      }
    }

    const health = check.errors.length > 0 ? 'broken' : check.warnings.length > 0 ? 'warning' : 'ok'
    return this.setStatus({
      config: current,
      health,
      messages: [...check.errors, ...check.warnings],
      connection
    })
  }

  private setStatus(status: NotionWorkspaceStatus): NotionWorkspaceStatus {
    this.status = status
    return status
  }

  // ---------- Assistente ----------

  /** Data sources compartilhados com o Orkio (até NOTION_READ_LIMIT). */
  async listDataSources(query?: string): Promise<Result<NotionDataSourceList>> {
    return this.wrap(async () => {
      const connection = await this.deps.notion.connectionMethod()
      const { items, truncated } = await this.paginate((cursor) =>
        this.deps.notion.searchDataSources(
          query ? { query, startCursor: cursor } : { startCursor: cursor }
        )
      )
      const dataSources = items
        .map(parseDataSourceSummary)
        .filter((d): d is NotionDataSourceSummary => d !== null)
      return { dataSources, truncated, connection }
    })
  }

  /** Schema das Tarefas + sugestão de mapeamento (relação deve apontar para Projetos). */
  async getTasksSchema(
    tasksDataSourceId: string,
    projectsDataSourceId: string
  ): Promise<Result<NotionTasksSchemaInfo>> {
    return this.wrap(async () => {
      if (sameId(tasksDataSourceId, projectsDataSourceId)) {
        throw new WorkspaceError({ code: 'invalid', message: WORKSPACE_MESSAGES.sameDataSource })
      }
      const schema = await this.loadSchema(tasksDataSourceId)
      const { mapping, missing } = suggestMapping(schema, projectsDataSourceId)
      return { schema, suggestion: mapping, missing }
    })
  }

  /** Valida no Notion e salva a configuração. Trocar o banco de Projetos desfaz os vínculos. */
  async saveConfig(input: NotionWorkspaceInput): Promise<Result<NotionWorkspaceStatus>> {
    return this.wrap(async () => {
      if (sameId(input.tasksDataSourceId, input.projectsDataSourceId)) {
        throw new WorkspaceError({ code: 'invalid', message: WORKSPACE_MESSAGES.sameDataSource })
      }
      const projectsSchema = await this.loadSchema(input.projectsDataSourceId)
      const tasksSchema = await this.loadSchema(input.tasksDataSourceId)

      const partial: Partial<NotionMapping> = {}
      for (const [field, propertyId] of Object.entries(input.mapping) as [
        NotionMappingField,
        string | null | undefined
      ][]) {
        if (!propertyId) continue
        const property = tasksSchema.properties.find((p) => p.id === propertyId)
        if (!property) {
          throw new WorkspaceError({
            code: 'invalid',
            message: `A propriedade escolhida para ${fieldLabel(field)} não existe mais. Recarregue o banco.`
          })
        }
        partial[field] = toRef(property)
      }
      const missing = REQUIRED_FIELDS.filter((f) => !partial[f])
      if (missing.length > 0) {
        throw new WorkspaceError({
          code: 'invalid',
          message: `Escolha a propriedade de ${missing.map(fieldLabel).join(', ')}.`
        })
      }
      const check = checkMapping(partial as NotionMapping, tasksSchema, projectsSchema.id)
      if (check.errors.length > 0) {
        throw new WorkspaceError({ code: 'invalid', message: check.errors.join(' ') })
      }
      // Tipos errados em opcionais viram erro aqui (no assistente, a escolha é explícita).
      if (check.warnings.length > 0) {
        throw new WorkspaceError({ code: 'invalid', message: check.warnings.join(' ') })
      }
      const ids = Object.values(check.mapping).map((r) => r.id)
      if (new Set(ids).size !== ids.length) {
        throw new WorkspaceError({
          code: 'invalid',
          message: 'Use uma propriedade diferente para cada campo.'
        })
      }

      const previous = this.config().notion
      const config: NotionWorkspaceConfig = {
        projectsDataSource: { id: projectsSchema.id, name: projectsSchema.title },
        tasksDataSource: { id: tasksSchema.id, name: tasksSchema.title },
        mapping: check.mapping,
        updatedAt: this.now().toISOString()
      }
      const projectsChanged =
        !previous || !sameId(previous.projectsDataSource.id, config.projectsDataSource.id)
      await this.save((c) => ({
        ...c,
        notion: config,
        projects: projectsChanged
          ? c.projects.map((p) => ({ ...p, notionProject: null }))
          : c.projects
      }))
      this.invalidate()
      const connection = await this.deps.notion.connectionMethod().catch(() => null)
      return this.setStatus({ config, health: 'ok', messages: [], connection })
    })
  }

  // ---------- Vínculo projeto local ↔ Notion ----------

  /** Páginas do banco de Projetos, ordenadas pela semelhança com o projeto local. */
  async listProjectChoices(
    projectId: string,
    options: { force?: boolean } = {}
  ): Promise<Result<{ choices: NotionProjectChoice[]; truncated: boolean }>> {
    return this.wrap(async () => {
      const config = this.requireConfig()
      const project = this.findProject(projectId)
      const { pages, truncated } = await this.projectPages(config, options.force === true)
      const names = [project.name, project.repo?.name].filter((n): n is string => Boolean(n))
      const owners = new Map(
        this.config()
          .projects.filter((p) => p.notionProject)
          .map((p) => [p.notionProject!.id.replace(/-/g, ''), p])
      )
      const choices = pages
        .map((page): NotionProjectChoice => {
          const owner = owners.get(page.id.replace(/-/g, ''))
          return {
            ...page,
            linkedTo: owner ? { projectId: owner.id, name: owner.name } : null,
            similarity: Math.max(0, ...names.map((n) => nameSimilarity(n, page.title)))
          }
        })
        .sort((a, b) => b.similarity - a.similarity || a.title.localeCompare(b.title, 'pt-BR'))
      return { choices, truncated }
    })
  }

  async link(projectId: string, pageId: string): Promise<Result<{ id: string; name: string }>> {
    return this.wrap(async () => {
      const config = this.requireConfig()
      this.findProject(projectId)
      let page = (await this.projectPages(config, false)).pages.find((p) => sameId(p.id, pageId))
      // A página pode ter sido criada há pouco: relê ignorando o cache.
      page ??= (await this.projectPages(config, true)).pages.find((p) => sameId(p.id, pageId))
      if (!page) {
        throw new WorkspaceError({ code: 'not_found', message: WORKSPACE_MESSAGES.pageNotFound })
      }
      const other = this.config().projects.find(
        (p) => p.id !== projectId && p.notionProject && sameId(p.notionProject.id, page.id)
      )
      if (other) {
        throw new WorkspaceError({
          code: 'already_linked',
          message: WORKSPACE_MESSAGES.alreadyLinked(other.name)
        })
      }
      const link = { id: page.id, name: page.title }
      await this.save((c) => ({
        ...c,
        projects: c.projects.map((p) => (p.id === projectId ? { ...p, notionProject: link } : p))
      }))
      this.dropTasksCache(projectId)
      return link
    })
  }

  async unlink(projectId: string): Promise<Result<null>> {
    return this.wrap(async () => {
      this.findProject(projectId)
      await this.save((c) => ({
        ...c,
        projects: c.projects.map((p) => (p.id === projectId ? { ...p, notionProject: null } : p))
      }))
      this.dropTasksCache(projectId)
      return null
    })
  }

  // ---------- Tarefas ----------

  /** Tarefas do projeto vinculado (relação contém a página), até NOTION_READ_LIMIT. Cache de 60 s. */
  async listTasks(
    projectId: string,
    options: { force?: boolean } = {}
  ): Promise<Result<NotionTasksResult>> {
    return this.wrap(async () => {
      const { value, fromCache } = await this.loadTasks(projectId, options.force === true)
      return {
        tasks: value.tasks,
        truncated: value.truncated,
        fetchedAt: value.fetchedAt,
        fromCache
      }
    })
  }

  /**
   * Busca no banco de Tarefas inteiro (qualquer responsável, qualquer projeto), por título ou pelo
   * número do ID (ORK-142 / 142). Texto vazio = as 20 editadas mais recentemente. Sem cache: é
   * uma consulta só (20 itens) a cada busca, que passa pela fila de rate limit do conector.
   */
  async searchTasks(query: string): Promise<Result<NotionTaskSearchResult>> {
    return this.wrap(async () => {
      const config = this.requireConfig()
      const status = await this.getStatus()
      const mapping = status.config?.mapping ?? config.mapping
      const text = query.trim()
      const number = /^(?:[A-Za-z]+-)?(\d{1,9})$/.exec(text)?.[1]
      const byTitle = { property: mapping.title.id, title: { contains: text } }
      const filter = !text
        ? null
        : number && mapping.uniqueId
          ? {
              or: [
                byTitle,
                { property: mapping.uniqueId.id, unique_id: { equals: Number(number) } }
              ]
            }
          : byTitle
      const page = await this.deps.notion.queryDataSource(config.tasksDataSource.id, {
        ...(filter ? { filter } : {}),
        sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }],
        pageSize: 20
      })
      const projects = this.config().projects
      const tasks: NotionTaskHit[] = []
      for (const item of page.results) {
        const task = parseTaskPage(item, mapping)
        if (!task) continue
        const rel = relationIds(item, mapping.project.id)
        const local = projects.find(
          (p) => p.notionProject && rel.some((id) => sameId(id, p.notionProject!.id))
        )
        tasks.push({ ...task, projectId: local?.id ?? null, projectName: local?.name ?? null })
      }
      return { tasks }
    })
  }

  /**
   * Para o quadro (3A): tarefas + valores select/status/checkbox por página (só em memória),
   * o mapeamento em uso e o data source das Tarefas.
   */
  async boardTasks(
    projectId: string,
    options: { force?: boolean } = {}
  ): Promise<
    Result<
      CachedTasks & {
        fromCache: boolean
        mapping: NotionMapping
        tasksDataSourceId: string
      }
    >
  > {
    return this.wrap(async () => {
      const { value, fromCache } = await this.loadTasks(projectId, options.force === true)
      const config = this.requireConfig()
      const mapping = this.status?.config?.mapping ?? config.mapping
      return { ...value, fromCache, mapping, tasksDataSourceId: config.tasksDataSource.id }
    })
  }

  /** Opções atuais do status mapeado (relê o schema das Tarefas). */
  async statusOptions(): Promise<
    Result<{
      options: StatusOption[]
      statusType: string
      properties: NotionPropertySummary[]
    }>
  > {
    return this.wrap(async () => {
      const config = this.requireConfig()
      const schema = await this.loadSchema(config.tasksDataSource.id)
      const property = schema.properties.find((p) => p.id === config.mapping.status.id)
      if (!property) {
        throw new WorkspaceError({
          code: 'broken',
          message: WORKSPACE_MESSAGES.broken,
          fixAt: 'integrations'
        })
      }
      return {
        options: (property.options ?? []).map((o) => ({ id: o.id, name: o.name, color: o.color })),
        statusType: property.type,
        properties: schema.properties
      }
    })
  }

  /**
   * Tarefas já em memória (mesmo vencidas), sem rede; `null` se nunca foram lidas. Para a Visão
   * geral (6D), que mostra ID/título sem chamar o Notion ao abrir.
   */
  cachedTasks(projectId: string): NotionTask[] | null {
    let best: CacheEntry<CachedTasks> | null = null
    for (const [key, entry] of this.tasksCache) {
      if (key.startsWith(`${projectId}:`) && key.endsWith(`:${this.configVersion}`)) best = entry
    }
    return best?.value.tasks ?? null
  }

  /** Saúde do mapeamento já conhecida (sem revalidar); `null` = ainda não verificada. */
  cachedHealth(): NotionWorkspaceStatus['health'] | null {
    return this.status?.health ?? null
  }

  /** Esquece as tarefas em cache de um projeto (ex.: depois de escrever no Notion). */
  invalidateTasks(projectId: string): void {
    this.dropTasksCache(projectId)
  }

  private async loadTasks(
    projectId: string,
    force: boolean
  ): Promise<{ value: CachedTasks; fromCache: boolean }> {
    const config = this.requireConfig()
    const project = this.findProject(projectId)
    if (!project.notionProject) {
      throw new WorkspaceError({ code: 'not_linked', message: WORKSPACE_MESSAGES.notLinked })
    }
    const status = await this.getStatus()
    if (status.health === 'broken') {
      throw new WorkspaceError({
        code: 'broken',
        message: [WORKSPACE_MESSAGES.broken, ...status.messages].join(' '),
        fixAt: 'integrations'
      })
    }
    const mapping = status.config?.mapping ?? config.mapping
    const assignee = mapping.assignee
    if (!assignee) {
      throw new WorkspaceError({
        code: 'broken',
        message: WORKSPACE_MESSAGES.noAssignee,
        fixAt: 'integrations'
      })
    }
    // Sempre só as tarefas da pessoa logada no Notion (nunca as de todo o projeto).
    const personId = await this.deps.notion.currentPersonId()
    if (!personId) {
      throw new WorkspaceError({
        code: 'no_person',
        message: WORKSPACE_MESSAGES.noPerson,
        canReconnect: true,
        fixAt: 'integrations'
      })
    }

    const key = `${projectId}:${project.notionProject.id}:${personId}:${this.configVersion}`
    const cached = this.tasksCache.get(key)
    if (!force && cached && cached.expiresAt > this.now().getTime()) {
      return { value: cached.value, fromCache: true }
    }

    const pageId = project.notionProject.id
    const { items, truncated } = await this.paginate((cursor) =>
      this.deps.notion.queryDataSource(config.tasksDataSource.id, {
        filter: {
          and: [
            { property: mapping.project.id, relation: { contains: pageId } },
            { property: assignee.id, people: { contains: personId } }
          ]
        },
        sorts: [{ timestamp: 'created_time', direction: 'descending' }],
        startCursor: cursor
      })
    )
    const tasks: NotionTask[] = []
    const values: Record<string, Record<string, SimplePropertyValue>> = {}
    for (const item of items) {
      const task = parseTaskPage(item, mapping)
      if (!task) continue
      tasks.push(task)
      values[task.id] = simplePropertyValues(item)
    }
    const value: CachedTasks = { tasks, values, truncated, fetchedAt: this.now().toISOString() }
    this.tasksCache.set(key, { value, expiresAt: this.now().getTime() + this.ttl })
    return { value, fromCache: false }
  }

  // ---------- Auxiliares ----------

  private config(): OrkioConfig {
    return this.deps.store.get()
  }

  private requireConfig(): NotionWorkspaceConfig {
    const config = this.config().notion
    if (!config) {
      throw new WorkspaceError({
        code: 'not_configured',
        message: WORKSPACE_MESSAGES.notConfigured,
        fixAt: 'integrations'
      })
    }
    return config
  }

  private findProject(projectId: string) {
    const project = projectById(this.config(), projectId)
    if (!project) {
      throw new WorkspaceError({ code: 'not_found', message: WORKSPACE_MESSAGES.projectNotFound })
    }
    return project
  }

  private async loadSchema(id: string): Promise<NotionDataSourceSchema> {
    const schema = parseDataSource(await this.deps.notion.getDataSource(id))
    if (!schema) {
      throw new WorkspaceError({ code: 'unexpected', message: WORKSPACE_MESSAGES.invalidSchema })
    }
    return schema
  }

  private async projectPages(
    config: NotionWorkspaceConfig,
    force: boolean
  ): Promise<{ pages: NotionProjectPage[]; truncated: boolean }> {
    const now = this.now().getTime()
    if (!force && this.projectsCache && this.projectsCache.expiresAt > now) {
      return this.projectsCache.value
    }
    const { items, truncated } = await this.paginate((cursor) =>
      this.deps.notion.queryDataSource(config.projectsDataSource.id, { startCursor: cursor })
    )
    const pages = items.map(parseProjectPage).filter((p): p is NotionProjectPage => p !== null)
    const value = { pages, truncated }
    this.projectsCache = { value, expiresAt: now + this.ttl }
    return value
  }

  /** Lê páginas até o fim ou até NOTION_READ_LIMIT itens. */
  private async paginate(
    fetchPage: (cursor: string | null) => Promise<NotionListPage>
  ): Promise<{ items: unknown[]; truncated: boolean }> {
    const items: unknown[] = []
    let cursor: string | null = null
    do {
      const page = await fetchPage(cursor)
      items.push(...page.results)
      cursor = page.nextCursor
    } while (cursor && items.length < NOTION_READ_LIMIT)
    return {
      items: items.slice(0, NOTION_READ_LIMIT),
      truncated: cursor !== null || items.length > NOTION_READ_LIMIT
    }
  }

  private async save(mutate: (c: OrkioConfig) => OrkioConfig): Promise<void> {
    try {
      await this.deps.store.update(mutate)
    } catch (e) {
      throw new WorkspaceError({
        code: 'storage',
        message:
          e instanceof ConfigReadOnlyError
            ? WORKSPACE_MESSAGES.readOnly
            : WORKSPACE_MESSAGES.storage
      })
    }
  }

  private invalidate(): void {
    this.configVersion++
    this.tasksCache.clear()
    this.projectsCache = null
  }

  private dropTasksCache(projectId: string): void {
    for (const key of this.tasksCache.keys()) {
      if (key.startsWith(`${projectId}:`)) this.tasksCache.delete(key)
    }
  }

  private async wrap<T>(run: () => Promise<T>): Promise<Result<T>> {
    try {
      return { ok: true, value: await run() }
    } catch (e) {
      const error = toError(e)
      // O método só conta para erros da API (404/403 em OAuth).
      const method = isApiError(e, 'notion')
        ? await this.deps.notion.connectionMethod().catch(() => null)
        : null
      if (canReconnect(error.code, method, 'read')) {
        return { ok: false, error: { ...error, canReconnect: true } }
      }
      return { ok: false, error }
    }
  }
}

function toError(e: unknown): Err {
  if (e instanceof WorkspaceError) return e.info
  if (isApiError(e, 'notion')) return { code: e.code, message: e.message }
  return { code: 'unexpected', message: WORKSPACE_MESSAGES.unknown }
}
