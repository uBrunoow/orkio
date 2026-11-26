/**
 * GitHub pelo `gh` do usuário (projeto só com git local, entrega 2): as mesmas leituras e escritas
 * do conector (`getConditional`, `graphql`, pedir revisores, postar revisão), feitas pelo binário
 * `gh` já logado na máquina. O Orkio nunca lê nem guarda o token do `gh`: só roda o binário, sem
 * shell, sem prompt, com argumentos montados aqui e corpos pela entrada padrão.
 *
 * As respostas vêm do `gh api -i` (status e cabeçalhos), então os erros saem do mesmo
 * mapeamento do conector (`errorForResponse`: 404, SSO, rate limit).
 */
import { execFile } from 'node:child_process'
import { isLogin, isOwner, isRepo, isTeamSlug } from '../../../shared/github-names'
import { reviewUrlOrNull } from '../../../shared/site-contract'
import { ApiError } from '../../net/http'
import { toolEnv } from '../../platform/process'
import { sanitizeEnv } from '../../platform/redact'
import { errorForResponse, parseNextLink, type ConditionalPage } from './github.client'

export type GhExec = (
  args: readonly string[],
  input?: string
) => Promise<{ code: number | null; stdout: string; stderr: string; missing?: boolean }>

export type GhStatus =
  | { ok: true; login: string }
  | { ok: false; code: 'missing' | 'logged_out' | 'failed'; message: string }

export const GH_MESSAGES = {
  missing: 'Instale o GitHub CLI (gh) para o Orkio ler PRs e CI deste projeto.',
  loggedOut: 'Entre no GitHub CLI para o Orkio ler PRs e CI deste projeto: rode gh auth login.',
  failed: 'O GitHub CLI (gh) não respondeu. Tente de novo.',
  timeout: 'O GitHub CLI (gh) demorou demais para responder.',
  invalid: 'Pedido ao GitHub CLI inválido.'
} as const

const HOST = ['--hostname', 'github.com'] as const
/** Login em cache: o `gh` só muda de conta por `gh auth`, fora do Orkio. */
const STATUS_TTL_MS = 60_000
const TIMEOUT_MS = 30_000
/** Leitura do `gh api`: páginas de 100 PRs/branches cabem com folga. */
const MAX_BUFFER = 20 * 1024 * 1024

export interface GhCliDeps {
  exec?: GhExec
  now?: () => number
}

export interface GhReviewInput {
  event: 'COMMENT' | 'REQUEST_CHANGES'
  body: string
  comments: { path: string; line: number; body: string }[]
}

export class GhCli {
  private readonly exec: GhExec
  private readonly now: () => number
  private statusCache: { at: number; value: GhStatus } | null = null

  constructor(deps: GhCliDeps = {}) {
    this.exec = deps.exec ?? runGh
    this.now = deps.now ?? (() => Date.now())
  }

  /** O `gh` está instalado e logado no github.com? Com o login (cache de 1 min). */
  async status(force = false): Promise<GhStatus> {
    const hit = this.statusCache
    if (!force && hit && this.now() - hit.at < STATUS_TTL_MS) return hit.value
    const r = await this.exec(['api', ...HOST, 'user', '--jq', '.login'])
    const login = r.stdout.trim()
    const value: GhStatus = r.missing
      ? { ok: false, code: 'missing', message: GH_MESSAGES.missing }
      : r.code === 0 && isLogin(login)
        ? { ok: true, login }
        : loggedOut(r)
          ? { ok: false, code: 'logged_out', message: GH_MESSAGES.loggedOut }
          : { ok: false, code: 'failed', message: GH_MESSAGES.failed }
    this.statusCache = { at: this.now(), value }
    return value
  }

  async getConditional(path: string, etag: string | null): Promise<ConditionalPage> {
    checkPath(path)
    const headers = etag ? ['-H', `If-None-Match: ${etag}`] : []
    const res = await this.request(['api', ...HOST, '-i', ...headers, path], path)
    if (res.status === 304) return { notModified: true }
    return {
      notModified: false,
      body: parseBody(res.body, res.status),
      etag: res.headers.get('etag'),
      nextPath: parseNextLink(res.headers.get('link'))
    }
  }

  async graphql(
    query: string,
    variables: Record<string, unknown>
  ): Promise<{ data: unknown; errors: { type: string | null; path: string[] }[] }> {
    const res = await this.request(
      ['api', ...HOST, '-i', 'graphql', '--input', '-'],
      '/graphql',
      JSON.stringify({ query, variables })
    )
    const body = parseBody(res.body, res.status)
    if (!isRecord(body)) throw unexpected(res.status)
    const errors = Array.isArray(body['errors'])
      ? body['errors'].filter(isRecord).map((e) => ({
          type: typeof e['type'] === 'string' ? e['type'] : null,
          path: Array.isArray(e['path']) ? e['path'].map(String) : []
        }))
      : []
    if (!isRecord(body['data'])) {
      throw errors.some((e) => e.type === 'NOT_FOUND')
        ? new ApiError('github', 'not_found', 'Repositório não encontrado ou sem acesso.', 404)
        : errors.some((e) => e.type === 'FORBIDDEN' || e.type === 'INSUFFICIENT_SCOPES')
          ? new ApiError(
              'github',
              'forbidden',
              'O GitHub CLI não tem permissão para ler parte dos detalhes das PRs.',
              res.status
            )
          : unexpected(res.status)
    }
    return { data: body['data'], errors }
  }

  async requestReviewers(
    owner: string,
    repo: string,
    pull: number,
    reviewers: { users: string[]; teams: string[] }
  ): Promise<void> {
    if (
      !isOwner(owner) ||
      !isRepo(repo) ||
      !Number.isSafeInteger(pull) ||
      pull <= 0 ||
      reviewers.users.length + reviewers.teams.length === 0 ||
      !reviewers.users.every(isLogin) ||
      !reviewers.teams.every(isTeamSlug)
    ) {
      throw new ApiError('github', 'unexpected', 'Pedido de review inválido.')
    }
    const path = `${repoPath(owner, repo)}/pulls/${pull}/requested_reviewers`
    try {
      await this.post(path, { reviewers: reviewers.users, team_reviewers: reviewers.teams })
    } catch (error) {
      if (error instanceof ApiError && error.status === 422) {
        throw new ApiError(
          'github',
          'invalid',
          'O GitHub recusou o pedido de review: confira se os revisores têm acesso ao repositório (o autor da PR não pode revisar a própria PR).',
          422
        )
      }
      throw error
    }
  }

  async listCollaborators(owner: string, repo: string): Promise<string[]> {
    if (!isOwner(owner) || !isRepo(repo)) return []
    const page = await this.getConditional(
      `${repoPath(owner, repo)}/collaborators?per_page=100`,
      null
    )
    if (page.notModified || !Array.isArray(page.body)) return []
    return page.body.flatMap((u) => (isRecord(u) && isLogin(u['login']) ? [u['login']] : []))
  }

  /** Revisão publicada com o usuário do `gh` (nunca APPROVE; o texto já vem validado). */
  async postReview(
    owner: string,
    repo: string,
    number: number,
    review: GhReviewInput
  ): Promise<{ url: string | null }> {
    if (!isOwner(owner) || !isRepo(repo) || !Number.isSafeInteger(number) || number <= 0) {
      throw new ApiError('github', 'unexpected', GH_MESSAGES.invalid)
    }
    const res = await this.post(`${repoPath(owner, repo)}/pulls/${number}/reviews`, {
      event: review.event,
      body: review.body,
      comments: review.comments.map((c) => ({
        path: c.path,
        line: c.line,
        side: 'RIGHT',
        body: c.body
      }))
    })
    const body = parseBody(res.body, res.status)
    return { url: isRecord(body) ? reviewUrlOrNull(body['html_url'], owner, repo, number) : null }
  }

  private async post(path: string, body: unknown): Promise<ParsedHttp> {
    checkPath(path)
    return this.request(
      ['api', ...HOST, '-i', '-X', 'POST', path, '--input', '-'],
      path,
      JSON.stringify(body)
    )
  }

  /** Roda o `gh api -i` e devolve a resposta HTTP; status ≥ 400 vira o `ApiError` do conector. */
  private async request(args: string[], path: string, input?: string): Promise<ParsedHttp> {
    const r = await this.exec(args, input)
    if (r.missing) throw new ApiError('github', 'not_connected', GH_MESSAGES.missing)
    const res = parseGhHttp(r.stdout)
    if (!res) {
      if (loggedOut(r)) throw new ApiError('github', 'not_connected', GH_MESSAGES.loggedOut)
      if (r.code === null) throw new ApiError('github', 'timeout', GH_MESSAGES.timeout)
      throw new ApiError('github', 'unexpected', GH_MESSAGES.failed)
    }
    if (res.status === 304 || (res.status >= 200 && res.status < 300)) return res
    throw errorForResponse(
      { status: res.status, ok: false, headers: res.headers, text: res.body },
      res.body,
      path
    )
  }
}

interface ParsedHttp {
  status: number
  headers: Headers
  body: string
}

/** Saída do `gh api -i`: linha de status, cabeçalhos, linha em branco, corpo. */
export function parseGhHttp(stdout: string): ParsedHttp | null {
  const text = stdout.replace(/\r\n/g, '\n')
  const status = /^HTTP\/[\d.]+\s+(\d{3})/.exec(text)
  if (!status) return null
  const end = text.indexOf('\n\n')
  const head = end < 0 ? text : text.slice(0, end)
  const headers = new Headers()
  for (const line of head.split('\n').slice(1)) {
    const i = line.indexOf(':')
    if (i <= 0) continue
    try {
      headers.append(line.slice(0, i).trim(), line.slice(i + 1).trim())
    } catch {
      // Cabeçalho com caractere estranho: ignorado (nada dele é usado).
    }
  }
  return { status: Number(status[1]), headers, body: end < 0 ? '' : text.slice(end + 2) }
}

function checkPath(path: string): void {
  if (!/^\/(repos|repositories)\/[^\s]+$/.test(path)) {
    throw new ApiError('github', 'unexpected', 'Caminho da API do GitHub não permitido.')
  }
}

const repoPath = (owner: string, repo: string): string =>
  `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`

function loggedOut(r: { code: number | null; stderr: string }): boolean {
  return r.code === 4 || /gh auth login|not logged in/i.test(r.stderr)
}

function parseBody(body: string, status: number): unknown {
  if (!body.trim()) return null
  try {
    return JSON.parse(body) as unknown
  } catch {
    throw unexpected(status)
  }
}

const unexpected = (status: number): ApiError =>
  new ApiError('github', 'unexpected', 'Resposta inesperada do GitHub.', status)

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** O binário de verdade: `execFile` sem shell, sem prompt, corpo pela entrada padrão. */
const runGh: GhExec = (args, input) =>
  new Promise((resolve) => {
    const child = execFile(
      'gh',
      [...args],
      {
        env: {
          ...sanitizeEnv(toolEnv()),
          GH_PROMPT_DISABLED: '1',
          NO_COLOR: '1',
          GH_NO_UPDATE_NOTIFIER: '1',
          GH_PAGER: 'cat'
        },
        timeout: TIMEOUT_MS,
        maxBuffer: MAX_BUFFER,
        windowsHide: true
      },
      (error, stdout, stderr) => {
        const e = error as (NodeJS.ErrnoException & { killed?: boolean }) | null
        resolve({
          code: e ? (e.killed ? null : typeof e.code === 'number' ? e.code : 1) : 0,
          stdout: String(stdout),
          stderr: String(stderr),
          ...(e?.code === 'ENOENT' ? { missing: true } : {})
        })
      }
    )
    child.stdin?.end(input ?? '')
  })
