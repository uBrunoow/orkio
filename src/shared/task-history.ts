/**
 * Texto e links de um evento do histórico da tarefa (`task_events`). Puro: usado no painel da
 * tarefa (quadro) e na atividade recente da Visão geral (6D).
 */
import { EVENT_LABELS, type EventKind } from './automation'
import type { BoardHistoryEntry } from './ipc-contract'

type HistoryEvent = Pick<BoardHistoryEntry, 'kind' | 'source' | 'fromStage' | 'toStage' | 'detail'>

/** Link da branch (entrega sem PR conhecida): github.com/<owner>/<repo>/tree/<branch>. */
export function branchUrl(e: HistoryEvent): string | null {
  if (e.kind !== 'delivery') return null
  const { owner, repo, branch } = (e.detail ?? {}) as Record<string, unknown>
  return typeof owner === 'string' && typeof repo === 'string' && typeof branch === 'string'
    ? `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/tree/${branch
        .split('/')
        .map(encodeURIComponent)
        .join('/')}`
    : null
}

export function prNumber(e: HistoryEvent): number | null {
  const pr = e.detail?.['pr'] as { number?: unknown } | undefined
  return typeof pr?.number === 'number' ? pr.number : null
}

/** Link da PR montado a partir de owner/repo/número (o banco não guarda URLs nem títulos). */
export function prUrl(e: HistoryEvent): string | null {
  const pr = e.detail?.['pr'] as { number?: unknown; owner?: unknown; repo?: unknown } | undefined
  return typeof pr?.number === 'number' &&
    typeof pr.owner === 'string' &&
    typeof pr.repo === 'string'
    ? `https://github.com/${encodeURIComponent(pr.owner)}/${encodeURIComponent(pr.repo)}/pull/${pr.number}`
    : null
}

/** "PR #45 mergeada" / "Branch criada (ORK-1/x)". */
function automationEvent(e: HistoryEvent): string {
  const kind = e.detail?.['event']
  const label =
    typeof kind === 'string' && kind in EVENT_LABELS ? EVENT_LABELS[kind as EventKind] : 'Evento'
  const n = prNumber(e)
  const branch = e.detail?.['branch'] as { name?: unknown } | undefined
  return n !== null
    ? `${label} (PR #${n})`
    : typeof branch?.name === 'string'
      ? `${label} (${branch.name})`
      : label
}

export function describeEvent(e: HistoryEvent, stageName: (id: string | null) => string): string {
  const rule = typeof e.detail?.['ruleName'] === 'string' ? `“${e.detail['ruleName']}”` : null
  if (e.kind === 'moved' && e.source === 'automation') {
    return `${automationEvent(e)} → regra ${rule ?? ''}: ${stageName(e.fromStage)} → ${stageName(e.toStage)}`
  }
  if (e.kind === 'automation') {
    const outcome = e.detail?.['outcome']
    if (outcome === 'skipped') {
      return `${automationEvent(e)}: regra ${rule ?? ''} ignorada (${String(e.detail?.['reason'] ?? '')})`
    }
    if (outcome === 'noop') return `${automationEvent(e)}: já estava em ${stageName(e.fromStage)}`
    if (outcome === 'notify') return `${automationEvent(e)}: notificação (regra ${rule ?? ''})`
    return automationEvent(e)
  }
  switch (e.kind) {
    case 'automation_paused':
      return 'Automações pausadas nesta tarefa'
    case 'automation_resumed':
      return 'Automações retomadas nesta tarefa'
    case 'added':
      return `Entrou no quadro em ${stageName(e.toStage)}`
    case 'moved':
      return `Movida de ${stageName(e.fromStage)} para ${stageName(e.toStage)}`
    case 'reconciled': {
      const status =
        typeof e.detail?.['status'] === 'string' ? ` (status “${e.detail['status']}”)` : ''
      return `Reposicionada pelo Notion: ${stageName(e.fromStage)} → ${stageName(e.toStage)}${status}`
    }
    case 'blocked':
      return e.source === 'notion' ? 'Marcada como bloqueada no Notion' : 'Marcada como bloqueada'
    case 'unblocked':
      return e.source === 'notion' ? 'Desbloqueada no Notion' : 'Desbloqueada'
    case 'sync_ok':
      return 'Sincronizada com o Notion'
    case 'run_started':
      return 'Claude Code iniciou uma execução'
    case 'run_finished':
      return `Claude Code terminou (${filesChanged(Number(e.detail?.['files'] ?? 0))})`
    case 'run_cancelled':
      return 'Execução do Claude Code cancelada'
    case 'run_failed':
      return 'Execução do Claude Code falhou'
    case 'flow_started':
      return `Fluxo iniciado: ${String(e.detail?.['flow'] ?? '')}`
    case 'step_started':
      return `Passo do fluxo começou (${String(e.detail?.['step'] ?? '')})`
    case 'step_finished':
      return `Passo do fluxo concluído (${String(e.detail?.['step'] ?? '')})`
    case 'step_failed':
      return `Passo do fluxo falhou (${String(e.detail?.['step'] ?? '')})`
    case 'step_skipped':
      return `Passo do fluxo pulado (${String(e.detail?.['step'] ?? '')})`
    case 'gate_waiting':
      return `Fluxo esperando aprovação (${String(e.detail?.['step'] ?? '')})`
    case 'gate_approved':
      return `Aprovação concedida (${String(e.detail?.['step'] ?? '')})`
    case 'gate_rejected':
      return `Aprovação recusada (${String(e.detail?.['step'] ?? '')})`
    case 'flow_paused':
      return `Fluxo pausado (${String(e.detail?.['reason'] ?? '')})`
    case 'flow_finished':
      return e.detail?.['result'] === 'cancelled'
        ? 'Fluxo cancelado'
        : e.detail?.['result'] === 'rejected'
          ? 'Fluxo encerrado (recusado)'
          : 'Fluxo concluído'
    case 'artifact_attached':
      return `Artefato anexado: ${String(e.detail?.['path'] ?? '')}`
    case 'artifact_published':
      return `Artefato publicado no Notion: ${String(e.detail?.['path'] ?? '')}`
    case 'delivery': {
      const by = e.detail?.['by'] === 'claude' ? 'Claude Code (modo entrega)' : 'Orkio'
      const branch = typeof e.detail?.['branch'] === 'string' ? e.detail['branch'] : ''
      const n = prNumber(e)
      const pr = n !== null ? ` na PR #${n}` : ''
      switch (e.detail?.['action']) {
        case 'push':
          return `Push de ${branch} pelo ${by}`
        case 'pr_create':
          return `PR aberta pelo ${by} (${branch})`
        case 'pr_edit':
          return `PR atualizada pelo ${by}${pr}`
        case 'pr_ready':
          return `PR marcada como pronta pelo ${by}${pr}`
        case 'pr_comment':
          return `Comentário${pr} pelo ${by}`
        case 'thread_reply':
          return `Resposta a comentário de review${pr} pelo ${by}`
        case 'thread_resolve':
          return `Conversa de review resolvida${pr} pelo ${by}`
        case 'review_request':
          return `Review pedido${pr} pelo ${by}`
        default:
          return `Entrega pelo ${by}`
      }
    }
    case 'run_blocked':
      return `Claude Code bloqueado: ${String(e.detail?.['reason'] ?? 'ação não permitida')}`
    case 'rolled_back':
      return `O Notion recusou a mudança; voltou para ${stageName(e.toStage)}`
    default:
      return e.kind
  }
}

function filesChanged(n: number): string {
  return n === 1 ? '1 arquivo alterado' : `${n} arquivos alterados`
}
