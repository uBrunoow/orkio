/**
 * Formato do arquivo de configuração não secreta do Orkio (userData/orkio-config.json).
 * Nada de tokens aqui: segredos vão no SecureStore.
 */
import type { DeliverySettings } from '../../shared/delivery'
import { parseProjectAgents, type ProjectAgents } from '../../shared/agent'
import { parseOrchestrator, type OrchestratorConfig } from '../../shared/orchestrator'
import { parseRule, type AutomationRule } from '../../shared/automation'
import { isStageRole, type BoardConfig, type BoardStage } from '../../shared/board'
import { ConfigStore, type ConfigMigrations } from '../storage/config-store'
import { migrateV11, type AlvaMigrationNote } from './migrations/v11-alva'
import { migrateV13 } from './migrations/v13-queue-stage'
import { migrateV14 } from './migrations/v14-stage-roles'
import { migrateV3 } from './migrations/v3-default-rules'

export const ORKIO_CONFIG_FILE = 'orkio-config.json'
import { clampAlvaParallel } from '../../shared/alva'
import { parseFlowDef, type Flow, type ProjectFlows, type StageFlow } from '../../shared/task-flow'
import type { UpdateChannel } from '../../shared/updates'
import type {
  NotionColor,
  NotionMapping,
  NotionPropertyRef,
  NotionWorkspaceConfig
} from '../../shared/notion'
import type { ProjectRepo } from '../../shared/projects'

export const ORKIO_CONFIG_VERSION = 15

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
  /** Quadro de cada projeto (chave: id do projeto). */
  boards: Record<string, BoardConfig>
  automation: { paused: boolean }
  flows: Record<string, ProjectFlows>
  /** Ajustes de entrega por projeto (5C). Ausente = padrão (aprovação para push). */
  delivery: Record<string, DeliverySettings>
  /** Agentes (8A): regras de atribuição por coluna. Os perfis ficam em arquivos, não aqui. */
  agents: Record<string, ProjectAgents>
  orchestrator: Record<string, OrchestratorConfig>
  updates: UpdatesConfig
  /** Manter o computador acordado enquanto agentes trabalham. Ausente = desligado. */
  keepAwake?: boolean
}

export interface UpdatesConfig {
  channel: UpdateChannel
  /** `null` = instalação nova (nada a mostrar no "O que há de novo"). */
  lastSeenVersion: string | null
  lastCheckAt: string | null
}

export function emptyConfig(): OrkioConfig {
  return {
    projects: [],
    notion: null,
    boards: {},
    automation: { paused: false },
    flows: {},
    delivery: {},
    agents: {},
    orchestrator: {},
    updates: { channel: 'stable', lastSeenVersion: null, lastCheckAt: null }
  }
}

/**
 * Mudanças feitas por uma migração num projeto, para o histórico de configuração (`config_events`).
 * A migração roda no `ConfigStore` (sem banco): o main recebe as notas e grava quando o banco abre.
 */
export type ConfigMigrationNote = AlvaMigrationNote

/**
 * Migrações publicadas (`v → v+1`), uma para cada versão de 0 até `ORKIO_CONFIG_VERSION - 1`
 * (o `ConfigStore` recusa abrir se faltar uma; teste exige todas). Nunca edite uma publicada:
 * as que precisam de dados (regras padrão, modelos Alva) levam uma cópia congelada da época em
 * `migrations/`, nunca o código vivo.
 */
export function orkioConfigMigrations(
  options: { onMigrationNote?: (note: ConfigMigrationNote) => void } = {}
): ConfigMigrations {
  return {
    // v0: arquivo sem schemaVersion (rascunhos antigos) → v1.
    0: (data) => ({ projects: Array.isArray(data['projects']) ? data['projects'] : [] }),
    1: (data) => ({
      ...data,
      notion: null,
      projects: Array.isArray(data['projects'])
        ? data['projects'].map((p: unknown) => (isRecord(p) ? { ...p, notionProject: null } : p))
        : []
    }),
    2: (data) => ({ ...data, boards: {} }),
    // v3 → v4: quadros existentes ganham as regras padrão da época (etapas pelo nome).
    3: migrateV3,
    4: (data) => ({ ...data, claudeContexts: {} }),
    5: (data) => ({ ...data, flows: {} }),
    // v6 → v7 (5B): só campos opcionais novos nos fluxos (includeBriefing, tags, limite Alva).
    6: (data) => ({ ...data }),
    // v7 → v8 (5C): ajustes de entrega por projeto (padrão: exigir aprovação para push).
    7: (data) => ({ ...data, delivery: {} }),
    // v8 → v9 (6C): canal Estável. Sem versão vista: a primeira abertura só registra a versão
    // (quem chega à 6C instalou na mão); o "O que há de novo" vale a partir da próxima.
    8: (data) => ({
      ...data,
      updates: { channel: 'stable', lastSeenVersion: null, lastCheckAt: null }
    }),
    9: (data) => ({ ...data, agents: {} }),
    // v10 → v11 (8B): orquestrador desligado em todos os projetos.
    10: (data) => ({ ...data, orchestrator: {} }),
    // v11 → v12: modelos Alva da v12 (congelados) e as ligações padrão de Revisando/Revisado.
    11: (data) => migrateV11(data, options.onMigrationNote),
    // v12 → v13: sai o contexto do projeto do Claude Code (`claudeContexts`), sem leitor desde
    // que o contexto passou a vir só da tarefa.
    12: (data) => {
      const rest = { ...data }
      delete rest['claudeContexts']
      return rest
    },
    // v13 → v14: coluna "A fazer" vai do orquestrador para o quadro; sai `maxActive`.
    13: migrateV13,
    // v14 → v15: papel das etapas (`role`, pelo nome uma única vez); `queueStageId` vira o papel
    // `queue`.
    14: migrateV14
  }
}

export function createOrkioConfigStore(
  file: string,
  options: { onMigrationNote?: (note: ConfigMigrationNote) => void } = {}
): ConfigStore<OrkioConfig> {
  return new ConfigStore<OrkioConfig>({
    file,
    currentVersion: ORKIO_CONFIG_VERSION,
    migrations: orkioConfigMigrations(options),
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

  const boards: Record<string, BoardConfig> = {}
  const rawBoards = data['boards']
  if (isRecord(rawBoards)) {
    for (const [projectId, raw] of Object.entries(rawBoards)) {
      const board = parseBoard(raw)
      if (board) boards[projectId] = board
      else warnings.push('Um quadro com dados inválidos foi descartado e precisa ser recriado.')
    }
  }

  const automationRaw = data['automation']
  const automation = {
    paused: isRecord(automationRaw) && automationRaw['paused'] === true
  }
  const flows: Record<string, ProjectFlows> = {}
  if (isRecord(data['flows'])) {
    for (const [projectId, raw] of Object.entries(data['flows'])) {
      const parsed = parseProjectFlows(raw)
      flows[projectId] = parsed.value
      if (parsed.dropped > 0) {
        warnings.push(`${parsed.dropped} fluxo(s) de tarefa inválido(s) foram ignorados.`)
      }
    }
  }
  const delivery: Record<string, DeliverySettings> = {}
  if (isRecord(data['delivery'])) {
    for (const [projectId, raw] of Object.entries(data['delivery'])) {
      if (isRecord(raw) && typeof raw['requirePushApproval'] === 'boolean') {
        delivery[projectId] = { requirePushApproval: raw['requirePushApproval'] }
      }
    }
  }
  const agents: Record<string, ProjectAgents> = {}
  if (isRecord(data['agents'])) {
    for (const [projectId, raw] of Object.entries(data['agents'])) {
      const parsed = parseProjectAgents(raw)
      if (parsed) agents[projectId] = parsed
    }
  }
  const orchestrator: Record<string, OrchestratorConfig> = {}
  if (isRecord(data['orchestrator'])) {
    for (const [projectId, raw] of Object.entries(data['orchestrator'])) {
      const parsed = parseOrchestrator(raw)
      if (parsed) orchestrator[projectId] = parsed
    }
  }
  const value: OrkioConfig = {
    projects,
    notion,
    boards,
    automation,
    flows,
    delivery,
    agents,
    orchestrator,
    updates: parseUpdates(data['updates']),
    ...(data['keepAwake'] === true ? { keepAwake: true } : {})
  }
  return warnings.length > 0 ? { value, warning: warnings.join(' ') } : { value }
}

/** Bloco de atualizações inválido volta ao padrão (nunca derruba a config). */
export function parseUpdates(value: unknown): UpdatesConfig {
  const v = isRecord(value) ? value : {}
  const str = (x: unknown): string | null => (typeof x === 'string' && x ? x : null)
  return {
    channel: v['channel'] === 'beta' ? 'beta' : 'stable',
    lastSeenVersion: str(v['lastSeenVersion']),
    lastCheckAt: str(v['lastCheckAt'])
  }
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
  if (!title || !status || !project) return null
  const mapping: NotionMapping = { title, status, project }
  if (uniqueId) mapping.uniqueId = uniqueId
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

const COLORS = [
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

function parseStage(value: unknown, index: number): BoardStage | null {
  if (!isRecord(value)) return null
  const { id, name } = value
  const status = value['notionStatus']
  if (typeof id !== 'string' || !id || typeof name !== 'string' || !isRecord(status)) return null
  if (typeof status['name'] !== 'string') return null
  const stage: BoardStage = {
    id,
    name,
    order: index,
    notionStatus: {
      id: typeof status['id'] === 'string' && status['id'] ? status['id'] : null,
      name: status['name']
    }
  }
  if (typeof value['color'] === 'string' && COLORS.includes(value['color'])) {
    stage.color = value['color'] as NotionColor
  }
  if (isStageRole(value['role'])) stage.role = value['role']
  return stage
}

export function parseBoard(value: unknown): BoardConfig | null {
  if (!isRecord(value) || !Array.isArray(value['stages'])) return null
  const stages = value['stages'].map(parseStage)
  if (stages.some((s) => s === null) || stages.length === 0) return null
  const ids = new Set(stages.map((s) => s!.id))
  if (ids.size !== stages.length) return null
  // Papel repetido (arquivo editado à mão): fica o da primeira etapa.
  const roles = new Set<string>()
  for (const stage of stages as BoardStage[]) {
    if (!stage.role) continue
    if (roles.has(stage.role)) delete stage.role
    else roles.add(stage.role)
  }
  return {
    stages: stages as BoardStage[],
    orkioStageProperty: nameRef(value['orkioStageProperty']),
    blockedProperty: nameRef(value['blockedProperty']),
    rules: Array.isArray(value['rules'])
      ? value['rules'].map(parseRule).filter((r): r is AutomationRule => r !== null)
      : [],
    updatedAt: typeof value['updatedAt'] === 'string' ? value['updatedAt'] : ''
  }
}

const str = (v: unknown): v is string => typeof v === 'string'

function parseBinding(v: unknown): StageFlow | null {
  if (!isRecord(v) || !str(v['stageId']) || !str(v['flowId'])) return null
  const mode = v['mode'] === 'manual' ? 'manual' : v['mode'] === 'on_enter' ? 'on_enter' : null
  if (!mode) return null
  return { stageId: v['stageId'], flowId: v['flowId'], enabled: v['enabled'] === true, mode }
}

export function parseProjectFlows(v: unknown): { value: ProjectFlows; dropped: number } {
  const rawFlows = isRecord(v) && Array.isArray(v['flows']) ? v['flows'] : []
  const flows = rawFlows.map(parseFlowDef).filter((f): f is Flow => f !== null)
  const ids = new Set(flows.map((f) => f.id))
  const rawBindings = isRecord(v) && Array.isArray(v['bindings']) ? v['bindings'] : []
  const bindings: StageFlow[] = []
  for (const b of rawBindings.map(parseBinding)) {
    if (b && ids.has(b.flowId) && !bindings.some((x) => x.stageId === b.stageId)) bindings.push(b)
  }
  const alvaRaw = isRecord(v) && isRecord(v['alva']) ? v['alva'] : null
  const maxParallel =
    alvaRaw && typeof alvaRaw['maxParallel'] === 'number'
      ? clampAlvaParallel(alvaRaw['maxParallel'])
      : null
  return {
    value: { flows, bindings, ...(maxParallel !== null ? { alva: { maxParallel } } : {}) },
    dropped: rawFlows.length - flows.length
  }
}
