/**
 * Cliente HTTP mínimo da API do Notion. Roda só no processo main.
 *
 * Usa fetch nativo em vez de @notionhq/client: só precisamos de um endpoint, e assim
 * controlamos timeout, Retry-After e mensagens de erro sem dependência extra.
 */

import { httpsUrlOrNull, isRecord, parseRetryAfterMs, stringOrNull } from '../../net/parse'

// Reexportado para quem já importava daqui.
export { parseRetryAfterMs }

export const NOTION_API_BASE_URL = 'https://api.notion.com/v1'
/** Versão da API do Notion (header Notion-Version). Atualize só aqui. */
export const NOTION_VERSION = '2026-03-11'
export const NOTION_REQUEST_TIMEOUT_MS = 10_000
/** Esperamos e repetimos uma vez se o Notion pedir até este tempo; acima disso, devolvemos erro. */
export const NOTION_MAX_RETRY_WAIT_MS = 5_000

export type NotionErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'rate_limited'
  | 'timeout'
  | 'network'
  | 'server'
  | 'unexpected'
  /** OAuth: código ou refresh token inválido, expirado ou revogado (reconectar). */
  | 'invalid_grant'
  /** OAuth: client ID/secret do app recusados pelo Notion (problema de configuração). */
  | 'oauth_config'

/** Erro com mensagem segura para o usuário (pt-BR). Nunca contém o token nem a exceção original. */
export class NotionApiError extends Error {
  constructor(
    readonly code: NotionErrorCode,
    message: string,
    readonly status?: number
  ) {
    super(message)
    this.name = 'NotionApiError'
  }
}

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
}

export interface NotionClientDeps {
  fetch?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  timeoutMs?: number
}

export interface NotionClient {
  getSelf(token: string): Promise<NotionSelf>
}

export function createNotionClient(deps: NotionClientDeps = {}): NotionClient {
  // Resolve fetch na hora da chamada para respeitar substituições de globalThis.fetch.
  const doFetch: typeof fetch = (...args) => (deps.fetch ?? globalThis.fetch)(...args)
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const timeoutMs = deps.timeoutMs ?? NOTION_REQUEST_TIMEOUT_MS

  async function request(path: string, token: string): Promise<unknown> {
    for (let attempt = 0; ; attempt++) {
      const response = await fetchWithTimeout(
        doFetch,
        `${NOTION_API_BASE_URL}${path}`,
        token,
        timeoutMs
      )

      if (response.ok) {
        try {
          return await response.json()
        } catch {
          throw unexpected(response.status)
        }
      }

      if (response.status === 429) {
        const waitMs = parseRetryAfterMs(response.headers.get('retry-after'))
        if (attempt === 0 && waitMs !== null && waitMs <= NOTION_MAX_RETRY_WAIT_MS) {
          await sleep(waitMs)
          continue
        }
        throw rateLimited(waitMs)
      }

      throw errorForStatus(response.status)
    }
  }

  return {
    async getSelf(token: string): Promise<NotionSelf> {
      const body = await request('/users/me', token)
      const parsed = parseSelf(body)
      if (!parsed) throw unexpected(200)
      return parsed
    }
  }
}

async function fetchWithTimeout(
  doFetch: typeof fetch,
  url: string,
  token: string,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await doFetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'Notion-Version': NOTION_VERSION,
        Accept: 'application/json'
      },
      signal: controller.signal
    })
  } catch {
    // Não propagamos a exceção original: ela pode carregar detalhes da requisição.
    if (controller.signal.aborted) {
      throw new NotionApiError(
        'timeout',
        'O Notion demorou demais para responder. Verifique sua conexão e tente novamente.'
      )
    }
    throw new NotionApiError(
      'network',
      'Não foi possível falar com o Notion. Verifique sua conexão com a internet.'
    )
  } finally {
    clearTimeout(timer)
  }
}

function errorForStatus(status: number): NotionApiError {
  if (status === 401) {
    return new NotionApiError(
      'unauthorized',
      'Token inválido ou revogado. Gere um novo token no Notion e cole aqui.',
      status
    )
  }
  if (status === 403) {
    return new NotionApiError(
      'forbidden',
      'Este token não tem permissão para ler seu usuário no Notion. Verifique as capacidades do token.',
      status
    )
  }
  if (status >= 500) {
    return new NotionApiError(
      'server',
      `O Notion está instável agora (erro ${status}). Tente novamente em instantes.`,
      status
    )
  }
  return unexpected(status)
}

function unexpected(status: number): NotionApiError {
  return new NotionApiError(
    'unexpected',
    `Resposta inesperada do Notion (HTTP ${status}). Tente novamente.`,
    status
  )
}

function rateLimited(waitMs: number | null): NotionApiError {
  const seconds = waitMs === null ? null : Math.max(1, Math.ceil(waitMs / 1000))
  const when = seconds === null ? 'em alguns segundos' : `em ${seconds} s`
  return new NotionApiError(
    'rate_limited',
    `O Notion limitou as requisições. Tente novamente ${when}.`,
    429
  )
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

  const bot = body['bot']
  if (type === 'bot' && isRecord(bot)) {
    workspaceName = stringOrNull(bot['workspace_name'])
    const owner = bot['owner']
    if (isRecord(owner) && owner['type'] === 'user' && isRecord(owner['user'])) {
      ownerName = stringOrNull(owner['user']['name'])
      ownerAvatarUrl = httpsUrlOrNull(owner['user']['avatar_url'])
    }
  }

  return {
    id,
    type,
    name: stringOrNull(body['name']),
    avatarUrl: httpsUrlOrNull(body['avatar_url']),
    ownerName,
    ownerAvatarUrl,
    workspaceName
  }
}
