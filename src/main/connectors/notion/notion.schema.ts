/**
 * Funções puras sobre data sources do Notion (API 2025-09-03+): leitura de schema, sugestão e
 * validação de mapeamento de propriedades, e leitura de páginas de Projetos/Tarefas.
 * Nada aqui faz rede.
 */
import {
  FIELD_TYPES,
  MAPPING_FIELDS,
  REQUIRED_FIELDS,
  candidatesFor,
  fieldLabel,
  sameId
} from '../../../shared/notion-mapping'
import { httpsUrlOrNull, isRecord, stringOrNull } from '../../net/parse'
import type {
  NotionColor,
  NotionDataSourceSummary,
  NotionMapping,
  NotionMappingField,
  NotionPropertyRef,
  NotionPropertySummary,
  NotionProjectPage,
  NotionTask
} from '../../../shared/notion'
import type { GitFlowConfig } from '../../../shared/git-flow'
import { normalizeLabel } from '../../../shared/text'

export { FIELD_TYPES, REQUIRED_FIELDS, candidatesFor, fieldLabel, sameId }

export interface NotionDataSourceSchema {
  id: string
  title: string
  properties: NotionPropertySummary[]
}

const COLORS: readonly NotionColor[] = [
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

/** Nomes usuais (pt/en), já normalizados, por campo: aumentam a pontuação da sugestão. */
const FIELD_NAMES: Record<NotionMappingField, readonly string[]> = {
  title: ['titulo', 'title', 'nome', 'name', 'tarefa', 'task'],
  status: ['status', 'estado', 'situacao', 'etapa', 'stage', 'state'],
  uniqueId: ['id', 'codigo', 'code', 'key', 'chave', 'ticket'],
  project: ['projeto', 'projetos', 'project', 'projects'],
  priority: ['prioridade', 'priority', 'prio', 'urgencia', 'urgency'],
  assignee: ['responsavel', 'responsaveis', 'assignee', 'assignees', 'owner', 'dono', 'atribuido']
}

export function plainText(value: unknown): string {
  if (!Array.isArray(value)) return ''
  return value
    .map((part) =>
      isRecord(part) && typeof part['plain_text'] === 'string' ? part['plain_text'] : ''
    )
    .join('')
    .trim()
}

function color(value: unknown): NotionColor {
  return typeof value === 'string' && (COLORS as readonly string[]).includes(value)
    ? (value as NotionColor)
    : 'default'
}

export function parseDataSourceSummary(body: unknown): NotionDataSourceSummary | null {
  if (!isRecord(body) || body['object'] !== 'data_source') return null
  const id = stringOrNull(body['id'])
  if (!id) return null
  return {
    id,
    title: plainText(body['title']) || 'Sem título',
    url: httpsUrlOrNull(body['url'])
  }
}

export function parseDataSource(body: unknown): NotionDataSourceSchema | null {
  const summary = parseDataSourceSummary(body)
  if (!summary || !isRecord(body) || !isRecord(body['properties'])) return null
  const properties: NotionPropertySummary[] = []
  for (const [key, raw] of Object.entries(body['properties'])) {
    if (!isRecord(raw)) continue
    const id = stringOrNull(raw['id'])
    const type = stringOrNull(raw['type'])
    if (!id || !type) continue
    const name = stringOrNull(raw['name']) ?? key
    const detail = isRecord(raw[type]) ? (raw[type] as Record<string, unknown>) : {}
    const property: NotionPropertySummary = { id, name, type }
    if (type === 'status' || type === 'select') {
      property.options = (Array.isArray(detail['options']) ? detail['options'] : [])
        .filter(isRecord)
        .map((o) => ({
          id: String(o['id'] ?? ''),
          name: String(o['name'] ?? ''),
          color: color(o['color'])
        }))
        .filter((o) => o.name)
    }
    if (type === 'relation') {
      property.relationDataSourceId = stringOrNull(detail['data_source_id'])
    }
    if (type === 'unique_id') {
      property.uniqueIdPrefix = stringOrNull(detail['prefix'])
    }
    properties.push(property)
  }
  return { id: summary.id, title: summary.title, properties }
}

export function normalizeName(value: string): string {
  return normalizeLabel(value)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function nameScore(field: NotionMappingField, name: string): number {
  const normalized = normalizeName(name)
  const words = normalized.split(' ')
  const names = FIELD_NAMES[field]
  if (names.includes(normalized)) return 3
  if (words.some((w) => names.includes(w))) return 2
  return 0
}

export interface MappingSuggestion {
  mapping: Partial<NotionMapping>
  /** Campos obrigatórios sem nenhuma propriedade possível. */
  missing: NotionMappingField[]
}

export function suggestMapping(
  schema: NotionDataSourceSchema,
  projectsDataSourceId: string
): MappingSuggestion {
  const mapping: Partial<NotionMapping> = {}
  const used = new Set<string>()
  const missing: NotionMappingField[] = []
  // Obrigatórios primeiro, para não "roubarem" uma propriedade boa dos opcionais.
  const fields: NotionMappingField[] = [
    'title',
    'uniqueId',
    'project',
    'status',
    'priority',
    'assignee'
  ]
  for (const field of fields) {
    const ranked = candidatesFor(field, schema.properties, projectsDataSourceId)
      .filter((p) => !used.has(p.id))
      .map((p) => ({
        p,
        score:
          nameScore(field, p.name) * 10 +
          (FIELD_TYPES[field].length - FIELD_TYPES[field].indexOf(p.type))
      }))
      .sort((a, b) => b.score - a.score)
    const best = ranked[0]
    // Opcionais só com nome reconhecido (não chutamos "prioridade" num select qualquer).
    const acceptable =
      best && (REQUIRED_FIELDS.includes(field) || nameScore(field, best.p.name) > 0)
    if (best && acceptable) {
      mapping[field] = toRef(best.p)
      used.add(best.p.id)
    } else if (REQUIRED_FIELDS.includes(field)) {
      missing.push(field)
    }
  }
  return { mapping, missing }
}

export function toRef(p: NotionPropertySummary): NotionPropertyRef {
  return { id: p.id, name: p.name, type: p.type }
}

export interface MappingCheck {
  /** Erros que impedem ler tarefas (propriedade sumiu, mudou de tipo, relação errada). */
  errors: string[]
  /** Avisos que não impedem (ex.: propriedade renomeada; já atualizamos o nome). */
  warnings: string[]
  /** Mapeamento com nomes atualizados. */
  mapping: NotionMapping
}

export function checkMapping(
  mapping: NotionMapping,
  schema: NotionDataSourceSchema,
  projectsDataSourceId: string
): MappingCheck {
  const errors: string[] = []
  const warnings: string[] = []
  const updated: NotionMapping = { ...mapping }
  for (const field of MAPPING_FIELDS) {
    const ref = mapping[field]
    if (!ref) {
      if (REQUIRED_FIELDS.includes(field))
        errors.push(`Falta mapear a propriedade de ${fieldLabel(field)}.`)
      continue
    }
    const current = schema.properties.find((p) => p.id === ref.id)
    const label = `${fieldLabel(field)} (“${ref.name}”)`
    if (!current) {
      const msg = `A propriedade ${label} não existe mais nas Tarefas do Notion.`
      if (REQUIRED_FIELDS.includes(field)) errors.push(msg)
      else {
        warnings.push(`${msg} O campo opcional foi ignorado.`)
        delete updated[field]
      }
      continue
    }
    if (!FIELD_TYPES[field].includes(current.type)) {
      const msg = `A propriedade ${label} mudou de tipo no Notion (agora é ${current.type}).`
      if (REQUIRED_FIELDS.includes(field)) errors.push(msg)
      else {
        warnings.push(`${msg} O campo opcional foi ignorado.`)
        delete updated[field]
      }
      continue
    }
    if (field === 'project' && !sameId(current.relationDataSourceId ?? '', projectsDataSourceId)) {
      errors.push(`A relação ${label} não aponta mais para o banco de Projetos escolhido.`)
      continue
    }
    if (current.name !== ref.name) {
      warnings.push(`A propriedade ${label} foi renomeada para “${current.name}”.`)
    }
    updated[field] = toRef(current)
  }
  return { errors, warnings, mapping: updated }
}

/** Valor de uma propriedade da página, achado pelo id da propriedade (estável a renomeações). */
function propertyValue(
  page: Record<string, unknown>,
  propertyId: string
): Record<string, unknown> | null {
  const props = page['properties']
  if (!isRecord(props)) return null
  for (const value of Object.values(props)) {
    if (isRecord(value) && value['id'] === propertyId) return value
  }
  return null
}

export function relationIds(body: unknown, propertyId: string): string[] {
  if (!isRecord(body)) return []
  const value = propertyValue(body, propertyId)
  const rel = value?.['relation']
  if (!Array.isArray(rel)) return []
  return rel.flatMap((r) => (isRecord(r) && typeof r['id'] === 'string' ? [r['id']] : []))
}

function titleOf(page: Record<string, unknown>): string {
  const props = page['properties']
  if (!isRecord(props)) return ''
  for (const value of Object.values(props)) {
    if (isRecord(value) && value['type'] === 'title') return plainText(value['title'])
  }
  return ''
}

export function parseProjectPage(body: unknown): NotionProjectPage | null {
  if (!isRecord(body) || body['object'] !== 'page' || body['in_trash'] === true) return null
  const id = stringOrNull(body['id'])
  if (!id) return null
  return { id, title: titleOf(body) || 'Sem título', url: httpsUrlOrNull(body['url']) }
}

export function parseTaskPage(
  body: unknown,
  mapping: NotionMapping,
  gitFlow: GitFlowConfig | null = null
): NotionTask | null {
  if (!isRecord(body) || body['object'] !== 'page' || body['in_trash'] === true) return null
  const id = stringOrNull(body['id'])
  if (!id) return null

  const titleValue = propertyValue(body, mapping.title.id)
  const title = (titleValue ? plainText(titleValue['title']) : '') || titleOf(body) || 'Sem título'

  const uid = mapping.uniqueId ? propertyValue(body, mapping.uniqueId.id)?.['unique_id'] : null
  let displayId: string | null = null
  if (isRecord(uid) && typeof uid['number'] === 'number') {
    const prefix = stringOrNull(uid['prefix'])
    displayId = prefix ? `${prefix}-${uid['number']}` : String(uid['number'])
  }

  return {
    id,
    url: httpsUrlOrNull(body['url']),
    displayId,
    title,
    status: optionValue(propertyValue(body, mapping.status.id), true),
    priority: mapping.priority ? optionValue(propertyValue(body, mapping.priority.id)) : null,
    assignees: mapping.assignee ? peopleNames(propertyValue(body, mapping.assignee.id)) : [],
    gitStage: gitFlow ? optionValue(propertyValue(body, gitFlow.stage.id), true) : null,
    prUrl: gitFlow?.prUrl ? urlValue(propertyValue(body, gitFlow.prUrl.id)) : null
  }
}

function urlValue(value: Record<string, unknown> | null): string | null {
  return value?.['type'] === 'url' ? httpsUrlOrNull(value['url']) : null
}

function peopleNames(value: Record<string, unknown> | null): string[] {
  const people = value?.['people']
  if (!Array.isArray(people)) return []
  return people
    .map((p) => (isRecord(p) ? stringOrNull(p['name']) : null))
    .filter((n): n is string => n !== null)
}

/** Valor simples de uma propriedade select/status/checkbox (para o quadro; só em memória). */
export type SimplePropertyValue =
  | { type: 'select' | 'status'; id: string | null; name: string | null }
  | { type: 'checkbox'; checked: boolean }
  | { type: 'url'; url: string | null }
  | { type: 'date'; start: string | null }

/**
 * Valor que o Orkio escreve numa propriedade da página (por id da propriedade): status/select pelo
 * nome (a escrita não cria opção de status) ou checkbox. O formato da API mora só aqui:
 * `encodePropertyWrites` (payload do `PATCH /v1/pages/{id}`), `decodePropertyWrites` (pendência
 * salva), `propertyWritesKey` (comparar pendências sem depender da ordem), `propertyWritesMatch`
 * (o Notion já tem?) e `applyPropertyWrites` (valores conhecidos depois de confirmar).
 */
export type PropertyWrite =
  | { type: 'status' | 'select'; name: string }
  | { type: 'checkbox'; checked: boolean }
  | { type: 'url'; url: string }
  | { type: 'date'; start: string }

export type PropertyWrites = Record<string, PropertyWrite>

export function encodePropertyWrites(writes: PropertyWrites): Record<string, unknown> {
  const payload: Record<string, unknown> = {}
  for (const id of Object.keys(writes).sort()) {
    const w = writes[id]!
    payload[id] =
      w.type === 'checkbox'
        ? { checkbox: w.checked }
        : w.type === 'url'
          ? { url: w.url }
          : w.type === 'date'
            ? { date: { start: w.start } }
            : { [w.type]: { name: w.name } }
  }
  return payload
}

/** Lê o payload salvo (tolerante: propriedade em formato desconhecido some). */
export function decodePropertyWrites(payload: unknown): PropertyWrites {
  const writes: PropertyWrites = {}
  if (!isRecord(payload)) return writes
  for (const [id, raw] of Object.entries(payload)) {
    if (!isRecord(raw)) continue
    if (typeof raw['checkbox'] === 'boolean') {
      writes[id] = { type: 'checkbox', checked: raw['checkbox'] }
      continue
    }
    if (typeof raw['url'] === 'string') {
      writes[id] = { type: 'url', url: raw['url'] }
      continue
    }
    const date = raw['date']
    if (isRecord(date) && typeof date['start'] === 'string') {
      writes[id] = { type: 'date', start: date['start'] }
      continue
    }
    for (const type of ['status', 'select'] as const) {
      const option = raw[type]
      const name = isRecord(option) ? stringOrNull(option['name']) : null
      if (name !== null) writes[id] = { type, name }
    }
  }
  return writes
}

/** Chave estável (ids ordenados): duas pendências iguais têm a mesma chave. */
export function propertyWritesKey(writes: PropertyWrites): string {
  return JSON.stringify(encodePropertyWrites(writes))
}

/** Datas por instante (o Notion devolve `…:03:00.000+00:00` para `…:03:00Z`); texto se não parsear. */
function sameInstant(a: string | null, b: string): boolean {
  if (a === null) return false
  const x = Date.parse(a)
  const y = Date.parse(b)
  return Number.isNaN(x) || Number.isNaN(y) ? a === b : x === y
}

/** O Notion já tem todos os valores escritos? */
export function propertyWritesMatch(
  values: Readonly<Record<string, SimplePropertyValue>> | undefined,
  writes: PropertyWrites
): boolean {
  if (!values) return false
  return Object.entries(writes).every(([id, w]) => {
    const current = values[id]
    if (w.type === 'checkbox') return current?.type === 'checkbox' && current.checked === w.checked
    if (w.type === 'url') return current?.type === 'url' && current.url === w.url
    if (w.type === 'date') return current?.type === 'date' && sameInstant(current.start, w.start)
    return (
      current !== undefined &&
      (current.type === 'select' || current.type === 'status') &&
      current.name === w.name
    )
  })
}

/** Os valores conhecidos passam a ser os escritos (o id da opção fica desconhecido). */
export function applyPropertyWrites(
  values: Record<string, SimplePropertyValue>,
  writes: PropertyWrites
): void {
  for (const [id, w] of Object.entries(writes)) {
    values[id] =
      w.type === 'checkbox' || w.type === 'url' || w.type === 'date'
        ? w
        : { type: w.type, id: null, name: w.name }
  }
}

export function simplePropertyValues(body: unknown): Record<string, SimplePropertyValue> {
  const result: Record<string, SimplePropertyValue> = {}
  const props = isRecord(body) ? body['properties'] : null
  if (!isRecord(props)) return result
  for (const value of Object.values(props)) {
    if (!isRecord(value)) continue
    const id = stringOrNull(value['id'])
    const type = value['type']
    if (!id) continue
    if (type === 'checkbox') {
      result[id] = { type, checked: value['checkbox'] === true }
    } else if (type === 'url') {
      result[id] = { type, url: stringOrNull(value['url']) }
    } else if (type === 'date') {
      const date = value['date']
      result[id] = { type, start: isRecord(date) ? stringOrNull(date['start']) : null }
    } else if (type === 'select' || type === 'status') {
      const option = value[type]
      result[id] = {
        type,
        id: isRecord(option) ? stringOrNull(option['id']) : null,
        name: isRecord(option) ? stringOrNull(option['name']) : null
      }
    }
  }
  return result
}

function optionValue(value: Record<string, unknown> | null, withId = false): NotionTask['status'] {
  if (!value) return null
  const type = value['type']
  if (type === 'number') {
    return typeof value['number'] === 'number'
      ? { name: String(value['number']), color: 'default' }
      : null
  }
  const option = typeof type === 'string' ? value[type] : null
  if (!isRecord(option)) return null
  const name = stringOrNull(option['name'])
  if (!name) return null
  return withId
    ? { id: stringOrNull(option['id']), name, color: color(option['color']) }
    : { name, color: color(option['color']) }
}

/** Coeficiente de Dice sobre bigramas dos nomes normalizados (0..1). */
export function nameSimilarity(a: string, b: string): number {
  const x = normalizeName(a).replace(/ /g, '')
  const y = normalizeName(b).replace(/ /g, '')
  if (!x || !y) return 0
  if (x === y) return 1
  const bigrams = (s: string) => {
    const list: string[] = []
    for (let i = 0; i < s.length - 1; i++) list.push(s.slice(i, i + 2))
    return list
  }
  const bx = bigrams(x)
  const by = bigrams(y)
  if (bx.length === 0 || by.length === 0) return 0
  const counts = new Map<string, number>()
  for (const g of bx) counts.set(g, (counts.get(g) ?? 0) + 1)
  let overlap = 0
  for (const g of by) {
    const n = counts.get(g) ?? 0
    if (n > 0) {
      overlap++
      counts.set(g, n - 1)
    }
  }
  return (2 * overlap) / (bx.length + by.length)
}
