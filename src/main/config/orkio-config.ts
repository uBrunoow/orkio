/**
 * Formato do arquivo de configuração não secreta do Orkio (userData/orkio-config.json).
 * Nada de tokens aqui: segredos vão no SecureStore.
 */
import type { ProjectRepo } from '../../shared/ipc-contract'
import { ConfigStore } from '../storage/config-store'

export const ORKIO_CONFIG_FILE = 'orkio-config.json'
export const ORKIO_CONFIG_VERSION = 1

export interface StoredProject {
  id: string
  name: string
  localPath: string
  repo: ProjectRepo | null
  createdAt: string
  updatedAt: string
}

export interface OrkioConfig {
  projects: StoredProject[]
}

export function emptyConfig(): OrkioConfig {
  return { projects: [] }
}

export function createOrkioConfigStore(file: string): ConfigStore<OrkioConfig> {
  return new ConfigStore<OrkioConfig>({
    file,
    currentVersion: ORKIO_CONFIG_VERSION,
    migrations: {
      // v0: arquivo sem schemaVersion (rascunhos antigos) → v1.
      0: (data) => ({ projects: Array.isArray(data['projects']) ? data['projects'] : [] })
    },
    validate: validateConfig,
    empty: emptyConfig
  })
}

export function validateConfig(
  data: Record<string, unknown>
): { value: OrkioConfig; warning?: string } | null {
  if (!Array.isArray(data['projects'])) return null
  const projects = data['projects'].map(parseProject).filter((p): p is StoredProject => !!p)
  const dropped = data['projects'].length - projects.length
  return dropped > 0
    ? {
        value: { projects },
        warning: `${dropped} projeto(s) com dados inválidos foram ignorados.`
      }
    : { value: { projects } }
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
    updatedAt: updatedAt as string
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
