/** Regras puras da tela de Integrações (busca e qual painel fica aberto). */

export function normalize(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

/** A busca casa com nome, categoria ou seção (sem acento nem caixa). */
export function matchesQuery(
  card: { name: string; category: string; section: string },
  query: string
): boolean {
  const needle = normalize(query.trim())
  return !needle || normalize(`${card.name} ${card.category} ${card.section}`).includes(needle)
}

/** O primeiro card (na ordem da página) que ainda não está pronto. */
export function firstPendingId(
  cards: ReadonlyArray<{ id: string; pending: boolean }>
): string | null {
  return cards.find((c) => c.pending)?.id ?? null
}

/**
 * Qual painel está aberto. `chosen`: escolha da pessoa (`undefined` = ainda não escolheu; `null` =
 * fechou tudo). Sem escolha, abre o primeiro pendente; sem pendentes, o que estava aberto
 * (`lastAuto`) continua, para a confirmação de "conectado" não sumir na hora.
 */
export function effectiveOpenId(
  chosen: string | null | undefined,
  firstPending: string | null,
  lastAuto: string | null
): string | null {
  if (chosen !== undefined) return chosen
  return firstPending ?? lastAuto
}
