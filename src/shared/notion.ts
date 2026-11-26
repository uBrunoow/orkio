/**
 * Notion: bancos (data sources), mapeamento e tarefas. `NotionWorkspaceConfig` também é o formato
 * salvo em disco (`orkio-config.json`): mudar aqui pede migração.
 */

import type { GitFlowConfig } from './git-flow'

export type NotionColor =
  'default' | 'gray' | 'brown' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple' | 'pink' | 'red'

export interface NotionDataSourceSummary {
  id: string
  title: string
  url: string | null
}

export interface NotionPropertySummary {
  id: string
  name: string
  /** Tipo do Notion: title, status, select, unique_id, relation, people, number, ... */
  type: string
  options?: { id: string; name: string; color: NotionColor }[]
  /** Para `relation`: o data source apontado. */
  relationDataSourceId?: string | null
  /** Para `unique_id`: o prefixo (ex.: "ORK"). */
  uniqueIdPrefix?: string | null
}

/** Referência a uma propriedade: o id é estável a renomeações; o nome serve para exibir. */
export interface NotionPropertyRef {
  id: string
  name: string
  type: string
}

export type NotionMappingField =
  'title' | 'status' | 'uniqueId' | 'project' | 'priority' | 'assignee'

export interface NotionMapping {
  title: NotionPropertyRef
  status: NotionPropertyRef
  /**
   * Propriedade ID do Notion (ORK-142), opcional: sem ela, a tarefa é identificada pela página e a
   * branch/PR se liga pelo registro local, pelo link do Notion na PR ou pelo "Vincular branch".
   */
  uniqueId?: NotionPropertyRef
  /** Relação das Tarefas com o banco de Projetos. */
  project: NotionPropertyRef
  priority?: NotionPropertyRef
  assignee?: NotionPropertyRef
}

export interface NotionWorkspaceConfig {
  projectsDataSource: { id: string; name: string }
  tasksDataSource: { id: string; name: string }
  mapping: NotionMapping
  /** Fluxo Git: a "Etapa Git" (e campos de PR) que o Orkio escreve no Notion. */
  gitFlow?: GitFlowConfig
  updatedAt: string
}

/** O que o assistente envia ao salvar: ids dos bancos e, por campo, o id da propriedade. */
export interface NotionWorkspaceInput {
  projectsDataSourceId: string
  tasksDataSourceId: string
  mapping: Partial<Record<NotionMappingField, string | null>>
}

export interface NotionWorkspaceStatus {
  /** null = ainda não configurado. */
  config: NotionWorkspaceConfig | null
  /** checking (revalidando), ok, warning (avisos), broken (tarefas bloqueadas), unverified (sem rede/Notion). */
  health: 'checking' | 'ok' | 'warning' | 'broken' | 'unverified'
  messages: string[]
  /** Como o Notion está conectado (afeta quais bancos aparecem). */
  connection: 'oauth' | 'token' | null
}

export interface NotionDataSourceList {
  dataSources: NotionDataSourceSummary[]
  /** Truncado no limite de leitura. */
  truncated: boolean
  connection: 'oauth' | 'token' | null
}

export interface NotionTasksSchemaInfo {
  schema: { id: string; title: string; properties: NotionPropertySummary[] }
  /** Sugestão automática (pode faltar campos). */
  suggestion: Partial<NotionMapping>
  /** Campos obrigatórios sem nenhuma propriedade possível (ex.: sem `unique_id`). */
  missing: NotionMappingField[]
}

export interface NotionProjectPage {
  id: string
  title: string
  url: string | null
}

export interface NotionProjectChoice extends NotionProjectPage {
  /** Projeto local que já usa esta página (um projeto do Notion → um projeto local). */
  linkedTo: { projectId: string; name: string } | null
  /** Similaridade com o nome do projeto/repositório local (0..1). */
  similarity: number
}

export interface NotionTask {
  id: string
  url: string | null
  /** Ex.: "ORK-142". */
  displayId: string | null
  title: string
  /** `id` da opção (estável a renomeações), quando o Notion informa. */
  status: { id?: string | null; name: string; color: NotionColor } | null
  priority: { name: string; color: NotionColor } | null
  /** Nomes dos responsáveis (se mapeado). */
  assignees: string[]
  /** Etapa Git (fluxo Git); `null` sem fluxo configurado ou sem valor. */
  gitStage: { id?: string | null; name: string; color: NotionColor } | null
  /** Link da PR gravado no Notion (fluxo Git); `null` sem campo mapeado ou sem valor. */
  prUrl: string | null
}

/** A página da tarefa como o Notion a mostra: campos e a descrição em markdown (só leitura). */
export interface NotionTaskPage {
  task: NotionTask
  /** Blocos da página em markdown; vazio quando a página está vazia ou não pôde ser lida. */
  markdown: string
  /** Tipos de bloco do Notion não convertidos. */
  unsupported: string[]
  /** A página não pôde ser lida (os campos continuam). */
  warning: string | null
}

/** Tarefa achada na busca (banco de Tarefas inteiro): com o projeto local, se vinculado. */
export interface NotionTaskHit extends NotionTask {
  /** Projeto do Orkio vinculado à página de Projetos da tarefa; `null` se nenhum. */
  projectId: string | null
  projectName: string | null
}

export interface NotionTaskSearchResult {
  tasks: NotionTaskHit[]
}

export interface NotionTasksResult {
  tasks: NotionTask[]
  truncated: boolean
  fetchedAt: string
  fromCache: boolean
}

/** Id de página/banco do Notion (UUID com ou sem hífens). Uma tarefa do quadro é uma página. */
export const NOTION_ID_PATTERN =
  /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i
