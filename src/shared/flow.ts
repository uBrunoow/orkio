/**
 * Editor do fluxo do projeto (Etapa 3C): etapas + automações sem JSON. Funções puras
 * (renderer e main): frase da regra, validação antes de salvar, simulação com o motor da 3B,
 * diferenças para o histórico de configuração, "Restaurar padrão" e exportar/importar.
 */
import {
  EVENT_KINDS,
  EVENT_LABELS,
  defaultRules,
  evaluate,
  type AutomationDecision,
  type AutomationRule,
  type EventKind
} from './automation'
import {
  DEFAULT_STAGE_TEMPLATE,
  findOption,
  normalizeOptionName,
  stageMatchesStatus,
  type BoardStage,
  type StatusOption
} from './board'
import type { NotionColor } from './ipc-contract'

export const EVENT_DESCRIPTIONS: Record<EventKind, string> = {
  'branch.created': 'Uma branch com o ID da tarefa foi criada (local ou no GitHub).',
  'pr.opened': 'Uma PR com o ID da tarefa foi aberta (não rascunho).',
  'pr.ready_for_review': 'A PR saiu de rascunho e ficou pronta para review.',
  'pr.review_requested': 'Alguém pediu review, inclusive de novo depois de correções.',
  'pr.changes_requested': 'Uma review pediu alterações.',
  'pr.review_comments_unresolved': 'Apareceram comentários de review não resolvidos.',
  'pr.approved': 'Uma review aprovou a PR.',
  'pr.merged': 'A PR foi mergeada.',
  'pr.closed_unmerged': 'A PR foi fechada sem merge.'
}

/** Frase do gatilho ("a PR é aberta"), para "Quando …". */
const EVENT_PHRASES: Record<EventKind, string> = {
  'branch.created': 'uma branch da tarefa é criada',
  'pr.opened': 'a PR é aberta',
  'pr.ready_for_review': 'a PR fica pronta para review',
  'pr.review_requested': 'pedem review',
  'pr.changes_requested': 'a review pede alterações',
  'pr.review_comments_unresolved': 'há comentários de review não resolvidos',
  'pr.approved': 'a PR é aprovada',
  'pr.merged': 'a PR é mergeada',
  'pr.closed_unmerged': 'a PR é fechada sem merge'
}

export const FLOW_COLORS: readonly NotionColor[] = [
  'default',
  'gray',
  'brown',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'pink',
  'red'
]

export interface FlowStageDraft {
  id: string
  name: string
  color?: NotionColor
  /** Id da opção do status do Notion; `null` = não escolhida/inexistente. */
  notionStatusId: string | null
  /** Nome desejado quando a opção não existe (importação, padrão). */
  missingStatusName?: string
}

export interface FlowDraft {
  stages: FlowStageDraft[]
  rules: AutomationRule[]
  /** Etapas removidas → destino das tarefas que estão nelas. */
  removals: Record<string, string | null>
}

// ---------- Frases ----------

function list(names: string[]): string {
  if (names.length <= 1) return names.join('')
  return `${names.slice(0, -1).join(', ')} ou ${names[names.length - 1]}`
}

/** "Quando a PR é aberta e a tarefa está em Em andamento, mover para Revisando. Ignora bloqueadas." */
export function describeRule(
  rule: AutomationRule,
  stages: readonly { id: string; name: string }[]
): string {
  const name = (id: string): string => stages.find((s) => s.id === id)?.name ?? 'etapa removida'
  const from = rule.conditions?.fromStages ?? []
  const where = from.length > 0 ? ` e a tarefa está em ${list(from.map(name))}` : ''
  const action =
    rule.action.type === 'move_to_stage'
      ? `mover para ${name(rule.action.stageId)}`
      : `notificar: “${rule.action.message}”`
  const extras = [
    rule.conditions?.notBlocked ? 'Ignora bloqueadas.' : '',
    rule.conditions?.onlyForward ? 'Só avança.' : '',
    rule.notify && rule.action.type === 'move_to_stage' ? 'Com notificação.' : ''
  ].filter(Boolean)
  return `Quando ${EVENT_PHRASES[rule.trigger]}${where}, ${action}.${extras.length ? ` ${extras.join(' ')}` : ''}`
}

// ---------- Validação ----------

export interface FlowIssue {
  level: 'error' | 'warning'
  kind:
    | 'stage_status'
    | 'stage_name'
    | 'rule_missing_stage'
    | 'rule_incomplete'
    | 'removal_destination'
    | 'conflict'
    | 'cycle'
    | 'unreachable'
  message: string
  stageId?: string
  ruleId?: string
}

export interface FlowContext {
  statusOptions: readonly StatusOption[]
  /** Etapas salvas antes desta edição (para saber o que foi removido). */
  savedStageIds: readonly string[]
  /** Tarefas por etapa (estado local). */
  taskCounts: Readonly<Record<string, number>>
}

/** Origens efetivas de uma regra (sem `fromStages` = todas as etapas). */
function origins(rule: AutomationRule, stageIds: readonly string[]): string[] {
  const from = rule.conditions?.fromStages
  return from && from.length > 0 ? from.filter((id) => stageIds.includes(id)) : [...stageIds]
}

const ordinal = (i: number): string => `${i + 1}ª`

/**
 * Problemas do rascunho. Erros impedem salvar; avisos (conflito, ciclo, regra inalcançável)
 * aparecem antes de salvar e podem ser aceitos.
 */
export function validateFlow(draft: FlowDraft, ctx: FlowContext): FlowIssue[] {
  const issues: FlowIssue[] = []
  const stageIds = draft.stages.map((s) => s.id)
  const stageName = (id: string): string => draft.stages.find((s) => s.id === id)?.name ?? id

  // Etapas.
  if (draft.stages.length === 0) {
    issues.push({
      level: 'error',
      kind: 'stage_name',
      message: 'O fluxo precisa de pelo menos uma etapa.'
    })
  }
  const seen = new Set<string>()
  for (const stage of draft.stages) {
    const name = stage.name.trim()
    if (!name) {
      issues.push({
        level: 'error',
        kind: 'stage_name',
        stageId: stage.id,
        message: 'Dê um nome a cada etapa.'
      })
    } else if (seen.has(normalizeOptionName(name))) {
      issues.push({
        level: 'error',
        kind: 'stage_name',
        stageId: stage.id,
        message: `Há duas etapas chamadas “${name}”.`
      })
    }
    seen.add(normalizeOptionName(name))
    if (!stage.notionStatusId || !ctx.statusOptions.some((o) => o.id === stage.notionStatusId)) {
      issues.push({
        level: 'error',
        kind: 'stage_status',
        stageId: stage.id,
        message: stage.missingStatusName
          ? `A etapa “${name || '(sem nome)'}” usa o status “${stage.missingStatusName}”, que não existe no Notion. Escolha uma opção.`
          : `Escolha o status do Notion da etapa “${name || '(sem nome)'}”.`
      })
    }
  }

  // Remoções com tarefas precisam de destino.
  for (const id of ctx.savedStageIds) {
    if (stageIds.includes(id)) continue
    const count = ctx.taskCounts[id] ?? 0
    const dest = draft.removals[id]
    if (count > 0 && (!dest || !stageIds.includes(dest))) {
      issues.push({
        level: 'error',
        kind: 'removal_destination',
        stageId: id,
        message: `Escolha para onde vão as ${count} tarefa(s) da etapa removida.`
      })
    }
  }

  // Regras: referências e campos.
  draft.rules.forEach((rule, i) => {
    const label = `A regra ${ordinal(i)} (“${rule.name}”)`
    if (rule.action.type === 'move_to_stage' && !stageIds.includes(rule.action.stageId)) {
      issues.push({
        level: 'error',
        kind: 'rule_missing_stage',
        ruleId: rule.id,
        message: `${label} move para uma etapa que não existe mais.`
      })
    }
    if ((rule.conditions?.fromStages ?? []).some((id) => !stageIds.includes(id))) {
      issues.push({
        level: 'error',
        kind: 'rule_missing_stage',
        ruleId: rule.id,
        message: `${label} usa como origem uma etapa que não existe mais.`
      })
    }
    if (rule.action.type === 'notify' && !rule.action.message.trim()) {
      issues.push({
        level: 'error',
        kind: 'rule_incomplete',
        ruleId: rule.id,
        message: `${label} precisa de uma mensagem.`
      })
    }
    if (!(EVENT_KINDS as readonly string[]).includes(rule.trigger)) {
      issues.push({
        level: 'error',
        kind: 'rule_incomplete',
        ruleId: rule.id,
        message: `${label} tem um gatilho desconhecido.`
      })
    }
  })

  // Conflitos, ciclos e regras inalcançáveis (só regras ativas de mover).
  const moves = draft.rules
    .map((rule, index) => ({ rule, index }))
    .filter(
      (
        r
      ): r is {
        rule: AutomationRule & { action: { type: 'move_to_stage'; stageId: string } }
        index: number
      } =>
        r.rule.enabled &&
        r.rule.action.type === 'move_to_stage' &&
        stageIds.includes(r.rule.action.stageId)
    )
  for (let a = 0; a < moves.length; a++) {
    for (let b = a + 1; b < moves.length; b++) {
      const x = moves[a]!
      const y = moves[b]!
      if (x.rule.trigger !== y.rule.trigger) continue
      const overlap = origins(x.rule, stageIds).filter((id) =>
        origins(y.rule, stageIds).includes(id)
      )
      if (overlap.length > 0 && x.rule.action.stageId !== y.rule.action.stageId) {
        issues.push({
          level: 'warning',
          kind: 'conflict',
          ruleId: y.rule.id,
          message:
            `Conflito: quando ${EVENT_PHRASES[x.rule.trigger]} em ${list(overlap.map(stageName))}, ` +
            `a regra ${ordinal(x.index)} (→ ${stageName(x.rule.action.stageId)}) vence a ${ordinal(y.index)} ` +
            `(→ ${stageName(y.rule.action.stageId)}) pela ordem.`
        })
      }
      // Ciclo instantâneo: A → B e B → A pelo mesmo gatilho.
      const xFrom = origins(x.rule, stageIds)
      const yFrom = origins(y.rule, stageIds)
      const xTo = x.rule.action.stageId
      const yTo = y.rule.action.stageId
      if (xTo !== yTo && xFrom.includes(yTo) && yFrom.includes(xTo)) {
        issues.push({
          level: 'warning',
          kind: 'cycle',
          ruleId: y.rule.id,
          message:
            `Ciclo: quando ${EVENT_PHRASES[x.rule.trigger]}, a regra ${ordinal(x.index)} leva ` +
            `${stageName(yTo)} → ${stageName(xTo)} e a ${ordinal(y.index)} leva ${stageName(xTo)} → ${stageName(yTo)}.`
        })
      }
    }
  }
  // Inalcançável: todas as origens já são tratadas por regras ativas anteriores do mesmo gatilho.
  draft.rules.forEach((rule, i) => {
    if (!rule.enabled) return
    const mine = origins(rule, stageIds)
    const covered = new Set(
      draft.rules
        .slice(0, i)
        .filter((r) => r.enabled && r.trigger === rule.trigger)
        .flatMap((r) => origins(r, stageIds))
    )
    if (mine.length > 0 && mine.every((id) => covered.has(id))) {
      issues.push({
        level: 'warning',
        kind: 'unreachable',
        ruleId: rule.id,
        message: `A regra ${ordinal(i)} (“${rule.name}”) nunca age: regras anteriores com o mesmo gatilho já tratam todas as etapas de origem dela.`
      })
    }
  })

  return issues
}

// ---------- Simulação ----------

export interface SimulationInput {
  stageId: string | null
  blocked: boolean
  paused: boolean
  globallyPaused: boolean
  notionStatus: { id: string | null; name: string } | null
}

export interface SimulationResult {
  decision: AutomationDecision
  /** Status do Notion antes/depois (`changes` = false quando não muda). */
  notion: { changes: boolean; from: string | null; to: string | null }
}

/** O que aconteceria com a tarefa se o evento chegasse agora (nada é executado). */
export function simulate(
  draft: Pick<FlowDraft, 'stages' | 'rules'>,
  statusOptions: readonly StatusOption[],
  input: SimulationInput,
  event: EventKind
): SimulationResult {
  const stages = toBoardStages(draft.stages, statusOptions)
  const [decision] = evaluate(
    [{ key: 'simulacao', kind: event, taskId: 'simulacao', at: null, pr: { number: 0 } }],
    draft.rules,
    {
      stageId: input.stageId,
      blocked: input.blocked,
      paused: input.paused,
      lastManualMoveAt: null
    },
    stages,
    { globallyPaused: input.globallyPaused }
  )
  const target =
    decision!.outcome === 'move' ? stages.find((s) => s.id === decision!.to) : undefined
  const changes = target ? !stageMatchesStatus(target, input.notionStatus) : false
  return {
    decision: decision!,
    notion: {
      changes,
      from: input.notionStatus?.name ?? null,
      to: changes ? target!.notionStatus.name : (input.notionStatus?.name ?? null)
    }
  }
}

/** Rascunho → etapas do quadro (para o motor). */
export function toBoardStages(
  stages: readonly FlowStageDraft[],
  options: readonly StatusOption[]
): BoardStage[] {
  return stages.map((s, i) => {
    const option = options.find((o) => o.id === s.notionStatusId)
    return {
      id: s.id,
      name: s.name.trim(),
      order: i,
      notionStatus: option
        ? { id: option.id, name: option.name }
        : { id: null, name: s.missingStatusName ?? '' },
      ...(s.color ? { color: s.color } : option ? { color: option.color } : {})
    }
  })
}

export function fromBoardStages(stages: readonly BoardStage[]): FlowStageDraft[] {
  return stages.map((s) => ({
    id: s.id,
    name: s.name,
    ...(s.color ? { color: s.color } : {}),
    notionStatusId: s.notionStatus.id,
    ...(s.notionStatus.id ? {} : { missingStatusName: s.notionStatus.name })
  }))
}

// ---------- Diferenças (histórico de configuração) ----------

export function diffFlow(
  before: {
    stages: readonly { id: string; name: string; notionStatus: { name: string }; color?: string }[]
    rules: readonly AutomationRule[]
  },
  after: {
    stages: readonly { id: string; name: string; notionStatus: { name: string }; color?: string }[]
    rules: readonly AutomationRule[]
  }
): string[] {
  const changes: string[] = []
  for (const s of after.stages) {
    const old = before.stages.find((b) => b.id === s.id)
    if (!old) {
      const i = after.stages.indexOf(s)
      const prev = after.stages[i - 1]
      const next = after.stages[i + 1]
      const where =
        prev && next
          ? ` entre ${prev.name} e ${next.name}`
          : prev
            ? ` depois de ${prev.name}`
            : next
              ? ` antes de ${next.name}`
              : ''
      changes.push(`Etapa “${s.name}” criada${where} (Notion: ${s.notionStatus.name})`)
      continue
    }
    if (old.name !== s.name) changes.push(`Etapa “${old.name}” renomeada para “${s.name}”`)
    if (old.notionStatus.name !== s.notionStatus.name) {
      changes.push(
        `Etapa “${s.name}”: status do Notion “${old.notionStatus.name}” → “${s.notionStatus.name}”`
      )
    }
    if ((old.color ?? '') !== (s.color ?? '')) changes.push(`Etapa “${s.name}”: cor alterada`)
  }
  for (const s of before.stages) {
    if (!after.stages.some((a) => a.id === s.id)) changes.push(`Etapa “${s.name}” removida`)
  }
  const keptBefore = before.stages
    .filter((s) => after.stages.some((a) => a.id === s.id))
    .map((s) => s.id)
  const keptAfter = after.stages
    .filter((s) => before.stages.some((b) => b.id === s.id))
    .map((s) => s.id)
  if (keptBefore.join() !== keptAfter.join()) changes.push('Ordem das etapas alterada')

  const stagesForRules = after.stages.length ? after.stages : before.stages
  for (const r of after.rules) {
    const old = before.rules.find((b) => b.id === r.id)
    if (!old) {
      changes.push(`Automação criada: ${describeRule(r, stagesForRules)}`)
      continue
    }
    if (old.enabled !== r.enabled)
      changes.push(`Automação “${r.name}” ${r.enabled ? 'ativada' : 'desativada'}`)
    const sameExceptEnabled =
      JSON.stringify({ ...old, enabled: true }) === JSON.stringify({ ...r, enabled: true })
    if (!sameExceptEnabled) {
      changes.push(`Automação “${r.name}” alterada: ${describeRule(r, stagesForRules)}`)
    }
  }
  for (const r of before.rules) {
    if (!after.rules.some((a) => a.id === r.id)) changes.push(`Automação “${r.name}” removida`)
  }
  const ruleOrderBefore = before.rules
    .filter((r) => after.rules.some((a) => a.id === r.id))
    .map((r) => r.id)
  const ruleOrderAfter = after.rules
    .filter((r) => before.rules.some((b) => b.id === r.id))
    .map((r) => r.id)
  if (ruleOrderBefore.join() !== ruleOrderAfter.join())
    changes.push('Ordem das automações alterada')
  return changes
}

// ---------- Restaurar padrão ----------

/**
 * As 5 etapas do template (reaproveitando as existentes com o mesmo nome, para as tarefas
 * continuarem nelas) e as regras padrão.
 */
export function restoreDefaultFlow(
  current: readonly FlowStageDraft[],
  options: readonly StatusOption[],
  newId: () => string
): Pick<FlowDraft, 'stages' | 'rules'> {
  const stages: FlowStageDraft[] = DEFAULT_STAGE_TEMPLATE.map((t) => {
    const existing = current.find(
      (s) => normalizeOptionName(s.name) === normalizeOptionName(t.name)
    )
    const option = findOption(options, { name: t.notionStatus })
    return {
      id: existing?.id ?? newId(),
      name: t.name,
      ...(option ? { color: option.color } : {}),
      notionStatusId: option?.id ?? null,
      ...(option ? {} : { missingStatusName: t.notionStatus })
    }
  })
  return { stages, rules: defaultRules(toBoardStages(stages, options)).rules }
}

// ---------- Exportar / importar ----------

export const FLOW_FILE_FORMAT = 'orkio-flow'
export const FLOW_FILE_VERSION = 1

export interface FlowFile {
  format: typeof FLOW_FILE_FORMAT
  version: number
  exportedAt: string
  stages: { key: string; name: string; color?: NotionColor; notionStatus: string }[]
  rules: (Omit<AutomationRule, 'action' | 'conditions'> & {
    conditions?: { fromStages?: string[]; notBlocked?: boolean; onlyForward?: boolean }
    action: { type: 'move_to_stage'; stage: string } | { type: 'notify'; message: string }
  })[]
}

/** Etapas por chave (posição) e status do Notion por NOME: reaproveitável em outro projeto. */
export function exportFlow(
  draft: Pick<FlowDraft, 'stages' | 'rules'>,
  options: readonly StatusOption[],
  now: string
): FlowFile {
  const key = (id: string): string => `s${draft.stages.findIndex((s) => s.id === id) + 1}`
  return {
    format: FLOW_FILE_FORMAT,
    version: FLOW_FILE_VERSION,
    exportedAt: now,
    stages: draft.stages.map((s) => ({
      key: key(s.id),
      name: s.name,
      ...(s.color ? { color: s.color } : {}),
      notionStatus:
        options.find((o) => o.id === s.notionStatusId)?.name ?? s.missingStatusName ?? ''
    })),
    rules: draft.rules.map((r) => ({
      id: r.id,
      name: r.name,
      enabled: r.enabled,
      trigger: r.trigger,
      ...(r.conditions
        ? {
            conditions: {
              ...(r.conditions.fromStages ? { fromStages: r.conditions.fromStages.map(key) } : {}),
              ...(r.conditions.notBlocked ? { notBlocked: true } : {}),
              ...(r.conditions.onlyForward ? { onlyForward: true } : {})
            }
          }
        : {}),
      action:
        r.action.type === 'move_to_stage'
          ? { type: 'move_to_stage', stage: key(r.action.stageId) }
          : { type: 'notify', message: r.action.message },
      ...(r.notify ? { notify: true } : {})
    }))
  }
}

export type ImportResult =
  | { ok: true; draft: Pick<FlowDraft, 'stages' | 'rules'>; warnings: string[] }
  | { ok: false; error: string }

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Lê um arquivo exportado, checa formato/versão e mapeia os status pelo nome no projeto atual. */
export function importFlow(
  raw: unknown,
  options: readonly StatusOption[],
  newId: () => string
): ImportResult {
  if (!isRecord(raw) || raw['format'] !== FLOW_FILE_FORMAT) {
    return { ok: false, error: 'Este arquivo não é um fluxo exportado pelo Orkio.' }
  }
  const version = raw['version']
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return { ok: false, error: 'Versão do arquivo de fluxo inválida.' }
  }
  if (version > FLOW_FILE_VERSION) {
    return {
      ok: false,
      error: `Este fluxo foi exportado por uma versão mais nova do Orkio (formato ${version}). Atualize o app para importá-lo.`
    }
  }
  const rawStages = raw['stages']
  const rawRules = raw['rules']
  if (!Array.isArray(rawStages) || rawStages.length === 0 || !Array.isArray(rawRules)) {
    return { ok: false, error: 'O arquivo de fluxo está incompleto (sem etapas ou regras).' }
  }
  const warnings: string[] = []
  const idByKey = new Map<string, string>()
  const stages: FlowStageDraft[] = []
  for (const s of rawStages) {
    if (
      !isRecord(s) ||
      typeof s['key'] !== 'string' ||
      typeof s['name'] !== 'string' ||
      typeof s['notionStatus'] !== 'string'
    ) {
      return { ok: false, error: 'O arquivo tem uma etapa em formato inválido.' }
    }
    if (idByKey.has(s['key']))
      return { ok: false, error: `Etapa repetida no arquivo: ${s['key']}.` }
    const id = newId()
    idByKey.set(s['key'], id)
    const option = findOption(options, { name: s['notionStatus'] })
    if (!option)
      warnings.push(
        `O status “${s['notionStatus']}” da etapa “${s['name']}” não existe neste Notion.`
      )
    const color =
      typeof s['color'] === 'string' && (FLOW_COLORS as readonly string[]).includes(s['color'])
        ? (s['color'] as NotionColor)
        : undefined
    stages.push({
      id,
      name: s['name'],
      ...(color ? { color } : {}),
      notionStatusId: option?.id ?? null,
      ...(option ? {} : { missingStatusName: s['notionStatus'] })
    })
  }
  const rules: AutomationRule[] = []
  for (const r of rawRules) {
    if (!isRecord(r) || typeof r['name'] !== 'string' || typeof r['trigger'] !== 'string') {
      return { ok: false, error: 'O arquivo tem uma automação em formato inválido.' }
    }
    if (!(EVENT_KINDS as readonly string[]).includes(r['trigger'])) {
      return { ok: false, error: `Gatilho desconhecido no arquivo: ${r['trigger']}.` }
    }
    const action = r['action']
    let parsed: AutomationRule['action']
    if (
      isRecord(action) &&
      action['type'] === 'move_to_stage' &&
      typeof action['stage'] === 'string'
    ) {
      const id = idByKey.get(action['stage'])
      if (!id)
        return {
          ok: false,
          error: `A automação “${r['name']}” aponta para uma etapa que não está no arquivo.`
        }
      parsed = { type: 'move_to_stage', stageId: id }
    } else if (
      isRecord(action) &&
      action['type'] === 'notify' &&
      typeof action['message'] === 'string'
    ) {
      parsed = { type: 'notify', message: action['message'] }
    } else {
      return { ok: false, error: `A automação “${r['name']}” tem uma ação inválida.` }
    }
    const c = isRecord(r['conditions']) ? r['conditions'] : {}
    const from = Array.isArray(c['fromStages']) ? c['fromStages'] : []
    const fromIds = from.map((k) => (typeof k === 'string' ? idByKey.get(k) : undefined))
    if (fromIds.some((id) => !id)) {
      return {
        ok: false,
        error: `A automação “${r['name']}” usa uma etapa de origem que não está no arquivo.`
      }
    }
    rules.push({
      id: `rule-${newId()}`,
      name: r['name'],
      enabled: r['enabled'] !== false,
      trigger: r['trigger'] as EventKind,
      conditions: {
        ...(fromIds.length ? { fromStages: fromIds as string[] } : {}),
        ...(c['notBlocked'] === true ? { notBlocked: true } : {}),
        ...(c['onlyForward'] === true ? { onlyForward: true } : {})
      },
      action: parsed,
      ...(r['notify'] === true ? { notify: true } : {})
    })
  }
  return { ok: true, draft: { stages, rules }, warnings }
}

export { EVENT_KINDS, EVENT_LABELS }
