/**
 * Sessão da tarefa (puro, sem React): junta o histórico (`task_events`) e as execuções do Claude
 * Code numa conversa só, em ordem de tempo e separada por dia. Eventos que a execução já conta
 * (início, fim, bloqueio, passo do fluxo que só roda um comando) ficam de fora: a execução aparece
 * como um bloco próprio, com o que o Claude disse.
 */
import type { AgentRunView } from '../../../../shared/agent-run'
import type { BoardHistoryEntry } from '../../../../shared/board'
import { isSessionEvent } from '../../../../shared/task-events'

export type SessionItem =
  | { kind: 'day'; key: string; label: string }
  | { kind: 'event'; key: string; entry: BoardHistoryEntry }
  | { kind: 'run'; key: string; run: AgentRunView; latest: boolean }

function dayKey(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

/** "Hoje", "Ontem" ou a data ("12 de nov."; com o ano quando não é o atual). */
export function dayLabel(iso: string, now: Date): string {
  const d = new Date(iso)
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const that = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const days = Math.round((today.getTime() - that.getTime()) / 86_400_000)
  if (days === 0) return 'Hoje'
  if (days === 1) return 'Ontem'
  return d.toLocaleDateString('pt-BR', {
    day: 'numeric',
    month: 'short',
    ...(d.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' })
  })
}

/**
 * Conversa da tarefa, do mais antigo ao mais novo. `history` vem do main com o mais novo primeiro;
 * `runs` também. A execução mais recente é marcada (`latest`): ela fica aberta na tela.
 */
export function buildSession(
  history: readonly BoardHistoryEntry[],
  runs: readonly AgentRunView[],
  now: Date
): SessionItem[] {
  const latestRun = runs.reduce<AgentRunView | null>(
    (best, r) => (!best || r.startedAt > best.startedAt ? r : best),
    null
  )
  const entries: { at: string; order: number; item: SessionItem }[] = [
    ...history.filter(isSessionEvent).map((e) => ({
      at: e.at,
      order: e.id,
      item: { kind: 'event' as const, key: `e${e.id}`, entry: e }
    })),
    ...runs.map((r) => ({
      at: r.startedAt,
      order: 0,
      item: { kind: 'run' as const, key: `r${r.id}`, run: r, latest: r.id === latestRun?.id }
    }))
  ].sort((a, b) => (a.at === b.at ? a.order - b.order : a.at < b.at ? -1 : 1))

  const out: SessionItem[] = []
  let day: string | null = null
  for (const e of entries) {
    const k = dayKey(e.at)
    if (k !== day) {
      day = k
      out.push({ kind: 'day', key: `d${k}`, label: dayLabel(e.at, now) })
    }
    out.push(e.item)
  }
  return out
}

/**
 * Só o fim da conversa (os `limit` itens mais recentes, sem contar os separadores de dia), com o
 * separador do primeiro dia visível. `hidden` = quantos itens ficaram escondidos.
 */
export function tailSession(
  items: readonly SessionItem[],
  limit: number
): { items: SessionItem[]; hidden: number } {
  const content = items.filter((i) => i.kind !== 'day').length
  if (content <= limit) return { items: [...items], hidden: 0 }
  let seen = 0
  let cut = items.length
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i]!.kind === 'day') continue
    seen++
    if (seen === limit) {
      cut = i
      break
    }
  }
  const visible = items.slice(cut)
  let dayIndex = cut - 1
  while (dayIndex >= 0 && items[dayIndex]!.kind !== 'day') dayIndex--
  const head = dayIndex >= 0 ? [items[dayIndex]!] : []
  return { items: [...head, ...visible], hidden: content - limit }
}
