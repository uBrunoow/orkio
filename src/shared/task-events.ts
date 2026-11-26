/**
 * Catálogo dos eventos do histórico da tarefa (`task_events`): para cada tipo, o formato do
 * `detail`, de onde vem (`source`), o grupo na atividade, se aparece na sessão da tarefa, se muda a
 * etapa e quem "fala" na linha do histórico. Tudo o que classifica eventos (main, overview,
 * renderer) lê daqui; um tipo novo é uma entrada nova, e o TypeScript aponta o que falta.
 *
 * O `detail` lido do banco passa por `parseTaskEvent` (tolerante): campo com tipo errado ou de
 * linha antiga some, tipo desconhecido vira `null`. Nunca lança.
 */
import { EVENT_KINDS, type EventKind } from './automation'
import { ARTIFACT_PUBLISH_MODES } from './agent-run'
import { isRecord } from './guards'
import { FLOW_PAUSE_REASONS } from './flow-run-state'
import { FLOW_RESULTS } from './flow-final'

/**
 * Quem causou o evento: você (`manual`), o Notion, uma automação (regra, orquestrador, regra de
 * agente) ou o próprio Orkio (`system`: fluxo, execução do Claude Code, entrega, remoção de etapa).
 */
export const TASK_EVENT_SOURCES = ['manual', 'notion', 'automation', 'system'] as const
export type TaskEventSource = (typeof TASK_EVENT_SOURCES)[number]

export const ACTIVITY_GROUPS = [
  'board',
  'automation',
  'claude',
  'flow',
  'delivery',
  'notion'
] as const
export type ActivityGroup = (typeof ACTIVITY_GROUPS)[number]

/** O que um push/PR/comentário feito pelo Orkio ou pelo modo entrega foi (histórico). */
export const DELIVERY_ACTIONS = [
  'push',
  'pr_create',
  'pr_edit',
  'pr_comment',
  'pr_ready',
  'thread_reply',
  'thread_resolve',
  'review_request',
  'review_post'
] as const
export type DeliveryAction = (typeof DELIVERY_ACTIONS)[number]

interface Field<T, R extends boolean> {
  readonly check: (v: unknown) => v is T
  readonly required: R
}

function field<T>(check: (v: unknown) => v is T): Field<T, false> {
  return { check, required: false }
}
function req<T>(f: Field<T, false>): Field<T, true> {
  return { check: f.check, required: true }
}

const isString = (v: unknown): v is string => typeof v === 'string'
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isBoolean = (v: unknown): v is boolean => typeof v === 'boolean'
const orNull =
  <T>(check: (v: unknown) => v is T) =>
  (v: unknown): v is T | null =>
    v === null || check(v)
const oneOf =
  <const T extends string>(values: readonly T[]) =>
  (v: unknown): v is T =>
    typeof v === 'string' && (values as readonly string[]).includes(v)

const SERVER_ACTORS = ['you', 'agent'] as const
const SERVER_STOP_ACTORS = ['you', 'agent', 'exit'] as const

/** PR citada no evento (owner/repo só quando o repositório é do github.com). */
export interface EventPr {
  number: number
  owner?: string
  repo?: string
}
function isEventPr(v: unknown): v is EventPr {
  return (
    isRecord(v) &&
    isNumber(v['number']) &&
    (v['owner'] === undefined || isString(v['owner'])) &&
    (v['repo'] === undefined || isString(v['repo']))
  )
}
export interface EventBranch {
  name: string
  where: 'local' | 'remote'
}
function isEventBranch(v: unknown): v is EventBranch {
  return isRecord(v) && isString(v['name']) && (v['where'] === 'local' || v['where'] === 'remote')
}

const str = field(isString)
const num = field(isNumber)
const bool = field(isBoolean)
const strOrNull = field(orNull(isString))
const numOrNull = field(orNull(isNumber))
const pr = field(isEventPr)

const AUTOMATION_OUTCOMES = ['no_rule', 'noop', 'move', 'notify', 'skipped'] as const

const AUTOMATION_FIELDS = {
  event: field(oneOf<EventKind>(EVENT_KINDS)),
  ruleId: strOrNull,
  ruleName: strOrNull,
  outcome: field(oneOf(AUTOMATION_OUTCOMES)),
  reason: str,
  branch: field(isEventBranch),
  pr
}
const RUN_END = { runId: req(str), files: req(num), costUsd: numOrNull }
const STEP = { flowRunId: req(str), step: req(strOrNull), stepName: str }

/**
 * Quem aparece como autor da linha no histórico. `source` = decidido pelo `source` do evento.
 * Um `detail.agent` (nome do agente) sempre vence.
 */
export type EventActorKind = 'claude' | 'you' | 'github' | 'notion' | 'flow' | 'source'

interface KindMeta {
  /** Origem fixa do tipo, ou `varies` (quem grava informa). */
  readonly source: TaskEventSource | 'varies'
  /** Grupos possíveis na atividade (vazio = fora da atividade). */
  readonly groups: readonly ActivityGroup[]
  /** Aparece na conversa da tarefa (a execução do Claude Code já conta início/fim e passos). */
  readonly inSession: boolean
  /** Muda a etapa: `enters` = entrada numa etapa; `reverts` = volta pela recusa do Notion. */
  readonly stage: 'enters' | 'reverts' | null
  /** Depois deste evento, uma recusa do Notion anterior deixa de esperar você. */
  readonly settlesRejection: boolean
  readonly actor: EventActorKind
  readonly detail: Readonly<Record<string, Field<unknown, boolean>>>
}

const meta = <
  const S extends KindMeta['source'],
  const D extends Record<string, Field<unknown, boolean>>
>(
  m: Omit<KindMeta, 'source' | 'detail' | 'inSession' | 'stage' | 'settlesRejection'> & {
    source: S
    detail: D
    inSession?: boolean
    stage?: KindMeta['stage']
    settlesRejection?: boolean
  }
): Omit<KindMeta, 'source' | 'detail'> & { source: S; detail: D } => ({
  inSession: true,
  stage: null,
  settlesRejection: false,
  ...m
})

export const TASK_EVENTS = {
  added: meta({
    source: 'notion',
    groups: ['board'],
    stage: 'enters',
    actor: 'source',
    detail: {}
  }),
  moved: meta({
    // manual (você), automation (regra/orquestrador) ou system (remoção de etapa).
    source: 'varies',
    groups: ['board', 'automation'],
    stage: 'enters',
    settlesRejection: true,
    actor: 'source',
    detail: {
      ...AUTOMATION_FIELDS,
      orchestrator: field(oneOf(['pull', 'handoff'])),
      agent: str,
      agentKey: str,
      flow: field(oneOf(['stage_removed', 'pr_merged', 'review_self'])),
      removedStage: str,
      notionStatus: str
    }
  }),
  reconciled: meta({
    source: 'notion',
    groups: ['board'],
    stage: 'enters',
    settlesRejection: true,
    actor: 'source',
    detail: { status: req(strOrNull) }
  }),
  blocked: meta({ source: 'varies', groups: ['board'], actor: 'source', detail: {} }),
  unblocked: meta({ source: 'varies', groups: ['board'], actor: 'source', detail: {} }),
  sync_ok: meta({
    source: 'notion',
    groups: [],
    inSession: false,
    settlesRejection: true,
    actor: 'source',
    detail: {}
  }),
  rolled_back: meta({
    source: 'notion',
    groups: ['notion'],
    stage: 'reverts',
    actor: 'source',
    detail: { code: req(str) }
  }),
  automation: meta({
    source: 'automation',
    groups: ['automation'],
    actor: 'source',
    detail: {
      ...AUTOMATION_FIELDS,
      event: req(AUTOMATION_FIELDS.event),
      outcome: req(AUTOMATION_FIELDS.outcome)
    }
  }),
  /**
   * Fluxo Git: a Etapa Git (e o link/data da PR) escrita no Notion pelos eventos do GitHub, ou a
   * recusa do Notion. `reason` = evento consumido sem escrita (pausa, já estava assim).
   */
  git_flow: meta({
    source: 'automation',
    groups: ['automation'],
    inSession: false,
    actor: 'source',
    detail: {
      event: AUTOMATION_FIELDS.event,
      stage: str,
      prNumber: num,
      rejected: str,
      reason: str
    }
  }),
  automation_paused: meta({ source: 'manual', groups: ['board'], actor: 'source', detail: {} }),
  automation_resumed: meta({ source: 'manual', groups: ['board'], actor: 'source', detail: {} }),
  run_started: meta({
    source: 'system',
    groups: ['claude'],
    inSession: false,
    actor: 'claude',
    detail: {
      runId: req(str),
      mode: req(field(oneOf(['prompt', 'command']))),
      command: strOrNull,
      resumed: bool,
      agent: str,
      agentKey: str
    }
  }),
  run_finished: meta({
    source: 'system',
    groups: ['claude'],
    inSession: false,
    actor: 'claude',
    detail: RUN_END
  }),
  run_cancelled: meta({
    source: 'system',
    groups: ['claude'],
    inSession: false,
    actor: 'claude',
    detail: RUN_END
  }),
  run_failed: meta({
    source: 'system',
    groups: ['claude'],
    inSession: false,
    actor: 'claude',
    detail: RUN_END
  }),
  run_blocked: meta({
    source: 'system',
    groups: ['claude'],
    inSession: false,
    actor: 'claude',
    detail: { runId: req(str), tool: req(str), reason: req(str) }
  }),
  artifact_attached: meta({
    source: 'manual',
    groups: ['claude'],
    actor: 'source',
    detail: { path: req(str), commit: req(str) }
  }),
  artifact_published: meta({
    source: 'manual',
    groups: ['claude'],
    actor: 'notion',
    detail: { path: req(str), mode: req(field(oneOf(ARTIFACT_PUBLISH_MODES))) }
  }),
  flow_started: meta({
    source: 'system',
    groups: ['flow'],
    actor: 'flow',
    detail: {
      flowRunId: req(str),
      flowId: str,
      flow: req(str),
      agent: str,
      agentKey: str,
      waiting: bool
    }
  }),
  step_started: meta({
    source: 'system',
    groups: ['flow'],
    inSession: false,
    actor: 'flow',
    detail: STEP
  }),
  step_finished: meta({
    source: 'system',
    groups: ['flow'],
    inSession: false,
    actor: 'flow',
    detail: { ...STEP, runId: str, message: str, choice: str }
  }),
  step_failed: meta({
    source: 'system',
    groups: ['flow'],
    actor: 'flow',
    detail: { ...STEP, runId: str, message: str }
  }),
  step_skipped: meta({ source: 'manual', groups: ['flow'], actor: 'flow', detail: STEP }),
  gate_waiting: meta({ source: 'system', groups: ['flow'], actor: 'flow', detail: STEP }),
  gate_approved: meta({ source: 'manual', groups: ['flow'], actor: 'you', detail: STEP }),
  gate_rejected: meta({ source: 'manual', groups: ['flow'], actor: 'you', detail: STEP }),
  /** Você pediu ajustes no gate (o passo de ajustes roda de novo na mesma sessão). */
  gate_revised: meta({
    source: 'manual',
    groups: ['flow'],
    actor: 'you',
    detail: { ...STEP, round: req(num) }
  }),
  flow_paused: meta({
    source: 'system',
    groups: ['flow'],
    actor: 'flow',
    detail: {
      flowRunId: req(str),
      reason: req(field(oneOf(FLOW_PAUSE_REASONS))),
      step: req(strOrNull),
      stepName: str
    }
  }),
  flow_finished: meta({
    source: 'system',
    groups: ['flow'],
    actor: 'flow',
    detail: {
      flowRunId: req(str),
      result: req(field(orNull(oneOf(FLOW_RESULTS))))
    }
  }),
  /** Entrega (5C): push/PR/comentário/resolução/pedido de review feitos pelo Orkio ou pelo Claude. */
  delivery: meta({
    source: 'system',
    groups: ['delivery'],
    actor: 'github',
    detail: {
      runId: str,
      by: req(field(oneOf(['orkio', 'claude']))),
      action: req(field(oneOf(DELIVERY_ACTIONS))),
      owner: req(str),
      repo: req(str),
      branch: str,
      commits: num,
      command: str,
      reviewers: num,
      reviewEvent: str,
      /** Revisão publicada pelo `gh` do usuário (projeto só com git local), não como orkio[bot]. */
      via: field(oneOf(['gh'])),
      comments: num,
      reviewId: num,
      pr
    }
  }),
  /** Agentes (8A): atribuição da tarefa (à mão, pela regra da coluna ou pelo orquestrador). */
  agent_assigned: meta({
    source: 'varies',
    groups: ['board'],
    actor: 'source',
    detail: {
      agentKey: req(str),
      agent: req(str),
      by: req(field(oneOf(['manual', 'rule', 'orchestrator'])))
    }
  }),
  agent_unassigned: meta({
    source: 'varies',
    groups: ['board'],
    actor: 'source',
    detail: {
      agentKey: req(strOrNull),
      agent: req(str),
      by: req(field(oneOf(['manual', 'rule', 'orchestrator'])))
    }
  }),
  /** Fase 2: "Continuar no Claude": a sessão da tarefa foi para o seu terminal (travada). */
  handoff_started: meta({
    source: 'manual',
    groups: ['claude'],
    actor: 'you',
    detail: { sessionId: str }
  }),
  /** Você devolveu a sessão ao Orkio: o Claude continua o passo ou o passo está feito. */
  handoff_returned: meta({
    source: 'manual',
    groups: ['claude'],
    actor: 'you',
    detail: { mode: req(field(oneOf(['continue', 'done', 'release']))) }
  }),
  /** Servidor da tarefa subiu (por você ou pelo agente), na porta dele. */
  server_started: meta({
    source: 'varies',
    groups: ['claude'],
    actor: 'source',
    detail: {
      server: req(str),
      port: req(num),
      by: req(field(oneOf(SERVER_ACTORS)))
    }
  }),
  /** Servidor parou: por você, pelo agente ou sozinho (`exit`, com o código). */
  server_stopped: meta({
    source: 'varies',
    groups: ['claude'],
    actor: 'source',
    detail: {
      server: req(str),
      by: req(field(oneOf(SERVER_STOP_ACTORS))),
      exitCode: numOrNull
    }
  })
} as const satisfies Record<string, KindMeta>

export type TaskEventKind = keyof typeof TASK_EVENTS
export const TASK_EVENT_KINDS = Object.keys(TASK_EVENTS) as TaskEventKind[]

type FieldsOf<K extends TaskEventKind> = (typeof TASK_EVENTS)[K]['detail']
type FieldValue<F> = F extends Field<infer T, boolean> ? T : never
type RequiredKeys<D> = { [P in keyof D]: D[P] extends Field<unknown, true> ? P : never }[keyof D]

/** `detail` como gravado agora (campos obrigatórios exigidos). */
export type TaskEventDetailInput<K extends TaskEventKind> = {
  -readonly [P in RequiredKeys<FieldsOf<K>>]: FieldValue<FieldsOf<K>[P]>
} & {
  -readonly [P in Exclude<keyof FieldsOf<K>, RequiredKeys<FieldsOf<K>>>]?: FieldValue<
    FieldsOf<K>[P]
  >
}

/** `detail` lido do banco: todo campo pode faltar (linhas antigas). */
export type TaskEventDetail<K extends TaskEventKind> = {
  -readonly [P in keyof FieldsOf<K>]?: FieldValue<FieldsOf<K>[P]>
}

/** Tipos cuja origem depende de quem grava. */
export type VaryingSourceKind = {
  [K in TaskEventKind]: (typeof TASK_EVENTS)[K]['source'] extends 'varies' ? K : never
}[TaskEventKind]

/** Evento do histórico (sem id/horário), discriminado por `kind`. */
export type TaskEvent = {
  [K in TaskEventKind]: {
    kind: K
    source: TaskEventSource
    fromStage: string | null
    toStage: string | null
    detail: TaskEventDetail<K>
  }
}[TaskEventKind]

/** Evento a gravar: `source` só quando o tipo não tem origem fixa. */
export type NewTaskEvent = {
  [K in TaskEventKind]: {
    kind: K
    detail: TaskEventDetailInput<K>
    fromStage?: string | null
    toStage?: string | null
  } & (K extends VaryingSourceKind ? { source: TaskEventSource } : { source?: never })
}[TaskEventKind]

export function isTaskEventKind(v: unknown): v is TaskEventKind {
  return typeof v === 'string' && Object.hasOwn(TASK_EVENTS, v)
}

/** Origem gravada de um evento novo (a do catálogo, ou a informada quando varia). */
export function eventSource(e: NewTaskEvent): TaskEventSource {
  const fixed = TASK_EVENTS[e.kind].source
  return fixed === 'varies' ? (e.source as TaskEventSource) : fixed
}

/**
 * Linha do banco → evento tipado. Tolerante: tipo desconhecido → `null`; campo do `detail` com tipo
 * errado (ou que não existe mais) some; `source` fora da lista vira a origem do catálogo.
 */
export function parseTaskEvent(row: {
  kind: string
  source: string
  fromStage: string | null
  toStage: string | null
  detail: unknown
}): TaskEvent | null {
  if (!isTaskEventKind(row.kind)) return null
  const m: KindMeta = TASK_EVENTS[row.kind]
  const detail: Record<string, unknown> = {}
  if (isRecord(row.detail)) {
    for (const [name, f] of Object.entries(m.detail)) {
      const value = row.detail[name]
      if (value !== undefined && f.check(value)) detail[name] = value
    }
  }
  const source = (TASK_EVENT_SOURCES as readonly string[]).includes(row.source)
    ? (row.source as TaskEventSource)
    : m.source === 'varies'
      ? 'manual'
      : m.source
  return {
    kind: row.kind,
    source,
    fromStage: row.fromStage,
    toStage: row.toStage,
    detail
  } as TaskEvent
}

/** JSON do `detail_json` (texto ilegível = sem detalhe). */
export function parseDetailJson(json: string | null): unknown {
  if (!json) return null
  try {
    return JSON.parse(json) as unknown
  } catch {
    return null
  }
}

const kindsWhere = (pred: (m: KindMeta) => boolean): TaskEventKind[] =>
  TASK_EVENT_KINDS.filter((k) => pred(TASK_EVENTS[k]))

/** Tipos de evento de cada grupo da atividade (`sync_ok` fica de fora: é ruído). */
export const ACTIVITY_KINDS: Record<ActivityGroup, readonly TaskEventKind[]> = {
  board: kindsWhere((m) => m.groups.includes('board')),
  automation: kindsWhere((m) => m.groups.includes('automation')),
  claude: kindsWhere((m) => m.groups.includes('claude')),
  flow: kindsWhere((m) => m.groups.includes('flow')),
  delivery: kindsWhere((m) => m.groups.includes('delivery')),
  notion: kindsWhere((m) => m.groups.includes('notion'))
}

export const STAGE_EVENT_KINDS = kindsWhere((m) => m.stage !== null)
export const STAGE_ENTRY_KINDS = kindsWhere((m) => m.stage === 'enters')
export const SETTLES_REJECTION_KINDS = kindsWhere((m) => m.settlesRejection)

/** Grupo de um evento na atividade (`null` = fica fora). */
export function activityGroup(e: TaskEvent): ActivityGroup | null {
  if (e.kind === 'moved') return e.source === 'automation' ? 'automation' : 'board'
  if (e.kind === 'automation' && e.detail.outcome === 'noop') return null
  if (e.kind === 'git_flow' && e.detail.reason !== undefined) return null
  return TASK_EVENTS[e.kind].groups[0] ?? null
}

export function isSessionEvent(e: Pick<TaskEvent, 'kind'>): boolean {
  return TASK_EVENTS[e.kind].inSession
}

export type EventActor =
  | { kind: 'agent'; name: string }
  | { kind: 'claude' | 'you' | 'github' | 'notion' | 'flow' | 'automation' | 'orkio' }

export function eventActor(e: TaskEvent): EventActor {
  const agent = 'agent' in e.detail ? e.detail.agent : undefined
  if (agent) return { kind: 'agent', name: agent }
  const actor = TASK_EVENTS[e.kind].actor
  if (actor !== 'source') return { kind: actor }
  switch (e.source) {
    case 'notion':
      return { kind: 'notion' }
    case 'automation':
      return { kind: 'automation' }
    case 'system':
      return { kind: 'orkio' }
    case 'manual':
      return { kind: 'you' }
  }
}
