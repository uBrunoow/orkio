/**
 * Texto e links de um evento do histórico da tarefa (`task_events`). Puro: usado no histórico da
 * tarefa e na atividade recente.
 */
import { finalText, type FlowResult } from './flow-final'
import { EVENT_META } from './automation'
import type { TaskEvent } from './task-events'
import { FLOW_PAUSES } from './flow-run-state'

type HistoryEvent = TaskEvent

/** Link da branch (entrega sem PR conhecida): github.com/<owner>/<repo>/tree/<branch>. */
export function branchUrl(e: HistoryEvent): string | null {
  if (e.kind !== 'delivery') return null
  const { owner, repo, branch } = e.detail
  return owner !== undefined && repo !== undefined && branch !== undefined
    ? `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/tree/${branch
        .split('/')
        .map(encodeURIComponent)
        .join('/')}`
    : null
}

function prOf(e: HistoryEvent): { number: number; owner?: string; repo?: string } | null {
  return 'pr' in e.detail ? (e.detail.pr ?? null) : null
}

export function prNumber(e: HistoryEvent): number | null {
  return prOf(e)?.number ?? null
}

/**
 * Link da PR montado a partir de owner/repo/número (o banco não guarda URLs nem títulos). Revisão
 * publicada como orkio[bot] (`reviewId`) aponta para a própria revisão na PR.
 */
export function prUrl(e: HistoryEvent): string | null {
  const pr = prOf(e)
  const reviewId = e.kind === 'delivery' ? e.detail.reviewId : undefined
  const anchor =
    reviewId !== undefined && Number.isSafeInteger(reviewId) && reviewId > 0
      ? `#pullrequestreview-${reviewId}`
      : ''
  return pr && pr.owner !== undefined && pr.repo !== undefined
    ? `https://github.com/${encodeURIComponent(pr.owner)}/${encodeURIComponent(pr.repo)}/pull/${pr.number}${anchor}`
    : null
}

/** "PR #45 mergeada" / "Branch criada (ORK-1/x)". */
function automationEvent(e: Extract<HistoryEvent, { kind: 'moved' | 'automation' }>): string {
  const label = e.detail.event ? EVENT_META[e.detail.event].label : 'Evento'
  const n = prNumber(e)
  return n !== null
    ? `${label} (PR #${n})`
    : e.detail.branch
      ? `${label} (${e.detail.branch.name})`
      : label
}

/** " por Ana" quando um agente fez a ação (8A). */
function by(e: HistoryEvent): string {
  const agent = 'agent' in e.detail ? e.detail.agent : undefined
  return agent ? ` por ${agent}` : ''
}

/** Nome do passo (eventos novos) ou o id (eventos gravados antes do nome). */
function stepLabel(detail: { step?: string | null; stepName?: string }): string {
  return detail.stepName ?? detail.step ?? ''
}

function deliveryText(e: Extract<HistoryEvent, { kind: 'delivery' }>): string {
  const who = e.detail.by === 'claude' ? 'Claude Code (modo entrega)' : 'Orkio'
  const branch = e.detail.branch ?? ''
  const n = prNumber(e)
  const pr = n !== null ? ` na PR #${n}` : ''
  switch (e.detail.action) {
    case 'push':
      return `Push de ${branch} pelo ${who}`
    case 'pr_create':
      return `PR aberta pelo ${who} (${branch})`
    case 'pr_edit':
      return `PR atualizada pelo ${who}${pr}`
    case 'pr_ready':
      return `PR marcada como pronta pelo ${who}${pr}`
    case 'pr_comment':
      return `Comentário${pr} pelo ${who}`
    case 'thread_reply':
      return `Resposta a comentário de review${pr} pelo ${who}`
    case 'thread_resolve':
      return `Conversa de review resolvida${pr} pelo ${who}`
    case 'review_request':
      return `Review pedido${pr} pelo ${who}`
    case 'review_post':
      return `Revisão publicada${pr} ${
        e.detail.via === 'gh' ? 'com o seu usuário do GitHub (gh)' : 'como orkio[bot]'
      } (${e.detail.reviewEvent === 'REQUEST_CHANGES' ? 'pedir alterações' : 'comentário'})`
    case undefined:
      return `Entrega pelo ${who}`
    default:
      return unreachable(e.detail.action)
  }
}

function agentAssigned(e: Extract<HistoryEvent, { kind: 'agent_assigned' }>): string {
  const agent = e.detail.agent ?? ''
  switch (e.detail.by) {
    case 'rule':
      return `Atribuída a ${agent} pela regra da coluna`
    case 'orchestrator':
      return `Atribuída a ${agent} pelo orquestrador`
    case 'manual':
    case undefined:
      return `Atribuída a ${agent}`
    default:
      return unreachable(e.detail.by)
  }
}

export function describeEvent(e: HistoryEvent, stageName: (id: string | null) => string): string {
  const path = `${stageName(e.fromStage)} → ${stageName(e.toStage)}`
  switch (e.kind) {
    case 'moved': {
      if (e.source !== 'automation') {
        return `Movida de ${stageName(e.fromStage)} para ${stageName(e.toStage)}`
      }
      if (e.detail.orchestrator) {
        const reason =
          e.detail.orchestrator === 'pull' ? 'puxada da fila' : 'fluxo da etapa concluído'
        return `Orquestrador (${reason}): ${path}${by(e)}`
      }
      if (e.detail.flow === 'pr_merged') return `Fluxo (PR mergeada): ${path}`
      if (e.detail.flow === 'review_self') {
        return `Revisão com alterações (autor da PR, pelo gh): ${path}`
      }
      return `${automationEvent(e)} → regra ${rule(e.detail.ruleName)}: ${path}`
    }
    case 'automation':
      switch (e.detail.outcome) {
        case 'skipped':
          return `${automationEvent(e)}: regra ${rule(e.detail.ruleName)} ignorada (${e.detail.reason ?? ''})`
        case 'noop':
          return `${automationEvent(e)}: já estava em ${stageName(e.fromStage)}`
        case 'notify':
          return `${automationEvent(e)}: notificação (regra ${rule(e.detail.ruleName)})`
        case 'move':
        case 'no_rule':
        case undefined:
          return automationEvent(e)
        default:
          return unreachable(e.detail.outcome)
      }
    case 'automation_paused':
      return 'Automações pausadas nesta tarefa'
    case 'automation_resumed':
      return 'Automações retomadas nesta tarefa'
    case 'added':
      return `Entrou no quadro em ${stageName(e.toStage)}`
    case 'reconciled': {
      const status = e.detail.status ? ` (status “${e.detail.status}”)` : ''
      return `Reposicionada pelo Notion: ${path}${status}`
    }
    case 'blocked':
      return e.source === 'notion' ? 'Marcada como bloqueada no Notion' : 'Marcada como bloqueada'
    case 'unblocked':
      return e.source === 'notion' ? 'Desbloqueada no Notion' : 'Desbloqueada'
    case 'sync_ok':
      return 'Sincronizada com o Notion'
    case 'run_started':
      return `Claude Code iniciou uma execução${by(e)}`
    case 'run_finished':
      return `Claude Code terminou (${filesChanged(e.detail.files ?? 0)})`
    case 'run_cancelled':
      return 'Execução do Claude Code cancelada'
    case 'run_failed':
      return 'Execução do Claude Code falhou'
    case 'run_blocked':
      return `Claude Code bloqueado: ${e.detail.reason ?? 'ação não permitida'}`
    case 'flow_started':
      return `Fluxo iniciado: ${e.detail.flow ?? ''}${by(e)}`
    case 'agent_assigned':
      return agentAssigned(e)
    case 'agent_unassigned':
      return e.detail.by === 'orchestrator' && e.detail.agent
        ? `${e.detail.agent} saiu da tarefa (etapa sem agente do orquestrador)`
        : 'Atribuição de agente removida'
    case 'step_started':
      return `Passo começou: ${stepLabel(e.detail)}`
    case 'step_finished':
      return `Passo concluído: ${stepLabel(e.detail)}`
    case 'step_failed':
      return `Passo falhou: ${stepLabel(e.detail)}`
    case 'step_skipped':
      return `Passo pulado: ${stepLabel(e.detail)}`
    case 'gate_waiting':
      return `Esperando sua aprovação: ${stepLabel(e.detail)}`
    case 'gate_approved':
      return `Aprovação concedida: ${stepLabel(e.detail)}`
    case 'gate_rejected':
      return `Aprovação recusada: ${stepLabel(e.detail)}`
    case 'gate_revised':
      return `Mudanças pedidas: ${stepLabel(e.detail)}`
    case 'flow_paused':
      return `Fluxo parado: ${e.detail.reason ? FLOW_PAUSES[e.detail.reason].label : 'motivo desconhecido'}`
    case 'flow_finished':
      return flowFinishedText(e.detail.result)
    case 'artifact_attached':
      return `Documento anexado: ${e.detail.path ?? ''}`
    case 'artifact_published':
      return `Documento publicado no Notion: ${e.detail.path ?? ''}`
    case 'delivery':
      return deliveryText(e)
    case 'rolled_back':
      return `O Notion recusou a mudança; voltou para ${stageName(e.toStage)}`
    case 'handoff_started':
      return 'Sessão do Claude Code com você no terminal'
    case 'handoff_returned':
      return e.detail.mode === 'done'
        ? 'Você devolveu a sessão: passo feito no terminal'
        : e.detail.mode === 'continue'
          ? 'Você devolveu a sessão: o Claude continua o passo'
          : 'Você devolveu a sessão ao Orkio'
    case 'server_started':
      return `Servidor ${e.detail.server} subiu na porta ${e.detail.port}${e.detail.by === 'agent' ? ' (pelo agente)' : ''}`
    case 'server_stopped':
      return e.detail.by === 'exit'
        ? `Servidor ${e.detail.server} parou sozinho${typeof e.detail.exitCode === 'number' ? ` (código ${e.detail.exitCode})` : ''}`
        : `Servidor ${e.detail.server} parado${e.detail.by === 'agent' ? ' pelo agente' : ''}`
    default:
      return unreachable(e)
  }
}

/** Switch exaustivo: um tipo novo no catálogo sem texto aqui é erro de compilação. */
function unreachable(value: never): string {
  return String(value)
}

function rule(name: string | null | undefined): string {
  return name ? `“${name}”` : ''
}

function filesChanged(n: number): string {
  return n === 1 ? '1 arquivo alterado' : `${n} arquivos alterados`
}

/** Linha do fim de um fluxo, com o final honesto (`shared/flow-final.ts`). */
export function flowFinishedText(result: FlowResult | null | undefined): string {
  switch (result ?? 'done') {
    case 'done':
      return 'Fluxo concluído'
    case 'cancelled':
      return 'Fluxo cancelado'
    case 'rejected':
      return 'Fluxo encerrado (recusado)'
    default:
      return `Fluxo terminou: ${finalText(result).label.toLowerCase()}`
  }
}
