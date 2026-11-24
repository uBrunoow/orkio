/**
 * Orkio — revisão publicada como `orkio[bot]` (GitHub App do Orkio).
 *
 *   POST /github/review
 *     { owner, repo, number, userToken, review: { event, body, comments: [{ path, line, side?, body }] } }
 *     → { url }
 *
 * Por que o SITE posta a revisão (e não devolve o token do App): o token de instalação com
 * `pull_requests: write` também permite APPROVE. Se saísse daqui, qualquer pessoa com push num
 * repositório com o App instalado aprovaria a própria PR como `orkio[bot]` (e contaria na proteção
 * de branch). Por isso o token nasce, é usado e morre nesta função; o evento é validado aqui
 * (`COMMENT` ou `REQUEST_CHANGES`, nunca APPROVE) e o corpo enviado ao GitHub é montado aqui, só
 * com os campos permitidos.
 *
 * Passos (nenhuma chamada ao GitHub antes de o pedido inteiro ser validado):
 * 1. `GET /repos/{owner}/{repo}` com o token OAuth do usuário → exige `permissions.push === true`.
 *    É o PAPEL do usuário no repositório (o token OAuth do Orkio tem escopo `repo`, que já permite
 *    escrever): quem não pode dar push não publica revisão pelo App.
 *    Depois `GET /user` (mesmo token): o login de quem pediu vai numa linha no fim da revisão
 *    ("Publicado pelo Orkio a pedido de @login"), já que ela sai como `orkio[bot]`.
 * 2. JWT RS256 do App (iat −60 s, exp +9 min) → `GET /repos/{o}/{r}/installation`.
 * 3. `POST /app/installations/{id}/access_tokens` com `repositories: [repo]` e
 *    `permissions: { pull_requests: 'write' }`.
 * 4. `POST /repos/{o}/{r}/pulls/{n}/reviews` com esse token → devolve só o link da revisão.
 *
 * Prazos: cada chamada ao GitHub tem 10 s (incluindo a leitura do corpo) e o pedido inteiro tem
 * 15 s (`REVIEW_DEADLINE_MS`), menos que os 25 s do app.
 *
 * Regras: sem estado, sem logs (nada de console.*, ESLint e teste), nunca repassa corpos do GitHub;
 * erros só por código (`GITHUB_ERROR_STATUS` em `contract.ts`, com o status de cada um). O texto da
 * revisão só passa por aqui (não é gravado).
 */
import { createPrivateKey, sign, type KeyObject } from 'node:crypto'
import {
  GITHUB_API_VERSION,
  GITHUB_ERROR_STATUS,
  OWNER_SLUG,
  REVIEW_BODY_MAX,
  REVIEW_COMMENTS_MAX,
  REVIEW_COMMENT_MAX,
  REVIEW_PATH_MAX,
  installUrl,
  isRepoName,
  reviewUrlOrNull,
  type GitHubRouteError,
  type ReviewRejectReason
} from './contract'
import { isRecord, json, loopbackOverride, readJsonBody, withRateLimit } from './http'
import { installationLimiter, reviewLimiter, type RateLimiter } from './rate-limit'

export interface GitHubAppEnv {
  /** App ID (numérico) do GitHub App: vai no `iss` do JWT. */
  GITHUB_APP_ID: string | undefined
  /** Chave privada PEM do App (aceita `\n` literais, como a Vercel costuma guardar). */
  GITHUB_APP_PRIVATE_KEY: string | undefined
  /** Slug público do App (github.com/apps/<slug>): monta o link de instalação. Opcional. */
  GITHUB_APP_SLUG?: string | undefined
  /** Só para o E2E local: API alternativa. Ignorada na Vercel; só `http://127.0.0.1`. */
  GITHUB_API_URL?: string | undefined
  VERCEL?: string | undefined
}

export interface ReviewDeps {
  fetch?: typeof fetch
  now?: () => number
  /** Tempo máximo de cada chamada ao GitHub, incluindo a leitura do corpo. */
  timeoutMs?: number
  /**
   * Prazo TOTAL do pedido (todas as chamadas ao GitHub, com a leitura dos corpos). Menor que o
   * timeout do app (25 s): o app não desiste enquanto o site ainda pode estar postando.
   */
  deadlineMs?: number
}

export const GITHUB_API_URL = 'https://api.github.com'
/**
 * Corpo da requisição: o maior pedido válido (20 mil + 50 × (4 mil + 1 mil) caracteres) com até
 * 3 bytes por caractere em UTF-8, mais o JSON em volta.
 */
export const REVIEW_REQUEST_MAX_BYTES = 1024 * 1024
/** Corpo de `/github/installation` (`{ owner, repo, userToken }`). */
const INSTALLATION_REQUEST_MAX_BYTES = 4096
/** Respostas do GitHub lidas até este tamanho (as que usamos são pequenas). */
const RESPONSE_MAX_BYTES = 256 * 1024
const UPSTREAM_TIMEOUT_MS = 10_000
export const REVIEW_DEADLINE_MS = 15_000
const USER_AGENT = 'Orkio-Site'

/**
 * Login de quem pediu (atribuição no fim da revisão): começa com letra/dígito, depois letras,
 * dígitos, `_` (contas gerenciadas) e hífens simples, até 39. Seguro dentro de markdown.
 */
export const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9_]|-(?=[A-Za-z0-9_])){0,38}$/
/** Token do usuário: só caracteres de token (vai num header). */
const TOKEN_CHARS = /^[A-Za-z0-9_.-]{1,1024}$/
const MAX_PR_NUMBER = 2 ** 31

export interface ValidReview {
  owner: string
  repo: string
  number: number
  userToken: string
  event: 'COMMENT' | 'REQUEST_CHANGES'
  body: string
  comments: { path: string; line: number; body: string }[]
}

/** Variáveis do processo (route handler). */
export function githubAppEnv(): GitHubAppEnv {
  return {
    GITHUB_APP_ID: process.env['GITHUB_APP_ID'],
    GITHUB_APP_PRIVATE_KEY: process.env['GITHUB_APP_PRIVATE_KEY'],
    GITHUB_APP_SLUG: process.env['GITHUB_APP_SLUG'],
    GITHUB_API_URL: process.env['GITHUB_API_URL'],
    VERCEL: process.env['VERCEL']
  }
}

/** Base da API: a do GitHub; fora da Vercel, um loopback explícito (E2E). */
export function apiBaseFrom(env: GitHubAppEnv): string {
  return new URL(loopbackOverride(env, env.GITHUB_API_URL, GITHUB_API_URL)).origin
}

/** PEM da env (com `\n` literais ou quebras reais) → chave RSA. `null` se inválida. */
export function parsePrivateKey(raw: string | undefined): KeyObject | null {
  const pem = (raw ?? '').replace(/\\n/g, '\n').trim()
  if (!pem.includes('PRIVATE KEY')) return null
  try {
    const key = createPrivateKey({ key: pem, format: 'pem' })
    return key.asymmetricKeyType === 'rsa' ? key : null
  } catch {
    return null
  }
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url')
}

/** JWT RS256 do App (docs "Generating a JSON Web Token for a GitHub App"). */
export function createAppJwt(appId: string, key: KeyObject, nowMs: number): string {
  const now = Math.floor(nowMs / 1000)
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const payload = base64url(JSON.stringify({ iat: now - 60, exp: now + 9 * 60, iss: appId }))
  const signature = sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), key)
  return `${header}.${payload}.${base64url(signature)}`
}

export function installUrlFrom(env: GitHubAppEnv): string | null {
  const slug = env.GITHUB_APP_SLUG?.trim()
  return slug ? installUrl(slug) : null
}

function isRepoPath(path: unknown): path is string {
  if (typeof path !== 'string' || path.length === 0 || path.length > REVIEW_PATH_MAX) return false
  for (let i = 0; i < path.length; i++) {
    const code = path.charCodeAt(i)
    if (code < 0x20 || code === 0x7f) return false // NUL e demais caracteres de controle
  }
  return !path.split(/[\\/]/).includes('..')
}

/**
 * Valida o pedido inteiro (sem rede). Evento só `COMMENT` ou `REQUEST_CHANGES`: APPROVE, minúsculas
 * ou ausente → `null` (`bad_request`). O resultado tem só os campos permitidos.
 */
export function validateReviewRequest(body: unknown): ValidReview | null {
  if (!isRecord(body)) return null
  const { owner, repo, number, userToken, review } = body
  if (
    typeof owner !== 'string' ||
    !OWNER_SLUG.test(owner) ||
    typeof repo !== 'string' ||
    !isRepoName(repo) ||
    typeof number !== 'number' ||
    !Number.isSafeInteger(number) ||
    number < 1 ||
    number > MAX_PR_NUMBER ||
    typeof userToken !== 'string' ||
    !TOKEN_CHARS.test(userToken) ||
    !isRecord(review)
  ) {
    return null
  }
  const event = review['event']
  if (event !== 'COMMENT' && event !== 'REQUEST_CHANGES') return null
  const text = review['body']
  // O GitHub exige corpo em COMMENT e REQUEST_CHANGES.
  if (typeof text !== 'string' || text.trim() === '' || text.length > REVIEW_BODY_MAX) return null
  const rawComments = review['comments'] ?? []
  if (!Array.isArray(rawComments) || rawComments.length > REVIEW_COMMENTS_MAX) return null
  const comments: ValidReview['comments'] = []
  for (const c of rawComments) {
    if (!isRecord(c)) return null
    const { path, line, side, body: commentBody } = c
    if (
      !isRepoPath(path) ||
      typeof line !== 'number' ||
      !Number.isSafeInteger(line) ||
      line < 1 ||
      (side !== undefined && side !== 'RIGHT') ||
      typeof commentBody !== 'string' ||
      commentBody.trim() === '' ||
      commentBody.length > REVIEW_COMMENT_MAX
    ) {
      return null
    }
    comments.push({ path, line, body: commentBody })
  }
  return { owner, repo, number, userToken, event, body: text, comments }
}

function fail(
  error: GitHubRouteError,
  extra: { reason?: ReviewRejectReason; installUrl?: string } = {}
): Response {
  return json(GITHUB_ERROR_STATUS[error], { error, ...extra })
}

/** App ID + chave privada válidos; `null` = a rota responde `not_configured`. */
export function requireAppKey(env: GitHubAppEnv): { appId: string; key: KeyObject } | null {
  const appId = env.GITHUB_APP_ID?.trim() ?? ''
  const key = /^\d{1,20}$/.test(appId) ? parsePrivateKey(env.GITHUB_APP_PRIVATE_KEY) : null
  return key ? { appId, key } : null
}

/** Corpo JSON do pedido; tipo, tamanho ou JSON errado = `bad_request` com o status do problema. */
async function readRequest(request: Request, max: number): Promise<{ value: unknown } | Response> {
  const read = await readJsonBody(request, max)
  return read.ok ? { value: read.value } : json(read.status, { error: 'bad_request' })
}

type Call = (path: string, token: string, body?: unknown) => Promise<GitHubResult | null>

/**
 * `GET /repos/{owner}/{repo}` com o token do usuário: o repositório que ele enxerga, com o nome
 * canônico (owner/repo da resposta) e as permissões. 401/403/404 → `forbidden`.
 */
async function canonicalRepo(
  call: Call,
  owner: string,
  repo: string,
  userToken: string
): Promise<{ owner: string; repo: string; permissions: Record<string, unknown> } | Response> {
  const res = await call(`/repos/${owner}/${repo}`, userToken)
  if (!res || isRateLimited(res)) return fail('upstream')
  if (res.status === 401 || res.status === 403 || res.status === 404) return fail('forbidden')
  if (!res.ok || !isRecord(res.body)) return fail('upstream')
  const name = res.body['name']
  const ownerObj = res.body['owner']
  const login = isRecord(ownerObj) ? ownerObj['login'] : null
  if (typeof login !== 'string' || !OWNER_SLUG.test(login)) return fail('upstream')
  if (typeof name !== 'string' || !isRepoName(name)) return fail('upstream')
  const permissions = isRecord(res.body['permissions']) ? res.body['permissions'] : {}
  return { owner: login, repo: name, permissions }
}

/** Chamadas ao GitHub de um pedido: base da API e prazo total compartilhado entre elas. */
function callerFor(env: GitHubAppEnv, deps: ReviewDeps): Call {
  const api = apiBaseFrom(env)
  const deadline = AbortSignal.timeout(deps.deadlineMs ?? REVIEW_DEADLINE_MS)
  return (path, token, body) =>
    githubCall(deps.fetch ?? fetch, `${api}${path}`, token, body, deadline, deps.timeoutMs)
}

function notInstalled(env: GitHubAppEnv): Response {
  const installUrl = installUrlFrom(env)
  return fail('not_installed', installUrl ? { installUrl } : {})
}

/** POST da rota: limitador por IP e depois a lógica abaixo, com as variáveis do processo. */
export function reviewPost(
  request: Request,
  limiter: RateLimiter = reviewLimiter
): Promise<Response> {
  return withRateLimit(limiter, request, () => handleReview(request, githubAppEnv()))
}

export async function handleReview(
  request: Request,
  env: GitHubAppEnv,
  deps: ReviewDeps = {}
): Promise<Response> {
  try {
    return await review(request, env, deps)
  } catch {
    // Exceção inesperada: resposta genérica, nada logado (a mensagem pode ter dados do pedido).
    return fail('upstream')
  }
}

async function review(request: Request, env: GitHubAppEnv, deps: ReviewDeps): Promise<Response> {
  const app = requireAppKey(env)
  if (!app) return fail('not_configured')
  const { appId, key } = app

  const read = await readRequest(request, REVIEW_REQUEST_MAX_BYTES)
  if (read instanceof Response) return read
  const input = validateReviewRequest(read.value)
  if (!input) return fail('bad_request')

  const call = callerFor(env, deps)
  const now = deps.now ?? Date.now

  // 1. O usuário pode dar push? (com o token dele; o nome canônico vem da resposta)
  const target = await canonicalRepo(call, input.owner, input.repo, input.userToken)
  if (target instanceof Response) return target
  if (target.permissions['push'] !== true) return fail('forbidden')
  const { owner, repo } = target

  // Quem pediu: a revisão sai como orkio[bot], então o corpo diz a pedido de quem (responsável).
  const userRes = await call('/user', input.userToken)
  if (!userRes || isRateLimited(userRes)) return fail('upstream')
  if (userRes.status === 401 || userRes.status === 403) return fail('forbidden')
  if (!userRes.ok || !isRecord(userRes.body)) return fail('upstream')
  const login = userRes.body['login']
  if (typeof login !== 'string' || !LOGIN.test(login)) return fail('forbidden')

  // 2. Instalação do App neste repositório.
  const jwt = createAppJwt(appId, key, now())
  const inst = await call(`/repos/${owner}/${repo}/installation`, jwt)
  if (!inst) return fail('upstream')
  if (inst.status === 404) return notInstalled(env)
  // JWT recusado: App ID e chave não batem (configuração do site).
  if (inst.status === 401) return fail('not_configured')
  if (!inst.ok || !isRecord(inst.body)) return fail('upstream')
  const installationId = inst.body['id']
  if (typeof installationId !== 'number' || !Number.isSafeInteger(installationId)) {
    return fail('upstream')
  }

  // 3. Token restrito a este repositório e a pull_requests: write. Nunca sai desta função.
  const tokenRes = await call(`/app/installations/${installationId}/access_tokens`, jwt, {
    repositories: [repo],
    permissions: { pull_requests: 'write' }
  })
  if (!tokenRes) return fail('upstream')
  if (tokenRes.status === 401) return fail('not_configured')
  // 403/404/422: a instalação não cobre este repositório ou não concedeu a permissão.
  if ([403, 404, 422].includes(tokenRes.status)) return notInstalled(env)
  if (!tokenRes.ok || !isRecord(tokenRes.body)) return fail('upstream')
  const appToken = tokenRes.body['token']
  if (typeof appToken !== 'string' || !TOKEN_CHARS.test(appToken)) return fail('upstream')

  // 4. A revisão, montada aqui só com os campos permitidos.
  const posted = await call(`/repos/${owner}/${repo}/pulls/${input.number}/reviews`, appToken, {
    event: input.event,
    body: `${input.body}${attribution(login)}`,
    ...(input.comments.length > 0
      ? {
          comments: input.comments.map((c) => ({
            path: c.path,
            line: c.line,
            side: 'RIGHT',
            body: c.body
          }))
        }
      : {})
  })
  if (!posted || isRateLimited(posted)) return fail('upstream')
  if (posted.status === 422) {
    // Só o código: o texto ao usuário é do app (`REVIEW_MESSAGES.rejected`).
    return fail('bad_request', { reason: 'rejected' })
  }
  if (posted.status === 404) return fail('bad_request', { reason: 'pr_not_found' })
  // Token do App recusado para esta PR: permissão da instalação faltando.
  if (posted.status === 401 || posted.status === 403) return notInstalled(env)
  if (!posted.ok) return fail('upstream')
  // Já postada: devolve 200 mesmo sem link conferido (repetir duplicaria a revisão).
  const htmlUrl = isRecord(posted.body) ? posted.body['html_url'] : null
  return json(200, { url: reviewUrlOrNull(htmlUrl, owner, repo, input.number) })
}

// ---------- POST /github/installation ----------
//
// Só leitura: o orkio[bot] está instalado neste repositório? Usado pelo app (Integrações) para
// oferecer "Instalar no GitHub" ANTES da primeira revisão falhar.
//
//   POST /github/installation  { owner, repo, userToken }  →  { installed, installUrl }
//
// O token do usuário vai no corpo (nunca na URL). Primeiro confirma, com ele, que a pessoa
// enxerga o repositório: sem isso a rota diria a qualquer um se um repositório privado existe e
// tem o App. Depois o JWT do App consulta a instalação; nenhum token de instalação é criado.

export interface ValidInstallationQuery {
  owner: string
  repo: string
  userToken: string
}

export function validateInstallationRequest(body: unknown): ValidInstallationQuery | null {
  if (!isRecord(body)) return null
  const { owner, repo, userToken } = body
  if (
    typeof owner !== 'string' ||
    !OWNER_SLUG.test(owner) ||
    typeof repo !== 'string' ||
    !isRepoName(repo) ||
    typeof userToken !== 'string' ||
    !TOKEN_CHARS.test(userToken)
  ) {
    return null
  }
  return { owner, repo, userToken }
}

/** POST da rota: limitador por IP e depois a consulta, com as variáveis do processo. */
export function installationPost(
  request: Request,
  limiter: RateLimiter = installationLimiter
): Promise<Response> {
  return withRateLimit(limiter, request, () => handleInstallation(request, githubAppEnv()))
}

export async function handleInstallation(
  request: Request,
  env: GitHubAppEnv,
  deps: ReviewDeps = {}
): Promise<Response> {
  try {
    return await installation(request, env, deps)
  } catch {
    return fail('upstream')
  }
}

async function installation(
  request: Request,
  env: GitHubAppEnv,
  deps: ReviewDeps
): Promise<Response> {
  const app = requireAppKey(env)
  if (!app) return fail('not_configured')

  const read = await readRequest(request, INSTALLATION_REQUEST_MAX_BYTES)
  if (read instanceof Response) return read
  const input = validateInstallationRequest(read.value)
  if (!input) return fail('bad_request')

  const call = callerFor(env, deps)
  const now = deps.now ?? Date.now

  // 1. A pessoa enxerga o repositório? (o nome canônico vem da resposta)
  const target = await canonicalRepo(call, input.owner, input.repo, input.userToken)
  if (target instanceof Response) return target
  const { owner, repo } = target

  // 2. Instalação do App neste repositório (só a consulta; nada de token de instalação).
  const jwt = createAppJwt(app.appId, app.key, now())
  const inst = await call(`/repos/${owner}/${repo}/installation`, jwt)
  if (!inst) return fail('upstream')
  if (inst.status === 401) return fail('not_configured')
  const installUrl = installUrlFrom(env)
  if (inst.status === 404) return json(200, { installed: false, installUrl })
  if (!inst.ok) return fail('upstream')
  return json(200, { installed: true, installUrl })
}

/** Linha acrescentada ao fim de toda revisão: quem pediu ao Orkio. */
export function attribution(login: string): string {
  return `\n\n---\n_Publicado pelo Orkio a pedido de @${login}._`
}

interface GitHubResult {
  status: number
  ok: boolean
  headers: Headers
  /** JSON da resposta (lido com limite); `null` se vazio, grande demais ou inválido. */
  body: unknown
}

/**
 * Chamada ao GitHub com timeout que cobre também a leitura do corpo (limitada). Falha de rede,
 * timeout ou corpo cortado → `null` (vira `upstream`).
 */
async function githubCall(
  fetchImpl: typeof fetch,
  url: string,
  token: string,
  body: unknown,
  deadline: AbortSignal,
  timeoutMs = UPSTREAM_TIMEOUT_MS
): Promise<GitHubResult | null> {
  if (deadline.aborted) return null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const signal = AbortSignal.any([controller.signal, deadline])
  const post = body !== undefined
  try {
    const response = await fetchImpl(url, {
      method: post ? 'POST' : 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': GITHUB_API_VERSION,
        'User-Agent': USER_AGENT,
        ...(post ? { 'Content-Type': 'application/json' } : {})
      },
      ...(post ? { body: JSON.stringify(body) } : {}),
      // GET segue redirecionamento (repositório renomeado → /repositories/{id}; o fetch tira o
      // Authorization se a origem mudar). POST nunca: o corpo não segue para outro endereço.
      redirect: post ? 'error' : 'follow',
      signal,
      cache: 'no-store'
    })
    const text = await readBody(response, signal)
    if (text === undefined) return null
    let parsed: unknown = null
    try {
      parsed = text ? JSON.parse(text) : null
    } catch {
      parsed = null
    }
    return { status: response.status, ok: response.ok, headers: response.headers, body: parsed }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** Lê o corpo até `RESPONSE_MAX_BYTES`; cancelado pelo timeout → `undefined`. Grande → ''. */
async function readBody(response: Response, signal: AbortSignal): Promise<string | undefined> {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const onAbort = (): void => void reader.cancel().catch(() => undefined)
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    const chunks: Uint8Array[] = []
    let size = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (signal.aborted) return undefined
      if (done) break
      size += value.byteLength
      if (size > RESPONSE_MAX_BYTES) {
        await reader.cancel().catch(() => undefined)
        return ''
      }
      chunks.push(value)
    }
    return new TextDecoder().decode(Buffer.concat(chunks))
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

/** 429, ou 403 de rate limit (Retry-After / x-ratelimit-remaining: 0): não é falta de permissão. */
function isRateLimited(result: GitHubResult): boolean {
  if (result.status === 429) return true
  return (
    result.status === 403 &&
    (result.headers.get('retry-after') !== null ||
      result.headers.get('x-ratelimit-remaining') === '0')
  )
}
