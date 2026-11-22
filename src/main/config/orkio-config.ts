/**
 * Formato do arquivo de configuração não secreta do Orkio (userData/orkio-config.json).
 * Nada de tokens aqui: segredos vão no SecureStore.
 */
import type { DeliverySettings } from '../../shared/delivery'
import { parseProjectAgents, type ProjectAgents } from '../../shared/agent'
import { parseOrchestrator, type OrchestratorConfig } from '../../shared/orchestrator'
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
import type { Condition, Flow, ProjectFlows, StageFlow, Step } from '../../shared/task-flow'
import type { UpdateChannel } from '../../shared/updates'

export const ORKIO_CONFIG_VERSION = 11

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
  /** Fluxos de tarefa por projeto (5A) e a ligação de cada um com as etapas. */
  flows: Record<string, ProjectFlows>
  /** Ajustes de entrega por projeto (5C). Ausente = padrão (aprovação para push). */
  delivery: Record<string, DeliverySettings>
  /** Agentes (8A): regras de atribuição por coluna. Os perfis ficam em arquivos, não aqui. */
  agents: Record<string, ProjectAgents>
  /** Orquestrador (8B): fila, etapas de trabalho e agentes de cada uma, por projeto. */
  orchestrator: Record<string, OrchestratorConfig>
  /** Atualizações (6C): canal, última versão vista ("O que há de novo") e última verificação. */
  updates: UpdatesConfig
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
    claudeContexts: {},
    flows: {},
    delivery: {},
    agents: {},
    orchestrator: {},
    updates: { channel: 'stable', lastSeenVersion: null, lastCheckAt: null }
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
      4: (data) => ({ ...data, claudeContexts: {} }),
      // v5 → v6: nenhum fluxo de tarefa ainda.
      5: (data) => ({ ...data, flows: {} }),
      // v6 → v7 (5B): só campos opcionais novos nos fluxos (includeBriefing, tags, limite Alva);
      // os fluxos existentes continuam iguais.
      6: (data) => ({ ...data }),
      // v7 → v8 (5C): ajustes de entrega por projeto (padrão: exigir aprovação para push).
      7: (data) => ({ ...data, delivery: {} }),
      // v8 → v9 (6C): canal Estável. Sem versão vista: a primeira abertura só registra a versão
      // (quem chega à 6C instalou na mão); o "O que há de novo" vale a partir da próxima.
      8: (data) => ({
        ...data,
        updates: { channel: 'stable', lastSeenVersion: null, lastCheckAt: null }
      }),
      // v9 → v10 (8A): nenhuma regra de atribuição de agentes ainda.
      9: (data) => ({ ...data, agents: {} }),
      // v10 → v11 (8B): orquestrador desligado em todos os projetos.
      10: (data) => ({ ...data, orchestrator: {} })
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
  // Fluxos de tarefa: fluxo ou ligação inválidos são descartados sozinhos, com aviso.
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
    claudeContexts,
    flows,
    delivery,
    agents,
    orchestrator,
    updates: parseUpdates(data['updates'])
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

// ---------- Fluxos de tarefa (5A) ----------

const str = (v: unknown): v is string => typeof v === 'string'

export function parseCondition(v: unknown, depth = 0): Condition | null {
  if (!isRecord(v) || depth > 5) return null
  switch (v['type']) {
    case 'step':
      return str(v['step']) && (v['is'] === 'ok' || v['is'] === 'failed' || v['is'] === 'cancelled')
        ? { type: 'step', step: v['step'], is: v['is'] }
        : null
    case 'var': {
      const op = v['op']
      if (!str(v['key']) || (op !== 'eq' && op !== 'neq' && op !== 'exists')) return null
      return { type: 'var', key: v['key'], op, ...(str(v['value']) ? { value: v['value'] } : {}) }
    }
    case 'visits':
      return str(v['step']) && typeof v['lt'] === 'number' && v['lt'] >= 1
        ? { type: 'visits', step: v['step'], lt: Math.floor(v['lt']) }
        : null
    case 'all':
    case 'any': {
      if (!Array.isArray(v['of'])) return null
      const of = v['of'].map((c) => parseCondition(c, depth + 1))
      return of.every((c): c is Condition => c !== null) ? { type: v['type'], of } : null
    }
    default:
      return null
  }
}

export function parseStep(v: unknown): Step | null {
  if (!isRecord(v) || !str(v['id']) || !str(v['name'])) return null
  const base = { id: v['id'], name: v['name'] }
  switch (v['type']) {
    case 'claude_command':
      if (!str(v['command']) || !str(v['args']) || typeof v['timeoutMin'] !== 'number') return null
      return {
        ...base,
        type: 'claude_command',
        command: v['command'],
        args: v['args'],
        timeoutMin: v['timeoutMin'],
        ...(isRecord(v['extract']) && str(v['extract']['extractor'])
          ? { extract: { extractor: v['extract']['extractor'] } }
          : {}),
        ...(v['delivery'] === true ? { delivery: true } : {}),
        ...(typeof v['includeBriefing'] === 'boolean'
          ? { includeBriefing: v['includeBriefing'] }
          : {})
      }
    case 'gate': {
      const show = v['show']
      if (
        !str(v['message']) ||
        (show !== 'diff' && show !== 'summary' && show !== 'backlog' && show !== 'none')
      ) {
        return null
      }
      return {
        ...base,
        type: 'gate',
        message: v['message'],
        show,
        onReject: str(v['onReject']) ? v['onReject'] : 'stop',
        timeoutMin: typeof v['timeoutMin'] === 'number' ? v['timeoutMin'] : null
      }
    }
    case 'orkio_action':
      return str(v['action']) ? { ...base, type: 'orkio_action', action: v['action'] } : null
    case 'branch': {
      const when = parseCondition(v['when'])
      if (!when || !str(v['then'])) return null
      return {
        ...base,
        type: 'branch',
        when,
        then: v['then'],
        ...(str(v['else']) ? { else: v['else'] } : {})
      }
    }
    default:
      return null
  }
}

export function parseFlowDef(v: unknown): Flow | null {
  if (!isRecord(v) || !str(v['id']) || !v['id'] || !str(v['name']) || !Array.isArray(v['steps'])) {
    return null
  }
  const steps = v['steps'].map(parseStep)
  if (!steps.every((s): s is Step => s !== null)) return null
  const tags = Array.isArray(v['tags'])
    ? v['tags'].filter((t): t is string => str(t) && /^[a-z0-9_-]{1,20}$/.test(t)).slice(0, 5)
    : []
  return { id: v['id'], name: v['name'], steps, ...(tags.length > 0 ? { tags } : {}) }
}

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
  // Uma ligação por etapa; ligação para fluxo que sumiu é descartada.
  const bindings: StageFlow[] = []
  for (const b of rawBindings.map(parseBinding)) {
    if (b && ids.has(b.flowId) && !bindings.some((x) => x.stageId === b.stageId)) bindings.push(b)
  }
  const alvaRaw = isRecord(v) && isRecord(v['alva']) ? v['alva'] : null
  const maxParallel =
    alvaRaw && typeof alvaRaw['maxParallel'] === 'number'
      ? Math.min(4, Math.max(1, Math.floor(alvaRaw['maxParallel'])))
      : null
  return {
    value: { flows, bindings, ...(maxParallel !== null ? { alva: { maxParallel } } : {}) },
    dropped: rawFlows.length - flows.length
  }
}
