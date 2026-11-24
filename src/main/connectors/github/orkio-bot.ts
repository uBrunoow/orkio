/**
 * orkio[bot] (GitHub App que publica as revisões): está instalado nos repositórios dos projetos?
 *
 * Só leitura, pelo site do Orkio (`GitHubConnector.orkioBotInstallation`); o token do usuário não
 * sai do conector. Usado pelo cartão "Orkio bot" de Integrações para oferecer "Instalar no GitHub"
 * antes de a primeira revisão falhar com `not_installed`.
 *
 * Um resultado por repositório (projetos com o mesmo repo se juntam), só github.com (Enterprise
 * não tem o App). Cache em memória de 60 s; `force` ignora.
 */
import { GitHubApiError } from './github.client'
import type { OrkioSiteResponse } from './github.connector'
import { isInstallUrl } from '../../../shared/github-names'
import type { OrkioBotRepo, OrkioBotRepoState, OrkioBotStatus } from '../../../shared/orkio-bot'
import type { ProjectView } from '../../../shared/projects'

export const ORKIO_BOT_CACHE_MS = 60_000

export const ORKIO_BOT_MESSAGES = {
  noSite: 'Este app não sabe o endereço do site do Orkio; não dá para conferir.',
  notConfigured: 'O GitHub App do Orkio ainda não está configurado no site.',
  rateLimited: 'Muitas consultas seguidas. Tente de novo em um minuto.',
  siteOutdated: 'O site do Orkio ainda não tem esta consulta (versão antiga do site).',
  unexpected: 'Não foi possível conferir agora. Tente de novo.'
} as const

/** Resposta do `POST /github/installation` → estado do repositório (nada do corpo é repassado). */
export function parseInstallationResponse(res: OrkioSiteResponse): OrkioBotRepoState {
  const body = isRecord(res.body) ? res.body : {}
  if (res.status === 200 && typeof body['installed'] === 'boolean') {
    if (body['installed']) return { state: 'installed' }
    const url = body['installUrl']
    return {
      state: 'not_installed',
      installUrl: isInstallUrl(url) ? url : null
    }
  }
  if (res.status === 403) return { state: 'no_access' }
  if (res.status === 503) return { state: 'unknown', message: ORKIO_BOT_MESSAGES.notConfigured }
  if (res.status === 429) return { state: 'unknown', message: ORKIO_BOT_MESSAGES.rateLimited }
  // 404/405: site publicado antes desta rota.
  if (res.status === 404 || res.status === 405) {
    return { state: 'unknown', message: ORKIO_BOT_MESSAGES.siteOutdated }
  }
  return { state: 'unknown', message: ORKIO_BOT_MESSAGES.unexpected }
}

/** Erro do conector (sem site, rede, timeout) → estado; nunca a exceção crua. */
export function stateFromError(e: unknown): OrkioBotRepoState {
  if (e instanceof GitHubApiError) {
    if (e.code === 'not_configured') return { state: 'unknown', message: ORKIO_BOT_MESSAGES.noSite }
    if (e.code === 'network' || e.code === 'timeout')
      return { state: 'unknown', message: e.message }
  }
  return { state: 'unknown', message: ORKIO_BOT_MESSAGES.unexpected }
}

/** Repositórios únicos do github.com dos projetos, com os nomes dos projetos. */
export function reposOf(projects: readonly ProjectView[]): Omit<OrkioBotRepo, 'status'>[] {
  const byKey = new Map<string, Omit<OrkioBotRepo, 'status'>>()
  for (const p of projects) {
    const r = p.repo
    if (!r || r.host !== 'github.com') continue
    const key = `${r.owner}/${r.name}`.toLowerCase()
    const found = byKey.get(key)
    if (found) found.projects.push(p.name)
    else byKey.set(key, { owner: r.owner, repo: r.name, projects: [p.name] })
  }
  return [...byKey.values()]
}

export interface OrkioBotDeps {
  isConnected(): Promise<boolean>
  listProjects(): Promise<readonly ProjectView[]>
  installation(owner: string, repo: string): Promise<OrkioSiteResponse>
  now?: () => number
}

export class OrkioBotService {
  private cache: { at: number; value: OrkioBotStatus } | null = null
  private inflight: Promise<OrkioBotStatus> | null = null

  constructor(private readonly deps: OrkioBotDeps) {}

  async status(force = false): Promise<OrkioBotStatus> {
    const now = this.deps.now ?? Date.now
    if (!force && this.cache && now() - this.cache.at < ORKIO_BOT_CACHE_MS) return this.cache.value
    // Duas telas pedindo ao mesmo tempo dividem a mesma consulta.
    this.inflight ??= this.check().finally(() => {
      this.inflight = null
    })
    return this.inflight
  }

  private async check(): Promise<OrkioBotStatus> {
    const now = this.deps.now ?? Date.now
    if (!(await this.deps.isConnected().catch(() => false))) {
      this.cache = null
      return { github: 'disconnected', repos: [], checkedAt: null }
    }
    const repos: OrkioBotRepo[] = []
    // Em sequência: poucos repositórios, e o site limita por IP.
    for (const r of reposOf(await this.deps.listProjects())) {
      let status: OrkioBotRepoState
      try {
        status = parseInstallationResponse(await this.deps.installation(r.owner, r.repo))
      } catch (e) {
        status = stateFromError(e)
      }
      repos.push({ ...r, status })
    }
    const value: OrkioBotStatus = {
      github: 'connected',
      repos,
      checkedAt: new Date(now()).toISOString()
    }
    this.cache = { at: now(), value }
    return value
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
