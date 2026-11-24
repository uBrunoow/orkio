/**
 * Motor de automações (Etapa 3B). Funções puras, sem Node/DOM:
 *
 * 1. `toSnapshot` reduz os sinais de uma tarefa (2D) ao mínimo técnico (ids, estados, datas).
 * 2. `deriveEvents(anterior, novo)` compara dois snapshots e devolve eventos com chave de
 *    idempotência. Parte desconhecida (fonte indisponível) nunca gera evento.
 * 3. `evaluate(eventos, regras, estado)` decide, evento a evento, a primeira regra que casa e o
 *    resultado (mover, notificar, ignorar), aplicando em sequência.
 */
import type { BoardStage } from './board'
import type { SignalsGitHubState, TaskSignals } from './task-signals'
import { isRecord } from './guards'
import { normalizeLabel } from './text'

export type EventKind =
  | 'branch.created'
  | 'pr.opened'
  | 'pr.ready_for_review'
  | 'pr.review_requested'
  | 'pr.changes_requested'
  | 'pr.review_comments_unresolved'
  | 'pr.approved'
  | 'pr.merged'
  | 'pr.closed_unmerged'

export const EVENT_KINDS: readonly EventKind[] = [
  'branch.created',
  'pr.opened',
  'pr.ready_for_review',
  'pr.review_requested',
  'pr.changes_requested',
  'pr.review_comments_unresolved',
  'pr.approved',
  'pr.merged',
  'pr.closed_unmerged'
]

export const EVENT_LABELS: Record<EventKind, string> = {
  'branch.created': 'Branch criada',
  'pr.opened': 'PR aberta',
  'pr.ready_for_review': 'PR pronta para review',
  'pr.review_requested': 'Review pedida',
  'pr.changes_requested': 'Alterações pedidas na review',
  'pr.review_comments_unresolved': 'Comentários de review não resolvidos',
  'pr.approved': 'PR aprovada',
  'pr.merged': 'PR mergeada',
  'pr.closed_unmerged': 'PR fechada sem merge'
}

// ---------- Snapshot ----------

export interface PrSnapshot {
  number: number
  state: 'draft' | 'open' | 'merged' | 'closed'
  updatedAt: string
  closedAt: string | null
  /** `null` = detalhes (GraphQL) indisponíveis neste ciclo. */
  reviewRequests: { id: string; at: string }[] | null
  reviews: { id: string; state: 'approved' | 'changes_requested'; at: string }[] | null
  unresolvedThreadIds: string[] | null
}

export interface TaskSnapshot {
  /** `null` = git local indisponível. */
  localBranches: string[] | null
  /** `null` = GitHub indisponível (desconectado, sem acesso, rate limit, rede). */
  github: { remoteBranches: string[]; pr: PrSnapshot | null } | null
}

/** Reduz os sinais ao snapshot salvo no SQLite (sem títulos, textos ou autores). */
export function toSnapshot(
  signals: TaskSignals | undefined,
  available: { local: boolean; github: boolean }
): TaskSnapshot {
  const pr = signals?.pr
  return {
    localBranches: available.local ? [...(signals?.localBranches ?? [])].sort() : null,
    github: available.github
      ? {
          remoteBranches: [...(signals?.remoteBranches ?? [])].sort(),
          pr: pr
            ? {
                number: pr.number,
                state: pr.state,
                updatedAt: pr.updatedAt,
                closedAt: pr.closedAt ?? null,
                // Só ids, estados e datas (sem logins).
                reviewRequests: pr.reviewRequests?.map((r) => ({ id: r.id, at: r.at })) ?? null,
                reviews: pr.reviews?.map((r) => ({ id: r.id, state: r.state, at: r.at })) ?? null,
                unresolvedThreadIds: pr.unresolvedThreadIds
                  ? [...pr.unresolvedThreadIds].sort()
                  : null
              }
            : null
        }
      : null
  }
}

/**
 * Junta o novo com o anterior: partes desconhecidas agora mantêm o último valor conhecido, para
 * que uma indisponibilidade temporária não apague o histórico de comparação.
 */
export function mergeSnapshot(previous: TaskSnapshot | null, next: TaskSnapshot): TaskSnapshot {
  if (!previous) return next
  const github =
    next.github === null
      ? previous.github
      : next.github.pr && previous.github?.pr && next.github.pr.number === previous.github.pr.number
        ? {
            ...next.github,
            pr: {
              ...next.github.pr,
              reviewRequests: next.github.pr.reviewRequests ?? previous.github.pr.reviewRequests,
              reviews: next.github.pr.reviews ?? previous.github.pr.reviews,
              unresolvedThreadIds:
                next.github.pr.unresolvedThreadIds ?? previous.github.pr.unresolvedThreadIds
            }
          }
        : next.github
  return { localBranches: next.localBranches ?? previous.localBranches, github }
}

// ---------- Eventos ----------

export interface AutomationEvent {
  /** Chave de idempotência (única em task_events). */
  key: string
  kind: EventKind
  taskId: string
  /** Horário do próprio GitHub, quando existe (ordenação e conflito com movimento manual). */
  at: string | null
  pr?: { number: number }
  branch?: { name: string; where: 'local' | 'remote' }
}

const RANK: Record<EventKind, number> = {
  'branch.created': 0,
  'pr.opened': 1,
  'pr.ready_for_review': 2,
  'pr.review_requested': 3,
  'pr.changes_requested': 3,
  'pr.review_comments_unresolved': 3,
  'pr.approved': 3,
  'pr.merged': 4,
  'pr.closed_unmerged': 4
}

/**
 * Ordem de avaliação (estável e documentada): primeiro o ciclo de vida sem horário (branch,
 * abertura, pronta para review), depois o resto por horário do GitHub (pedidos e reviews na ordem
 * em que aconteceram: o ciclo Revisado → Revisando sai certo), merge/fechamento por último.
 * Empates: ordem do ciclo de vida, depois a chave.
 */
export function compareEvents(a: AutomationEvent, b: AutomationEvent): number {
  const phase = (e: AutomationEvent): number => (RANK[e.kind] <= 2 ? 0 : RANK[e.kind] === 4 ? 2 : 1)
  return (
    phase(a) - phase(b) ||
    (a.at ?? '').localeCompare(b.at ?? '') ||
    RANK[a.kind] - RANK[b.kind] ||
    a.key.localeCompare(b.key)
  )
}

function prEvent(
  kind: EventKind,
  taskId: string,
  number: number,
  key: string,
  at: string | null
): AutomationEvent {
  return { key: `pr#${number}:${key}`, kind, taskId, at, pr: { number } }
}

/**
 * Eventos entre o snapshot anterior e o novo de uma tarefa.
 * - Sem snapshot anterior (primeira observação) → nenhum evento (linha de base).
 * - Parte desconhecida em qualquer lado → aquela parte não gera eventos.
 * - PR principal nova (outro número) → tudo nela é novo (abertura/merge/reviews).
 */
export function deriveEvents(
  taskId: string,
  previous: TaskSnapshot | null,
  next: TaskSnapshot
): AutomationEvent[] {
  if (!previous) return []
  const events: AutomationEvent[] = []

  if (previous.localBranches && next.localBranches) {
    for (const name of next.localBranches) {
      if (!previous.localBranches.includes(name)) {
        events.push({
          key: `branch:local:${name}`,
          kind: 'branch.created',
          taskId,
          at: null,
          branch: { name, where: 'local' }
        })
      }
    }
  }

  const before = previous.github
  const after = next.github
  if (before && after) {
    for (const name of after.remoteBranches) {
      if (!before.remoteBranches.includes(name)) {
        events.push({
          key: `branch:remote:${name}`,
          kind: 'branch.created',
          taskId,
          at: null,
          branch: { name, where: 'remote' }
        })
      }
    }

    const p = before.pr
    const n = after.pr
    if (n) {
      const isNew = !p || p.number !== n.number
      const was = isNew ? null : p
      const num = n.number

      // Abertura / pronta para review.
      if (isNew && n.state === 'open')
        events.push(prEvent('pr.opened', taskId, num, 'opened', null))
      if (was && was.state === 'draft' && n.state === 'open') {
        events.push(prEvent('pr.ready_for_review', taskId, num, 'ready', null))
      }

      // Pedidos de review e reviews: ids novos (com detalhes conhecidos nos dois lados).
      const oldRequests = isNew ? [] : was?.reviewRequests
      if (n.reviewRequests && oldRequests) {
        for (const r of n.reviewRequests) {
          if (!oldRequests.some((o) => o.id === r.id)) {
            events.push(prEvent('pr.review_requested', taskId, num, `review_request:${r.id}`, r.at))
          }
        }
      }
      const oldReviews = isNew ? [] : was?.reviews
      if (n.reviews && oldReviews) {
        for (const r of n.reviews) {
          if (!oldReviews.some((o) => o.id === r.id)) {
            events.push(
              prEvent(
                r.state === 'approved' ? 'pr.approved' : 'pr.changes_requested',
                taskId,
                num,
                `review:${r.id}`,
                r.at
              )
            )
          }
        }
      }
      const oldThreads = isNew ? [] : was?.unresolvedThreadIds
      if (n.unresolvedThreadIds && oldThreads) {
        const added = n.unresolvedThreadIds.filter((id) => !oldThreads.includes(id))
        // Passou de 0 ou aumentou: há thread não resolvida que antes não estava.
        if (added.length > 0) {
          events.push(
            prEvent(
              'pr.review_comments_unresolved',
              taskId,
              num,
              `threads:${added.sort().join(',')}`,
              n.updatedAt
            )
          )
        }
      }

      // Merge / fechamento.
      const wasClosed = was && (was.state === 'merged' || was.state === 'closed')
      if (n.state === 'merged' && (!was || was.state !== 'merged')) {
        events.push(prEvent('pr.merged', taskId, num, 'merged', n.closedAt))
      } else if (n.state === 'closed' && (!was || !wasClosed || was.closedAt !== n.closedAt)) {
        events.push(
          prEvent(
            'pr.closed_unmerged',
            taskId,
            num,
            `closed:${n.closedAt ?? 'sem-data'}`,
            n.closedAt
          )
        )
      }
    }
  }

  return events.sort(compareEvents)
}

// ---------- Regras ----------

export interface RuleConditions {
  /** Só se a tarefa estiver numa destas etapas. Ausente = qualquer etapa. */
  fromStages?: string[]
  /** Tarefa bloqueada → a regra casa mas é ignorada (registrado no histórico). */
  notBlocked?: boolean
  /** Só move "para frente" (etapa de destino depois da atual na ordem do quadro). */
  onlyForward?: boolean
}

export type RuleAction =
  { type: 'move_to_stage'; stageId: string } | { type: 'notify'; message: string }

export interface AutomationRule {
  id: string
  name: string
  enabled: boolean
  trigger: EventKind
  conditions?: RuleConditions
  action: RuleAction
  /** Notificação de desktop ao executar (opcional). */
  notify?: boolean
}

/**
 * Regras padrão do template (Etapa 3B), resolvidas pelos nomes das etapas do quadro. Etapa
 * ausente → a regra fica desligada (e o motivo vai em `warnings`).
 */
export function defaultRules(stages: readonly BoardStage[]): {
  rules: AutomationRule[]
  warnings: string[]
} {
  const warnings: string[] = []
  const id = (name: string): string | null => {
    return stages.find((s) => normalizeLabel(s.name) === normalizeLabel(name))?.id ?? null
  }
  const specs: {
    id: string
    name: string
    trigger: EventKind
    to: string
    from?: string[]
    notify?: boolean
  }[] = [
    {
      id: 'default-branch',
      name: 'Branch criada inicia a tarefa',
      trigger: 'branch.created',
      to: 'Em andamento',
      from: ['Prioridades']
    },
    {
      id: 'default-pr-opened',
      name: 'PR aberta vai para revisão',
      trigger: 'pr.opened',
      to: 'Revisando',
      from: ['Prioridades', 'Em andamento']
    },
    {
      id: 'default-pr-ready',
      name: 'PR pronta para review vai para revisão',
      trigger: 'pr.ready_for_review',
      to: 'Revisando',
      from: ['Prioridades', 'Em andamento']
    },
    {
      id: 'default-changes',
      name: 'Alterações pedidas: revisado',
      trigger: 'pr.changes_requested',
      to: 'Revisado',
      from: ['Revisando']
    },
    {
      id: 'default-comments',
      name: 'Comentários pendentes: revisado',
      trigger: 'pr.review_comments_unresolved',
      to: 'Revisado',
      from: ['Revisando']
    },
    {
      id: 'default-rerequest',
      name: 'Novo pedido de review volta para revisão',
      trigger: 'pr.review_requested',
      to: 'Revisando',
      from: ['Revisado']
    },
    {
      id: 'default-merged',
      name: 'Merge finaliza a tarefa',
      trigger: 'pr.merged',
      to: 'Finalizada'
    },
    {
      id: 'default-closed',
      name: 'PR fechada sem merge volta para andamento',
      trigger: 'pr.closed_unmerged',
      to: 'Em andamento',
      notify: true
    }
  ]
  const rules = specs.map((spec): AutomationRule => {
    const target = id(spec.to)
    const from = spec.from?.map(id)
    const missing = [spec.to, ...(spec.from ?? [])].filter((name) => !id(name))
    if (missing.length > 0) {
      warnings.push(
        `Regra “${spec.name}” desligada: o quadro não tem a etapa ${missing.map((m) => `“${m}”`).join(', ')}.`
      )
    }
    return {
      id: spec.id,
      name: spec.name,
      enabled: missing.length === 0,
      trigger: spec.trigger,
      conditions: {
        notBlocked: true,
        ...(from ? { fromStages: from.filter((f): f is string => f !== null) } : {})
      },
      action: { type: 'move_to_stage', stageId: target ?? '' },
      ...(spec.notify ? { notify: true } : {})
    }
  })
  return { rules, warnings }
}

// ---------- Avaliação ----------

export interface TaskAutomationState {
  stageId: string | null
  blocked: boolean
  /** Automações pausadas nesta tarefa. */
  paused: boolean
  /** Último movimento manual (ISO), para resolver conflito com eventos mais antigos. */
  lastManualMoveAt: string | null
}

export type DecisionOutcome =
  /** Nenhuma regra casou (o evento só entra no histórico). */
  | 'no_rule'
  /** Casou, mas a tarefa já estava na etapa de destino. */
  | 'noop'
  | 'move'
  | 'notify'
  | 'skipped'

export interface AutomationDecision {
  event: AutomationEvent
  ruleId: string | null
  ruleName: string | null
  outcome: DecisionOutcome
  from: string | null
  to: string | null
  /** Motivo de `skipped` (pt-BR, curto). */
  reason?: string
  notify: boolean
  message?: string
}

/**
 * Para cada evento (já ordenado), a primeira regra habilitada que casar decide. As condições são
 * avaliadas contra a etapa já atualizada pelo evento anterior. Uma ação por evento por tarefa.
 */
export function evaluate(
  events: readonly AutomationEvent[],
  rules: readonly AutomationRule[],
  state: TaskAutomationState,
  stages: readonly BoardStage[],
  options: { globallyPaused?: boolean } = {}
): AutomationDecision[] {
  let current = state.stageId
  const order = (id: string | null): number => (id ? stages.findIndex((s) => s.id === id) : -1)
  return events.map((event): AutomationDecision => {
    const rule = rules.find((r) => {
      if (!r.enabled || r.trigger !== event.kind) return false
      const c = r.conditions ?? {}
      if (
        c.fromStages &&
        c.fromStages.length > 0 &&
        (!current || !c.fromStages.includes(current))
      ) {
        return false
      }
      if (r.action.type === 'move_to_stage') {
        if (order(r.action.stageId) < 0) return false
        if (c.onlyForward && order(r.action.stageId) <= order(current)) return false
      }
      return true
    })
    const base = {
      event,
      ruleId: rule?.id ?? null,
      ruleName: rule?.name ?? null,
      from: current,
      notify: rule?.notify === true
    }
    if (!rule) return { ...base, outcome: 'no_rule', to: null, notify: false }

    const skip = (reason: string): AutomationDecision => ({
      ...base,
      outcome: 'skipped',
      to: rule.action.type === 'move_to_stage' ? rule.action.stageId : null,
      reason,
      notify: false
    })
    if (options.globallyPaused) return skip('automações pausadas para todos os projetos')
    if (state.paused) return skip('automações pausadas nesta tarefa')
    if (rule.conditions?.notBlocked && state.blocked) return skip('tarefa bloqueada')
    if (event.at && state.lastManualMoveAt && state.lastManualMoveAt > event.at) {
      return skip('a tarefa foi movida manualmente depois do evento')
    }

    if (rule.action.type === 'notify') {
      return { ...base, outcome: 'notify', to: null, notify: true, message: rule.action.message }
    }
    const to = rule.action.stageId
    if (to === current) return { ...base, outcome: 'noop', to }
    current = to
    return { ...base, outcome: 'move', to }
  })
}

// ---------- Automações (Etapa 3B) ----------

export interface AutomationStatus {
  /** "Pausar todas" ligado. */
  paused: boolean
  /** Situação do GitHub no último ciclo do projeto. */
  github: SignalsGitHubState | 'unknown'
  lastRunAt: string | null
  nextRunAt: string | null
  error: string | null
}

// ---------- Leitura (config e IPC) ----------

function stringList(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((v) => typeof v === 'string') ? value : undefined
}

/** Regra inválida é descartada (as outras continuam). */
export function parseRule(value: unknown): AutomationRule | null {
  if (!isRecord(value)) return null
  const { id, name, trigger } = value
  if (typeof id !== 'string' || !id || typeof name !== 'string') return null
  if (typeof trigger !== 'string' || !(EVENT_KINDS as readonly string[]).includes(trigger))
    return null
  const action = value['action']
  if (!isRecord(action)) return null
  let parsedAction: AutomationRule['action']
  if (action['type'] === 'move_to_stage' && typeof action['stageId'] === 'string') {
    parsedAction = { type: 'move_to_stage', stageId: action['stageId'] }
  } else if (action['type'] === 'notify' && typeof action['message'] === 'string') {
    parsedAction = { type: 'notify', message: action['message'] }
  } else return null
  const c = isRecord(value['conditions']) ? value['conditions'] : {}
  const fromStages = stringList(c['fromStages'])
  const rule: AutomationRule = {
    id,
    name,
    enabled: value['enabled'] === true,
    trigger: trigger as EventKind,
    conditions: {
      ...(fromStages ? { fromStages } : {}),
      ...(c['notBlocked'] === true ? { notBlocked: true } : {}),
      ...(c['onlyForward'] === true ? { onlyForward: true } : {})
    },
    action: parsedAction
  }
  if (value['notify'] === true) rule.notify = true
  return rule
}
