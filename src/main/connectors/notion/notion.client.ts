/**
 * Cliente HTTP mínimo da API do Notion. Roda só no processo main.
 *
 * Usa fetch nativo em vez de @notionhq/client: poucos endpoints, e assim controlamos timeout,
 * Retry-After, fila de rate limit e mensagens de erro sem dependência extra.
 */

import {
  ApiError,
  defaultSleep,
  fetchWithTimeout,
  genericStatusError,
  rateLimitedError,
  readJson,
  sendWithShortRetry,
  unexpectedError,
  type HttpResponse
} from '../../net/http'
import { httpsUrlOrNull, isRecord, parseRetryAfterMs, stringOrNull } from '../../net/parse'
import { RateQueue, backoffMs } from '../../net/rate-queue'
import { NOTION_VERSION } from '../../../shared/site-contract'

/** Versão da API do Notion: a mesma do site (contrato em `shared/site-contract.ts`). */
export { NOTION_VERSION }

export const NOTION_API_BASE_URL = 'https://api.notion.com/v1'
export const NOTION_REQUEST_TIMEOUT_MS = 10_000
/** Leituras de dados (bancos/tarefas): até 3 novas tentativas em 429, esperando até 30 s. */
export const NOTION_DATA_MAX_RETRIES = 3
export const NOTION_DATA_MAX_WAIT_MS = 30_000
/** Máximo aceito pela API em `page_size`. */
export const NOTION_MAX_PAGE_SIZE = 100

const NOTION = { service: 'notion' } as const

/** Dono do token, normalizado a partir de GET /v1/users/me. */
export interface NotionSelf {
  id: string
  type: 'person' | 'bot'
  name: string | null
  avatarUrl: string | null
  /** Para bots com dono do tipo usuário. */
  ownerName: string | null
  ownerAvatarUrl: string | null
  workspaceName: string | null
  /**
   * Pessoa do Notion dona da conexão (id de usuário `person`): o próprio usuário num PAT, ou o
   * dono do bot (OAuth/integração de usuário). `null` quando o bot é do workspace.
   */
  personId: string | null
}

export interface NotionClientDeps {
  fetch?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  timeoutMs?: number
  /** Fila das leituras de dados (~3 req/s do Notion). */
  queue?: RateQueue
  random?: () => number
}

/** Uma página de resultados da API (objetos crus; quem chama interpreta). */
export interface NotionListPage {
  results: unknown[]
  nextCursor: string | null
}

export interface NotionQueryOptions {
  filter?: unknown
  sorts?: unknown[]
  startCursor?: string | null
  pageSize?: number
}

export interface NotionClient {
  getSelf(token: string): Promise<NotionSelf>
  /** POST /v1/search filtrando por data sources compartilhados com a integração. */
  searchDataSources(
    token: string,
    options?: { query?: string; startCursor?: string | null }
  ): Promise<NotionListPage>
  /** GET /v1/data_sources/{id} (schema). */
  getDataSource(token: string, id: string): Promise<unknown>
  /** POST /v1/data_sources/{id}/query. */
  queryDataSource(token: string, id: string, options?: NotionQueryOptions): Promise<NotionListPage>
  /**
   * PATCH /v1/pages/{id} com `{ properties }` (ex.: `{ "<id>": { status: { name } } }`).
   * Exige a capacidade "Update content" da conexão (sem ela: 403).
   */
  updatePage(token: string, id: string, properties: Record<string, unknown>): Promise<void>
  /** PATCH /v1/data_sources/{id} com `{ properties }` (adicionar/alterar propriedades do schema). */
  updateDataSource(token: string, id: string, properties: Record<string, unknown>): Promise<unknown>
  /** GET /v1/blocks/{id}/children (conteúdo de uma página; paginado). */
  getBlockChildren(token: string, id: string, startCursor?: string | null): Promise<NotionListPage>
  /** Busca páginas (não data sources) por título. */
  searchPages(token: string, query: string): Promise<NotionListPage>
  /**
   * Cria uma subpágina com conteúdo em markdown (POST /v1/pages, `markdown_version: v2`).
   * Precisa da capacidade "Insert content".
   */
  createChildPage(
    token: string,
    parentPageId: string,
    title: string,
    markdown: string
  ): Promise<{ id: string; url: string | null }>
  /**
   * Acrescenta markdown no fim de uma página (PATCH /v1/pages/{id}/markdown, `insert_content`
   * com `position: end`). Precisa da capacidade "Insert content".
   */
  appendMarkdown(token: string, pageId: string, markdown: string): Promise<void>
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH'
  body?: unknown
  /** Contexto da mensagem de 403/404. */
  kind?: 'self' | 'data' | 'write' | 'insert'
}

export function createNotionClient(deps: NotionClientDeps = {}): NotionClient {
  const sleep = deps.sleep ?? defaultSleep
  const timeoutMs = deps.timeoutMs ?? NOTION_REQUEST_TIMEOUT_MS

  const queue = deps.queue ?? new RateQueue({ concurrency: 2, minIntervalMs: 350 })
  const random = deps.random ?? Math.random

  function send(path: string, token: string, options: RequestOptions): Promise<HttpResponse> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      'Notion-Version': NOTION_VERSION,
      Accept: 'application/json'
    }
    if (options.body !== undefined) headers['Content-Type'] = 'application/json'
    return fetchWithTimeout(
      {
        url: `${NOTION_API_BASE_URL}${path}`,
        method: options.method ?? 'GET',
        headers,
        ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {})
      },
      { ...NOTION, fetch: deps.fetch, timeoutMs }
    )
  }

  /** GET /users/me: fora da fila, uma nova tentativa em 429 se a espera for curta. */
  async function request(path: string, token: string): Promise<unknown> {
    const { response, wait } = await sendWithShortRetry(
      () => send(path, token, { kind: 'self' }),
      (r) => {
        if (r.status !== 429) return null
        const waitMs = parseRetryAfterMs(r.headers.get('retry-after'))
        return { ms: waitMs ?? Number.POSITIVE_INFINITY, waitMs }
      },
      sleep
    )
    if (wait) throw rateLimitedError(NOTION, wait.waitMs)
    if (!response.ok) throw errorForStatus(response.status, 'self')
    return readJson(response, NOTION)
  }

  /**
   * Leituras de dados: passam pela fila (concorrência baixa + intervalo mínimo). Em 429, pausa a
   * fila inteira pelo Retry-After (ou backoff exponencial) e tenta de novo, até 3 vezes.
   */
  async function dataRequest(
    path: string,
    token: string,
    options: RequestOptions
  ): Promise<unknown> {
    for (let attempt = 0; ; attempt++) {
      const kind = options.kind === 'write' || options.kind === 'insert' ? options.kind : 'data'
      const response = await queue.run(() => send(path, token, { ...options, kind }))
      if (response.ok) return readJson(response, NOTION)

      if (response.status === 429) {
        const retryAfter = parseRetryAfterMs(response.headers.get('retry-after'))
        const waitMs = retryAfter ?? backoffMs(attempt, random)
        if (attempt < NOTION_DATA_MAX_RETRIES && waitMs <= NOTION_DATA_MAX_WAIT_MS) {
          queue.pause(waitMs)
          continue
        }
        throw rateLimitedError(NOTION, waitMs)
      }

      throw errorForStatus(response.status, kind)
    }
  }

  return {
    async getSelf(token: string): Promise<NotionSelf> {
      const body = await request('/users/me', token)
      const parsed = parseSelf(body)
      if (!parsed) throw unexpected(200)
      return parsed
    },

    async searchDataSources(token, options = {}) {
      const body: Record<string, unknown> = {
        filter: { property: 'object', value: 'data_source' },
        sort: { timestamp: 'last_edited_time', direction: 'descending' },
        page_size: NOTION_MAX_PAGE_SIZE
      }
      if (options.query) body['query'] = options.query
      if (options.startCursor) body['start_cursor'] = options.startCursor
      return parseListPage(await dataRequest('/search', token, { method: 'POST', body }))
    },

    async getDataSource(token, id) {
      return dataRequest(`/data_sources/${encodeURIComponent(id)}`, token, { method: 'GET' })
    },

    async queryDataSource(token, id, options = {}) {
      const body: Record<string, unknown> = {
        page_size: Math.min(options.pageSize ?? NOTION_MAX_PAGE_SIZE, NOTION_MAX_PAGE_SIZE)
      }
      if (options.filter !== undefined) body['filter'] = options.filter
      if (options.sorts) body['sorts'] = options.sorts
      if (options.startCursor) body['start_cursor'] = options.startCursor
      const path = `/data_sources/${encodeURIComponent(id)}/query`
      return parseListPage(await dataRequest(path, token, { method: 'POST', body }))
    },

    async updatePage(token, id, properties) {
      await dataRequest(`/pages/${encodeURIComponent(id)}`, token, {
        method: 'PATCH',
        body: { properties },
        kind: 'write'
      })
    },

    async getBlockChildren(token, id, startCursor) {
      const query = new URLSearchParams({ page_size: String(NOTION_MAX_PAGE_SIZE) })
      if (startCursor) query.set('start_cursor', startCursor)
      return parseListPage(
        await dataRequest(`/blocks/${encodeURIComponent(id)}/children?${query}`, token, {
          method: 'GET'
        })
      )
    },

    async searchPages(token, query) {
      const body: Record<string, unknown> = {
        filter: { property: 'object', value: 'page' },
        sort: { timestamp: 'last_edited_time', direction: 'descending' },
        page_size: 50
      }
      if (query) body['query'] = query
      return parseListPage(await dataRequest('/search', token, { method: 'POST', body }))
    },

    async createChildPage(token, parentPageId, title, markdown) {
      const body = await dataRequest('/pages', token, {
        method: 'POST',
        body: {
          parent: { page_id: parentPageId },
          properties: { title: { title: [{ text: { content: title.slice(0, 2000) } }] } },
          markdown,
          markdown_version: 'v2'
        },
        kind: 'insert'
      })
      if (!isRecord(body) || typeof body['id'] !== 'string') throw unexpected(200)
      return { id: body['id'], url: stringOrNull(body['url']) }
    },

    async appendMarkdown(token, pageId, markdown) {
      await dataRequest(`/pages/${encodeURIComponent(pageId)}/markdown`, token, {
        method: 'PATCH',
        body: {
          markdown_version: 'v2',
          type: 'insert_content',
          insert_content: { content: markdown, position: { type: 'end' } }
        },
        kind: 'insert'
      })
    },

    async updateDataSource(token, id, properties) {
      return dataRequest(`/data_sources/${encodeURIComponent(id)}`, token, {
        method: 'PATCH',
        body: { properties },
        kind: 'write'
      })
    }
  }
}

/** Lista paginada da API: `{ results, has_more, next_cursor }`. */
export function parseListPage(body: unknown): NotionListPage {
  if (!isRecord(body) || !Array.isArray(body['results'])) throw unexpected(200)
  const nextCursor = body['has_more'] === true ? stringOrNull(body['next_cursor']) : null
  return { results: body['results'], nextCursor }
}

function errorForStatus(status: number, kind: 'self' | 'data' | 'write' | 'insert'): ApiError {
  if (kind === 'insert') {
    if (status === 403) {
      return new ApiError(
        'notion',
        'forbidden',
        'O Notion não deixou o Orkio publicar: a conexão precisa da capacidade “Insert content” ' +
          '(Inserir conteúdo) e acesso a esta página.',
        status
      )
    }
    if (status === 404) {
      return new ApiError(
        'notion',
        'not_found',
        'O Notion não encontrou a página da tarefa: ela foi apagada ou não está compartilhada com o Orkio.',
        status
      )
    }
    if (status === 400) {
      return new ApiError(
        'notion',
        'bad_request',
        'O Notion recusou o conteúdo (grande ou complexo demais). Tente como subpágina ou divida o documento.',
        status
      )
    }
  }
  if (kind === 'write') {
    if (status === 403) {
      return new ApiError(
        'notion',
        'forbidden',
        'O Notion não deixou o Orkio editar: a conexão precisa da capacidade “Update content” ' +
          '(Inserir/atualizar conteúdo) e acesso a esta página.',
        status
      )
    }
    if (status === 404) {
      return new ApiError(
        'notion',
        'not_found',
        'O Notion não encontrou a página: ela foi apagada ou não está mais compartilhada com o Orkio.',
        status
      )
    }
    if (status === 400) {
      return new ApiError(
        'notion',
        'bad_request',
        'O Notion recusou a alteração (a opção de status pode não existir mais). Revise o quadro.',
        status
      )
    }
    if (status === 409) {
      return new ApiError(
        'notion',
        'server',
        'O Notion detectou uma edição simultânea. Vamos tentar de novo.',
        status
      )
    }
  }
  if (status === 401) {
    return new ApiError(
      'notion',
      'unauthorized',
      'Token inválido ou revogado. Gere um novo token no Notion e cole aqui.',
      status
    )
  }
  if (kind === 'data' && status === 404) {
    return new ApiError(
      'notion',
      'not_found',
      'O Notion não encontrou esse conteúdo. Ele pode ter sido apagado ou não está mais ' +
        'compartilhado com o Orkio.',
      status
    )
  }
  if (kind === 'data' && status === 403) {
    return new ApiError(
      'notion',
      'forbidden',
      'O Orkio não tem permissão para ler esse conteúdo no Notion. Compartilhe-o com o Orkio.',
      status
    )
  }
  if (kind === 'data' && status === 400) {
    return new ApiError(
      'notion',
      'bad_request',
      'O Notion recusou a consulta. Revise o mapeamento dos bancos em Integrações.',
      status
    )
  }
  if (status === 403) {
    return new ApiError(
      'notion',
      'forbidden',
      'Este token não tem permissão para ler seu usuário no Notion. Verifique as capacidades do token.',
      status
    )
  }
  return genericStatusError(NOTION, status)
}

function unexpected(status: number): ApiError {
  return unexpectedError(NOTION, status)
}

/**
 * Normaliza a resposta de GET /v1/users/me:
 * - PAT: usuário `person` dono do token.
 * - Integração interna: `bot`, com `bot.owner` (user ou workspace) e `bot.workspace_name`.
 */
export function parseSelf(body: unknown): NotionSelf | null {
  if (!isRecord(body) || body['object'] !== 'user') return null
  const id = body['id']
  const type = body['type']
  if (typeof id !== 'string' || (type !== 'person' && type !== 'bot')) return null

  let ownerName: string | null = null
  let ownerAvatarUrl: string | null = null
  let workspaceName: string | null = null
  let personId: string | null = type === 'person' ? id : null

  const bot = body['bot']
  if (type === 'bot' && isRecord(bot)) {
    workspaceName = stringOrNull(bot['workspace_name'])
    const owner = bot['owner']
    if (isRecord(owner) && owner['type'] === 'user' && isRecord(owner['user'])) {
      ownerName = stringOrNull(owner['user']['name'])
      ownerAvatarUrl = httpsUrlOrNull(owner['user']['avatar_url'])
      personId = stringOrNull(owner['user']['id'])
    }
  }

  return {
    id,
    type,
    name: stringOrNull(body['name']),
    avatarUrl: httpsUrlOrNull(body['avatar_url']),
    ownerName,
    ownerAvatarUrl,
    workspaceName,
    personId
  }
}
