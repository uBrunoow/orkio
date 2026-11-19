/**
 * Regras do mapeamento das Tarefas do Notion, compartilhadas entre main e renderer.
 * Funções puras, sem Node/DOM.
 */
import type { NotionMappingField, NotionPropertySummary } from './ipc-contract'

/** Tipos aceitos em cada campo do mapeamento das Tarefas. */
export const FIELD_TYPES: Record<NotionMappingField, readonly string[]> = {
  title: ['title'],
  status: ['status', 'select'],
  uniqueId: ['unique_id'],
  project: ['relation'],
  priority: ['select', 'status', 'number'],
  assignee: ['people']
}

export const REQUIRED_FIELDS: readonly NotionMappingField[] = [
  'title',
  'status',
  'uniqueId',
  'project'
]

/** Ordem de exibição no assistente. */
export const MAPPING_FIELDS: readonly NotionMappingField[] = [
  'title',
  'uniqueId',
  'status',
  'project',
  'priority',
  'assignee'
]

const FIELD_LABELS: Record<NotionMappingField, string> = {
  title: 'Título',
  status: 'Status',
  uniqueId: 'ID',
  project: 'Projeto',
  priority: 'Prioridade',
  assignee: 'Responsável'
}

export function fieldLabel(field: NotionMappingField): string {
  return FIELD_LABELS[field]
}

/** Ids do Notion aparecem com e sem hífens. */
export function sameId(a: string, b: string): boolean {
  return a.replace(/-/g, '').toLowerCase() === b.replace(/-/g, '').toLowerCase()
}

/** Propriedades válidas para um campo (tipo certo; a relação precisa apontar para Projetos). */
export function candidatesFor(
  field: NotionMappingField,
  properties: readonly NotionPropertySummary[],
  projectsDataSourceId: string
): NotionPropertySummary[] {
  return properties.filter(
    (p) =>
      FIELD_TYPES[field].includes(p.type) &&
      (field !== 'project' || sameId(p.relationDataSourceId ?? '', projectsDataSourceId))
  )
}
