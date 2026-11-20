/**
 * Formato do arquivo de configuração não secreta do Orkio (userData/orkio-config.json).
 * Nada de tokens aqui: segredos vão no SecureStore.
 */
import {
  EVENT_KINDS,
  defaultRules,
  type AutomationRule,
  type EventKind
} from '../../shared/automation'
import type { BoardConfig, BoardStage } from '../../shared/board'
import type {
  NotionColor,
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
 * v3: `boards` (quadro kanban por projeto: etapas ↔ opções do status do Notion).
 * v4: `boards[].rules` (automações, 3B) e `automation.paused` (pausa global).
 */
import { CONTEXT_LIMITS, type ProjectClaudeContext } from '../../shared/agent-run'

export const ORKIO_CONFIG_VERSION = 5

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
  /** Automações (3B): pausa global ("Pausar todas"). */
  automation: { paused: boolean }
  /** Contexto do Claude Code por projeto (4B): instruções + páginas de referência (só ids/nomes). */
  claudeContexts: Record<string, ProjectClaudeContext>
}

export function emptyConfig(): OrkioConfig {
  return {
    projects: [],
    notion: null,
    boards: {},
    automation: { paused: false },
    claudeContexts: {}
  }
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
      }),
      // v2 → v3: nenhum quadro ainda.
      2: (data) => ({ ...data, boards: {} }),
      // v3 → v4: quadros existentes ganham as regras padrão (etapas resolvidas pelo nome).
      3: (data) => {
        const boards: Record<string, unknown> = {}
        const raw = isRecord(data['boards']) ? data['boards'] : {}
        for (const [projectId, board] of Object.entries(raw)) {
          const parsed = parseBoard({ ...(isRecord(board) ? board : {}), rules: [] })
          boards[projectId] =
            parsed && isRecord(board)
              ? { ...board, rules: defaultRules(parsed.stages).rules }
              : board
        }
        return { ...data, boards, automation: { paused: false } }
      },
      // v4 → v5: nenhum contexto do Claude Code ainda.
      4: (data) => ({ ...data, claudeContexts: {} })
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

  // Quadros: um inválido é descartado sozinho, com aviso.
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
  // Contextos do Claude Code: um inválido é descartado sozinho.
  const claudeContexts: Record<string, ProjectClaudeContext> = {}
  if (isRecord(data['claudeContexts'])) {
    for (const [projectId, raw] of Object.entries(data['claudeContexts'])) {
      const ctx = parseClaudeContext(raw)
      if (ctx) claudeContexts[projectId] = ctx
    }
  }
  const value: OrkioConfig = { projects, notion, boards, automation, claudeContexts }
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
  return stage
}

export function parseBoard(value: unknown): BoardConfig | null {
  if (!isRecord(value) || !Array.isArray(value['stages'])) return null
  const stages = value['stages'].map(parseStage)
  if (stages.some((s) => s === null) || stages.length === 0) return null
  const ids = new Set(stages.map((s) => s!.id))
  if (ids.size !== stages.length) return null
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

export function parseClaudeContext(value: unknown): ProjectClaudeContext | null {
  if (!isRecord(value) || typeof value['instructions'] !== 'string') return null
  const pages = Array.isArray(value['notionPages'])
    ? value['notionPages'].map(nameRef).filter((p): p is { id: string; name: string } => !!p)
    : []
  return {
    instructions: value['instructions'].slice(0, CONTEXT_LIMITS.instructions),
    notionPages: pages.slice(0, CONTEXT_LIMITS.pages)
  }
}
