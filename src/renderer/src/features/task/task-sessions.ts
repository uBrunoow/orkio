import { isRunLive, type AgentRunView } from '../../../../shared/agent-run'

/** Uma sessão do Claude Code da tarefa (várias execuções podem continuar a mesma). */
export interface TaskSessionItem {
  id: string
  /** Ordem de criação (1 = a primeira da tarefa). */
  number: number
  /** Saiu de outra sessão ("Ramificar daqui"/"Editar mensagem") ou começou do zero. */
  origin: 'new' | 'fork'
  /** O primeiro pedido da sessão (texto ou /comando), para reconhecer na lista. */
  title: string
  /** Alguma execução dela está rodando ou na fila. */
  live: boolean
  /** Início da execução mais recente dela. */
  lastAt: string
  runs: number
}

function askedOf(run: AgentRunView): string | null {
  if (run.mode === 'command' && run.command) {
    return `/${run.command}${run.text ? ` ${run.text}` : ''}`
  }
  const text = run.text?.replace(/\s+/g, ' ').trim()
  return text ? text : null
}

/**
 * Sessões da tarefa, a mais recente (pela última execução) primeiro. `runs` vem como a tela
 * recebe (mais recente primeiro); execuções sem sessão guardada e sidechats ficam de fora.
 */
export function taskSessions(runs: readonly AgentRunView[]): TaskSessionItem[] {
  const byId = new Map<string, AgentRunView[]>()
  for (const r of [...runs].reverse()) {
    if (!r.sessionId || r.side) continue
    const list = byId.get(r.sessionId) ?? []
    list.push(r)
    byId.set(r.sessionId, list)
  }
  const items = [...byId.entries()].map(([id, list], i): TaskSessionItem => {
    const first = list[0]!
    const last = list.at(-1)!
    return {
      id,
      number: i + 1,
      origin: first.forkedFrom ? 'fork' : 'new',
      title: list.map(askedOf).find((t) => t !== null) ?? `Sessão ${i + 1}`,
      live: list.some((r) => isRunLive(r.status)),
      lastAt: last.startedAt,
      runs: list.length
    }
  })
  return items.sort((a, b) => b.lastAt.localeCompare(a.lastAt))
}

/**
 * A sessão que a conversa mostra: a escolhida (se ainda existe) ou `null` = a conversa completa
 * da tarefa (todas as sessões, como o piloto automático as encadeia: cada comando abre uma).
 */
export function visibleSessionId(
  runs: readonly AgentRunView[],
  chosen: string | null | undefined
): string | null {
  return chosen && runs.some((r) => r.sessionId === chosen && !r.side) ? chosen : null
}

/**
 * Execuções da sessão mostrada (`null` = todas, menos sidechats). As sem sessão guardada (pararam
 * antes de começar) aparecem junto da sessão mais recente, onde estavam na conversa.
 */
export function runsOfSession(
  runs: readonly AgentRunView[],
  sessionId: string | null
): AgentRunView[] {
  const main = runs.filter((r) => !r.side)
  if (sessionId === null) return main
  const latest = taskSessions(runs)[0]?.id ?? null
  return main.filter((r) => r.sessionId === sessionId || (!r.sessionId && sessionId === latest))
}

/** Um sidechat da tarefa: as execuções dele da mais antiga para a mais recente. */
export interface SideChat {
  id: string
  title: string
  live: boolean
  lastAt: string
  runs: AgentRunView[]
}

/** Sidechats da tarefa, o mais recente primeiro (`runs` como a tela recebe). */
export function sideChats(runs: readonly AgentRunView[]): SideChat[] {
  const byId = new Map<string, AgentRunView[]>()
  for (const r of [...runs].reverse()) {
    if (!r.side || !r.sessionId) continue
    byId.set(r.sessionId, [...(byId.get(r.sessionId) ?? []), r])
  }
  return [...byId.entries()]
    .map(([id, list]) => ({
      id,
      title: list.map(askedOf).find((t) => t !== null) ?? 'Sidechat',
      live: list.some((r) => isRunLive(r.status)),
      lastAt: list.at(-1)!.startedAt,
      runs: list
    }))
    .sort((a, b) => b.lastAt.localeCompare(a.lastAt))
}
