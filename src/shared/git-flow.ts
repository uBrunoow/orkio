/**
 * Fluxo Git (motor puro): decide a "Etapa Git" de uma tarefa no Notion a partir dos eventos do
 * git/GitHub. Sem Node/DOM. O main aplica o resultado pela fila de escritas; aqui só há regras:
 * só para frente (com duas exceções), destino que conta, PR (url) sem apagar nada.
 */
import type { AutomationEvent } from './automation'
import { NEVER_PR_BASES } from './delivery'
import type { NotionPropertySummary } from './notion'
import { normalizeLabel } from './text'

export type GitStageKey = 'branch' | 'review' | 'changes' | 'merged'

export const GIT_STAGE_KEYS: readonly GitStageKey[] = ['branch', 'review', 'changes', 'merged']

export const GIT_STAGE_LABEL: Record<GitStageKey, string> = {
  branch: 'Branch criada',
  review: 'PR aguardando review',
  changes: 'Ajustes solicitados',
  merged: 'Mergeada na dev'
}

interface PropRef {
  id: string
  name: string
}

export interface GitFlowConfig {
  stage: { id: string; name: string; type: 'select' | 'status' }
  options: Partial<Record<GitStageKey, PropRef>>
  prUrl?: PropRef
  mergedAt?: PropRef
  backfilledAt?: string
}

/** O que a tela envia ao salvar o Fluxo Git: ids de propriedade e de opção. */
export interface GitFlowInput {
  stagePropertyId: string
  options: Partial<Record<GitStageKey, string>>
  prUrlPropertyId: string | null
  mergedAtPropertyId: string | null
}

/** Estado para a tela: o que está salvo, a sugestão e as propriedades que servem ao Fluxo Git. */
export interface GitFlowSetup {
  config: GitFlowConfig | null
  suggestion: GitFlowConfig | null
  /** select/status/url/date do banco de Tarefas. */
  properties: NotionPropertySummary[]
}

/** Valor atual da etapa; aceita campos a mais (ex.: `color`). */
export interface GitFlowStageValue {
  id?: string | null
  name: string
  [extra: string]: unknown
}

export interface GitFlowTaskValue {
  stage: GitFlowStageValue | null
  prUrl: string | null
}

export interface GitFlowPr {
  number: number
  url: string
  baseRef: string | null
  state: 'draft' | 'open' | 'merged' | 'closed'
  closedAt: string | null
  changesRequested: boolean
}

export interface GitFlowChange {
  stage: GitStageKey | null
  prUrl: string | null
  mergedAt: string | null
}

type Order = readonly { id: string; name: string }[]

/** Só PR para base diferente de main/master conta; base desconhecida não conta. */
export function countsAsTarget(baseRef: string | null): boolean {
  if (!baseRef) return false
  return !NEVER_PR_BASES.includes(baseRef.toLowerCase())
}

const OPTION_MATCHERS: Record<GitStageKey, (label: string) => boolean> = {
  branch: (l) => l.startsWith('branch criada'),
  review: (l) => l.includes('aguardando review'),
  changes: (l) => l.includes('ajustes solicitados'),
  merged: (l) => l.startsWith('mergead') && !l.includes('main') && !l.includes('prod')
}

export function suggestGitFlow(properties: readonly NotionPropertySummary[]): GitFlowConfig | null {
  let best: {
    prop: NotionPropertySummary
    options: GitFlowConfig['options']
    score: number
  } | null = null
  for (const prop of properties) {
    if (prop.type !== 'select' && prop.type !== 'status') continue
    const options: GitFlowConfig['options'] = {}
    for (const key of GIT_STAGE_KEYS) {
      const found = prop.options?.find((o) => OPTION_MATCHERS[key](normalizeLabel(o.name)))
      if (found) options[key] = { id: found.id, name: found.name }
    }
    const score = Object.keys(options).length
    if (score < 2) continue
    const named = normalizeLabel(prop.name) === 'etapa git' ? 1 : 0
    if (!best || score + named > best.score) best = { prop, options, score: score + named }
  }
  if (!best) return null
  const config: GitFlowConfig = {
    stage: { id: best.prop.id, name: best.prop.name, type: best.prop.type as 'select' | 'status' },
    options: best.options
  }
  const prUrl = properties.find((p) => {
    if (p.type !== 'url') return false
    const n = normalizeLabel(p.name)
    return n === 'pr' || n.startsWith('pr ') || n.includes('pull request') || n === 'link da pr'
  })
  if (prUrl) config.prUrl = { id: prUrl.id, name: prUrl.name }
  const mergedAt = properties.find(
    (p) => p.type === 'date' && normalizeLabel(p.name).includes('merge')
  )
  if (mergedAt) config.mergedAt = { id: mergedAt.id, name: mergedAt.name }
  return config
}

/** Revalida o mapeamento contra o schema atual: renomeada atualiza, apagada/tipo mudou sai. */
export function checkGitFlow(
  config: GitFlowConfig,
  properties: readonly NotionPropertySummary[]
): { config: GitFlowConfig | null; warnings: string[] } {
  const warnings: string[] = []
  const stageProp = properties.find((p) => p.id === config.stage.id)
  if (!stageProp || stageProp.type !== config.stage.type) {
    warnings.push(
      `A propriedade "${config.stage.name}" do Fluxo Git não existe mais ou mudou de tipo.`
    )
    return { config: null, warnings }
  }
  const options: GitFlowConfig['options'] = {}
  for (const key of GIT_STAGE_KEYS) {
    const mapped = config.options[key]
    if (!mapped) continue
    const found = stageProp.options?.find((o) => o.id === mapped.id)
    if (!found) {
      warnings.push(`A opção "${mapped.name}" da ${stageProp.name} não existe mais.`)
      continue
    }
    options[key] = { id: found.id, name: found.name }
  }
  const next: GitFlowConfig = {
    stage: { id: stageProp.id, name: stageProp.name, type: config.stage.type },
    options
  }
  if (config.backfilledAt !== undefined) next.backfilledAt = config.backfilledAt
  const optional = (ref: PropRef | undefined, type: string, label: string): PropRef | undefined => {
    if (!ref) return undefined
    const prop = properties.find((p) => p.id === ref.id)
    if (!prop || prop.type !== type) {
      warnings.push(`A propriedade "${ref.name}" (${label}) do Fluxo Git não existe mais.`)
      return undefined
    }
    return { id: prop.id, name: prop.name }
  }
  const prUrl = optional(config.prUrl, 'url', 'link da PR')
  if (prUrl) next.prUrl = prUrl
  const mergedAt = optional(config.mergedAt, 'date', 'data do merge')
  if (mergedAt) next.mergedAt = mergedAt
  return { config: next, warnings }
}

function indexOfOption(opt: { id?: string | null; name: string }, order: Order): number {
  if (opt.id) {
    const byId = order.findIndex((o) => o.id === opt.id)
    if (byId >= 0) return byId
  }
  const name = normalizeLabel(opt.name)
  return order.findIndex((o) => normalizeLabel(o.name) === name)
}

function optionIndex(config: GitFlowConfig, key: GitStageKey, order: Order): number {
  const opt = config.options[key]
  return opt ? order.findIndex((o) => o.id === opt.id) : -1
}

/** A etapa a escrever (ou `null` = não escreve), pelas regras de ordem. */
export function nextGitStage(
  current: GitFlowStageValue | null,
  target: GitStageKey,
  config: GitFlowConfig,
  order: Order
): GitStageKey | null {
  const targetIdx = optionIndex(config, target, order)
  if (targetIdx < 0) return null
  if (!current || (!current.id && !current.name.trim())) return target
  const cur = indexOfOption(current, order)
  if (cur < 0 || cur === targetIdx) return null
  const reviewIdx = optionIndex(config, 'review', order)
  const changesIdx = optionIndex(config, 'changes', order)
  const mergedIdx = optionIndex(config, 'merged', order)
  if (
    target === 'changes' &&
    reviewIdx >= 0 &&
    cur >= reviewIdx &&
    (mergedIdx < 0 || cur < mergedIdx)
  ) {
    return target
  }
  if (target === 'review' && changesIdx >= 0 && cur === changesIdx) return target
  return targetIdx > cur ? target : null
}

const PR_URL_RE = /^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/\d+\/?$/i

function prUrlChange(
  task: GitFlowTaskValue,
  pr: GitFlowPr,
  repo: { owner: string; name: string } | null
): string | null {
  const current = task.prUrl?.trim() ?? ''
  if (current === pr.url) return null
  if (current === '') return pr.url
  const m = PR_URL_RE.exec(current)
  if (!m || !repo) return null
  const same =
    m[1]?.toLowerCase() === repo.owner.toLowerCase() &&
    m[2]?.toLowerCase() === repo.name.toLowerCase()
  return same ? pr.url : null
}

const EVENT_TARGET: Partial<Record<AutomationEvent['kind'], GitStageKey>> = {
  'branch.created': 'branch',
  'pr.opened': 'review',
  'pr.ready_for_review': 'review',
  'pr.changes_requested': 'changes',
  'pr.review_requested': 'review',
  'pr.merged': 'merged'
}

export function gitFlowForEvents(
  events: readonly AutomationEvent[],
  task: GitFlowTaskValue,
  pr: GitFlowPr | null,
  repo: { owner: string; name: string } | null,
  config: GitFlowConfig,
  order: Order
): GitFlowChange | null {
  let stage = task.stage
  let stageKey: GitStageKey | null = null
  let mergedAt: string | null = null
  let prUrl: string | null = null
  for (const event of events) {
    const target = EVENT_TARGET[event.kind]
    if (!target) continue
    if (target === 'branch') {
      const next = nextGitStage(stage, 'branch', config, order)
      if (next) {
        stageKey = next
        stage = { id: config.options[next]?.id ?? null, name: config.options[next]?.name ?? '' }
      }
      continue
    }
    if (!pr || !countsAsTarget(pr.baseRef)) continue
    // Review pedida só volta de "Ajustes solicitados"; senão é o mesmo que já está.
    if (event.kind === 'pr.review_requested') {
      const changesIdx = optionIndex(config, 'changes', order)
      if (!stage || changesIdx < 0 || indexOfOption(stage, order) !== changesIdx) continue
    }
    const url = prUrlChange(task, pr, repo)
    if (url) prUrl = url
    const next = nextGitStage(stage, target, config, order)
    if (next) {
      stageKey = next
      stage = { id: config.options[next]?.id ?? null, name: config.options[next]?.name ?? '' }
      if (next === 'merged') mergedAt = pr.closedAt
    }
  }
  // Mudança líquida: voltar ao valor de partida não escreve nada.
  if (stageKey && task.stage) {
    const start = indexOfOption(task.stage, order)
    if (start >= 0 && start === optionIndex(config, stageKey, order)) {
      stageKey = null
      mergedAt = null
    }
  }
  if (!stageKey && !prUrl) return null
  return { stage: stageKey, prUrl, mergedAt: stageKey === 'merged' ? mergedAt : null }
}

export function gitFlowBackfill(
  task: GitFlowTaskValue,
  pr: GitFlowPr | null,
  hasBranch: boolean,
  repo: { owner: string; name: string } | null,
  config: GitFlowConfig,
  order: Order
): GitFlowChange | null {
  const counted = pr && countsAsTarget(pr.baseRef) ? pr : null
  let target: GitStageKey | null = null
  if (counted?.state === 'merged') target = 'merged'
  else if (counted?.state === 'open') target = counted.changesRequested ? 'changes' : 'review'
  else if (counted?.state === 'draft' || hasBranch) target = 'branch'
  if (!target) return null
  let stage = nextGitStage(task.stage, target, config, order)
  // A carga inicial nunca anda para trás (a volta de "Ajustes" é só do evento de review pedida).
  if (stage && task.stage) {
    const cur = indexOfOption(task.stage, order)
    if (cur >= 0 && optionIndex(config, stage, order) < cur) stage = null
  }
  const prUrl =
    counted && target !== 'branch' && counted.state !== 'draft'
      ? prUrlChange(task, counted, repo)
      : null
  if (!stage && !prUrl) return null
  return {
    stage,
    prUrl,
    mergedAt: stage === 'merged' && counted ? counted.closedAt : null
  }
}
