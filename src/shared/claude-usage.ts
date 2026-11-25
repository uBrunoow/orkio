/**
 * Medidor de uso do Claude (Fase 0): quanto da janela de 5 h e da semanal a assinatura do Claude
 * Code já gastou e quando cada uma renova. O main lê o endpoint (não documentado) com o token do
 * Claude Code do usuário; ao renderer só chegam as porcentagens e os horários (nunca o token).
 * Puro: sem Node nem DOM.
 */
import { isRecord } from './guards'

export interface UsageWindow {
  /** 0–100, já arredondado. */
  percent: number
  /** ISO 8601 de quando a janela renova (`null` se a resposta não trouxe). */
  resetsAt: string | null
}

export interface ClaudeUsage {
  /** Janela de 5 h ("sessão" na linguagem do Claude). */
  session: UsageWindow | null
  /** Janela de 7 dias (todos os modelos). */
  weekly: UsageWindow | null
  checkedAt: string
}

/** O que a barra lê: `enabled` = medidor ligado nas Configurações; `usage` = `null` esconde. */
export interface ClaudeUsageView {
  enabled: boolean
  usage: ClaudeUsage | null
  /** Fase 5: segurar a automação perto do limite (Configurações › Provedores e uso). */
  hold?: UsageHold
}

/**
 * Fase 5: o uso do Claude decide quando a automação roda. Com a janela de 5 h em `percent`% ou
 * mais, os fluxos que a automação começou (coluna movida por regra, orquestrador, a PR que acorda
 * o fluxo) esperam a janela renovar antes do próximo passo do Claude Code. Medidor desligado ou
 * falhando = nada é segurado.
 */
export interface UsageHold {
  enabled: boolean
  percent: number
}

export const USAGE_HOLD_DEFAULT: UsageHold = { enabled: true, percent: 90 }
export const USAGE_HOLD_RANGE = { min: 50, max: 100 } as const

/** Configuração lida do disco ou do IPC; inválida = `null`. */
export function parseUsageHold(value: unknown): UsageHold | null {
  if (!isRecord(value)) return null
  const { enabled, percent } = value
  if (typeof enabled !== 'boolean') return null
  if (
    typeof percent !== 'number' ||
    !Number.isInteger(percent) ||
    percent < USAGE_HOLD_RANGE.min ||
    percent > USAGE_HOLD_RANGE.max
  ) {
    return null
  }
  return { enabled, percent }
}

/**
 * Segura agora? Só a janela de 5 h decide (a semanal não renova em horas). `null` = pode rodar
 * (desligado, sem leitura do medidor ou abaixo do limite).
 */
export function usageHoldOf(
  hold: UsageHold,
  usage: ClaudeUsage | null
): { percent: number; resetsAt: string | null } | null {
  if (!hold.enabled || !usage?.session) return null
  return usage.session.percent >= hold.percent
    ? { percent: usage.session.percent, resetsAt: usage.session.resetsAt }
    : null
}

function window(value: unknown): UsageWindow | null {
  if (!isRecord(value)) return null
  const raw = value['utilization']
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) return null
  const resets = value['resets_at']
  const resetsAt =
    typeof resets === 'string' && !Number.isNaN(Date.parse(resets))
      ? new Date(resets).toISOString()
      : null
  return { percent: Math.min(100, Math.round(raw)), resetsAt }
}

/**
 * Resposta do `GET /api/oauth/usage` (`five_hour`/`seven_day`: `{ utilization, resets_at }`, a
 * utilização já em %). Formato estranho ou sem nenhuma das duas janelas → `null` (o medidor some).
 */
export function parseClaudeUsage(body: unknown, now: Date): ClaudeUsage | null {
  if (!isRecord(body)) return null
  const session = window(body['five_hour'])
  const weekly = window(body['seven_day'])
  if (!session && !weekly) return null
  return { session, weekly, checkedAt: now.toISOString() }
}

/** O medidor mostra a janela que está mais perto do limite (empate: a de 5 h). */
export function headlineWindow(
  usage: ClaudeUsage
): { kind: 'session' | 'weekly'; window: UsageWindow } | null {
  const { session, weekly } = usage
  if (session && (!weekly || session.percent >= weekly.percent)) {
    return { kind: 'session', window: session }
  }
  return weekly ? { kind: 'weekly', window: weekly } : null
}
