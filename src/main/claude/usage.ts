/**
 * Medidor de uso do Claude (Fase 0, experimental). Pergunta à Anthropic quanto da janela de 5 h e
 * da semanal a assinatura do Claude Code já gastou, com o token OAuth que o próprio Claude Code
 * guardou (`~/.claude/.credentials.json`; no macOS, o Keychain). Regras:
 *
 * - O token é lido na hora de cada consulta e descartado: nunca é guardado, logado nem enviado ao
 *   renderer (que só recebe % e horários).
 * - O endpoint não é documentado: qualquer falha (sem login, token vencido, rede, formato novo)
 *   vira `null` e o medidor some, sem erro na tela.
 * - Cache curto (`CACHE_MS`) e uma consulta por vez; o renderer só pergunta com a janela em foco.
 */
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { isRecord } from '../../shared/guards'
import { parseClaudeUsage, type ClaudeUsage } from '../../shared/claude-usage'
import { fetchWithTimeout, jsonOrNull } from '../net/http'
import { execExitCode } from '../platform/process'

export const CLAUDE_USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
export const CLAUDE_USAGE_BETA = 'oauth-2025-04-20'
export const CACHE_MS = 60_000
/**
 * Sem login do Claude Code (ou acesso ao Keychain negado): espera mais antes de tentar de novo,
 * para não pedir o Keychain do macOS a cada minuto. Religar o medidor (`reset`) tenta na hora.
 */
export const NO_LOGIN_CACHE_MS = 10 * 60_000
const TIMEOUT_MS = 10_000
const MAX_BODY_BYTES = 64 * 1024
/** Serviço do Keychain onde o Claude Code guarda o login no macOS. */
export const KEYCHAIN_SERVICE = 'Claude Code-credentials'

/** Token de acesso do Claude Code no JSON das credenciais (`claudeAiOauth`); vencido = `null`. */
export function accessTokenFrom(text: string, nowMs: number): string | null {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return null
  }
  const oauth = isRecord(data) ? data['claudeAiOauth'] : null
  if (!isRecord(oauth)) return null
  const token = oauth['accessToken']
  if (typeof token !== 'string' || token.length < 10 || /\s/.test(token)) return null
  const expiresAt = oauth['expiresAt']
  // O Orkio nunca renova o token (seria escrever nas credenciais do Claude Code): vencido = sem dado.
  if (typeof expiresAt === 'number' && expiresAt <= nowMs) return null
  return token
}

/**
 * Lê as credenciais do Claude Code: `CLAUDE_CONFIG_DIR` (ou `~/.claude`)/.credentials.json e, no
 * macOS, o Keychain (`security`, sem shell) quando o arquivo não existe.
 */
export async function readClaudeCredentials(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env
): Promise<string | null> {
  const dir = env['CLAUDE_CONFIG_DIR'] || join(homedir(), '.claude')
  try {
    return await readFile(join(dir, '.credentials.json'), 'utf8')
  } catch {
    // sem arquivo: no macOS o login fica no Keychain
  }
  if (platform !== 'darwin') return null
  try {
    const r = await execExitCode(
      '/usr/bin/security',
      ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-w'],
      { timeoutMs: 5_000, maxBuffer: 64 * 1024 }
    )
    return r.code === 0 ? r.stdout.trim() : null
  } catch {
    return null
  }
}

export interface ClaudeUsageDeps {
  /** Medidor ligado nas Configurações. */
  enabled(): boolean
  readCredentials(): Promise<string | null>
  fetch?: typeof fetch
  now?(): number
}

export class ClaudeUsageService {
  private cached: { at: number; value: ClaudeUsage | null; ttl: number } | null = null
  private inFlight: Promise<ClaudeUsage | null> | null = null

  constructor(private readonly deps: ClaudeUsageDeps) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now()
  }

  /** Uso atual (cache de `CACHE_MS`); desligado ou qualquer falha = `null`. */
  async get(): Promise<ClaudeUsage | null> {
    if (!this.deps.enabled()) return null
    if (this.cached && this.now() - this.cached.at < this.cached.ttl) return this.cached.value
    this.inFlight ??= this.load().finally(() => {
      this.inFlight = null
    })
    return this.inFlight
  }

  /** Esquece o cache (ex.: o medidor foi religado). */
  reset(): void {
    this.cached = null
  }

  private async load(): Promise<ClaudeUsage | null> {
    let ttl = CACHE_MS
    const value = await this.fetchUsage(() => (ttl = NO_LOGIN_CACHE_MS)).catch(() => null)
    this.cached = { at: this.now(), value, ttl }
    return value
  }

  private async fetchUsage(noLogin: () => void): Promise<ClaudeUsage | null> {
    const text = await this.deps.readCredentials().catch(() => null)
    const token = text ? accessTokenFrom(text, this.now()) : null
    if (!token) {
      noLogin()
      return null
    }
    const response = await fetchWithTimeout(
      {
        url: CLAUDE_USAGE_URL,
        headers: {
          Authorization: `Bearer ${token}`,
          'anthropic-beta': CLAUDE_USAGE_BETA,
          Accept: 'application/json'
        },
        redirect: 'error'
      },
      {
        service: 'anthropic',
        fetch: this.deps.fetch,
        timeoutMs: TIMEOUT_MS,
        maxBodyBytes: MAX_BODY_BYTES
      }
    )
    if (!response.ok) return null
    return parseClaudeUsage(jsonOrNull(response), new Date(this.now()))
  }
}
