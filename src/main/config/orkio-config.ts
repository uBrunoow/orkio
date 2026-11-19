/**
 * Formato do arquivo de configuração não secreta do Orkio (userData/orkio-config.json).
 * Nada de tokens aqui: segredos vão no SecureStore.
 */
import type {
  NotionMapping,
  NotionPropertyRef,
  NotionWorkspaceConfig,
  ProjectRepo
} from '../../shared/ipc-contract'
import { ConfigStore } from '../storage/config-store'

export const ORKIO_CONFIG_FILE = 'orkio-config.json'
/**
 * v1: projects. v2: `notion` (bancos de Projetos/Tarefas + mapeamento) e `notionProject` em cada
 * projeto (vínculo com uma página do banco de Projetos). Só ids e nomes, nunca conteúdo.
 */
export const ORKIO_CONFIG_VERSION = 2

export interface StoredProject {
  id: string
  name: string
  localPath: string
  repo: ProjectRepo | null
  createdAt: string
  updatedAt: string
  /** Página do banco de Projetos do Notion vinculada (1 ↔ 1). */
  notionProject: { id: string; name: string } | null
}

export interface OrkioConfig {
  projects: StoredProject[]
  notion: NotionWorkspaceConfig | null
}

export function emptyConfig(): OrkioConfig {
  return { projects: [], notion: null }
}

export function createOrkioConfigStore(file: string): ConfigStore<OrkioConfig> {
  return new ConfigStore<OrkioConfig>({
    file,
    currentVersion: ORKIO_CONFIG_VERSION,
    migrations: {
      // v0: arquivo sem schemaVersion (rascunhos antigos) → v1.
      0: (data) => ({ projects: Array.isArray(data['projects']) ? data['projects'] : [] }),
      // v1 → v2: Notion ainda não configurado; nenhum projeto vinculado.
      1: (data) => ({
        ...data,
        notion: null,
        projects: Array.isArray(data['projects'])
          ? data['projects'].map((p: unknown) => (isRecord(p) ? { ...p, notionProject: null } : p))
          : []
      })
    },
    validate: validateConfig,
    empty: emptyConfig
  })
}

export function validateConfig(
  data: Record<string, unknown>
): { value: OrkioConfig; warning?: string } | null {
  if (!Array.isArray(data['projects'])) return null
  const warnings: string[] = []
  const projects = data['projects'].map(parseProject).filter((p): p is StoredProject => !!p)
  const dropped = data['projects'].length - projects.length
  if (dropped > 0) warnings.push(`${dropped} projeto(s) com dados inválidos foram ignorados.`)

  // Configuração do Notion inválida não derruba os projetos: volta a "não configurado".
  let notion: NotionWorkspaceConfig | null = null
  if (data['notion'] !== null && data['notion'] !== undefined) {
    notion = parseNotionConfig(data['notion'])
    if (!notion) {
      warnings.push('A configuração dos bancos do Notion estava inválida e precisa ser refeita.')
    }
  }

  const value: OrkioConfig = { projects, notion }
  return warnings.length > 0 ? { value, warning: warnings.join(' ') } : { value }
}

function nameRef(value: unknown): { id: string; name: string } | null {
  if (!isRecord(value)) return null
  const { id, name } = value
  return typeof id === 'string' && id && typeof name === 'string' ? { id, name } : null
}

function propertyRef(value: unknown): NotionPropertyRef | null {
  if (!isRecord(value)) return null
  const { id, name, type } = value
  return typeof id === 'string' &&
    id &&
    typeof name === 'string' &&
    typeof type === 'string' &&
    type
    ? { id, name, type }
    : null
}

export function parseNotionConfig(value: unknown): NotionWorkspaceConfig | null {
  if (!isRecord(value)) return null
  const projectsDataSource = nameRef(value['projectsDataSource'])
  const tasksDataSource = nameRef(value['tasksDataSource'])
  const mappingRaw = value['mapping']
  if (!projectsDataSource || !tasksDataSource || !isRecord(mappingRaw)) return null
  if (typeof value['updatedAt'] !== 'string') return null

  const title = propertyRef(mappingRaw['title'])
  const status = propertyRef(mappingRaw['status'])
  const uniqueId = propertyRef(mappingRaw['uniqueId'])
  const project = propertyRef(mappingRaw['project'])
  if (!title || !status || !uniqueId || !project) return null
  const mapping: NotionMapping = { title, status, uniqueId, project }
  const priority = propertyRef(mappingRaw['priority'])
  const assignee = propertyRef(mappingRaw['assignee'])
  if (priority) mapping.priority = priority
  if (assignee) mapping.assignee = assignee

  return { projectsDataSource, tasksDataSource, mapping, updatedAt: value['updatedAt'] }
}

function parseProject(value: unknown): StoredProject | null {
  if (!isRecord(value)) return null
  const { id, name, localPath, createdAt, updatedAt } = value
  if (![id, name, localPath, createdAt, updatedAt].every((v) => typeof v === 'string' && v)) {
    return null
  }
  const repo = value['repo'] === null ? null : parseRepo(value['repo'])
  if (repo === undefined) return null
  return {
    id: id as string,
    name: name as string,
    localPath: localPath as string,
    repo,
    createdAt: createdAt as string,
    updatedAt: updatedAt as string,
    notionProject: nameRef(value['notionProject'])
  }
}

function parseRepo(value: unknown): ProjectRepo | undefined {
  if (!isRecord(value)) return undefined
  const { host, owner, name, remoteName } = value
  if (![host, owner, name, remoteName].every((v) => typeof v === 'string' && v)) return undefined
  const visibility = value['visibility']
  return {
    host: host as string,
    owner: owner as string,
    name: name as string,
    remoteName: remoteName as string,
    defaultBranch: typeof value['defaultBranch'] === 'string' ? value['defaultBranch'] : null,
    visibility:
      visibility === 'public' || visibility === 'private' || visibility === 'internal'
        ? visibility
        : 'unknown',
    canPush: typeof value['canPush'] === 'boolean' ? value['canPush'] : null,
    archived: value['archived'] === true,
    verified: value['verified'] === true
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
