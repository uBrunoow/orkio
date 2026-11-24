/** Regras puras da tela de Integrações (busca e qual painel fica aberto). */
import { normalizeLabel } from '../../../../shared/text'
import type { OrkioBotRepoState } from '../../../../shared/orkio-bot'
import type { StatusText } from '../../lib/status-text'

/** A busca casa com nome, categoria ou seção (sem acento nem caixa). */
export function matchesQuery(
  card: { name: string; category: string; section: string },
  query: string
): boolean {
  const needle = normalizeLabel(query)
  return !needle || normalizeLabel(`${card.name} ${card.category} ${card.section}`).includes(needle)
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

/** Rótulo do cartão "Orkio bot" a partir da consulta (null = ainda consultando). */
export function orkioBotSummary(
  s: {
    github: 'connected' | 'disconnected'
    repos: ReadonlyArray<{ status: Pick<OrkioBotRepoState, 'state'> }>
  } | null
): StatusText {
  if (!s) return { label: 'Verificando', tone: 'neutral' }
  if (s.github === 'disconnected') return { label: 'Conecte o GitHub antes', tone: 'neutral' }
  if (s.repos.length === 0) return { label: 'Nenhum projeto com GitHub', tone: 'neutral' }
  const missing = s.repos.filter((r) => r.status.state === 'not_installed').length
  const installed = s.repos.filter((r) => r.status.state === 'installed').length
  if (missing > 0) {
    return {
      label:
        missing === 1 && s.repos.length === 1
          ? 'Não instalado no repositório'
          : `Falta instalar em ${missing} de ${s.repos.length} repositórios`,
      tone: 'warning'
    }
  }
  if (installed === s.repos.length) {
    return {
      label:
        installed === 1 ? 'Instalado no repositório' : `Instalado nos ${installed} repositórios`,
      tone: 'success'
    }
  }
  return { label: 'Não deu para conferir', tone: 'neutral' }
}
