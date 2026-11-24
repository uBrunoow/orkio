/**
 * Validadores dos objetos que o renderer manda pelo IPC. Cada um confere a forma e devolve uma
 * cópia só com os campos conhecidos (campo estranho nunca chega ao serviço). As regras de negócio
 * (nomes repetidos, ciclos, etc.) continuam nos serviços. Puro: sem Node nem DOM.
 */
import { MODEL_NAME_MAX, EFFORT_NAME_MAX, isEffort, isModelName } from '../agent-runtime'
import {
  BRIEFING_MAX,
  MESSAGE_MAX,
  type SendMessageRequest,
  type StartRunRequest
} from '../agent-run'
import type { AgentProfile, AgentScope, ProjectAgents } from '../agent'
import { ATTACHMENT_LIMITS } from '../attachments'
import { parseRule, type AutomationRule } from '../automation'
import { STAGE_LIMITS, isStageRole, type BoardSaveInput, type OrkioStageChoice } from '../board'
import type { FlowDraft, FlowStageDraft } from '../flow'
import { isReviewer } from '../github-names'
import { isRecord } from '../guards'
import type { NotionColor, NotionMappingField, NotionWorkspaceInput } from '../notion'
import { MAPPING_FIELDS } from '../notion-mapping'
import { ORCHESTRATOR_LIMITS, parseOrchestrator, type OrchestratorConfig } from '../orchestrator'
import type { ActivityQuery } from '../overview'
import { ACTIVITY_GROUPS, type ActivityGroup } from '../task-events'
import type { CreateProjectInput } from '../projects'
import { isBranchKind } from '../slug'
import { parseFlowDef, type Flow, type StageFlow } from '../task-flow'
import { INVALID, type Invalid } from './define'
import {
  isAgentKey,
  isLocalId,
  isNotionId,
  isNotionPropertyId,
  isProjectId,
  isStageId,
  isTaskId
} from './validate'

type Parsed<T> = T | Invalid

const str = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length <= max

// ---------- Projetos ----------

/** Criar projeto: só a seleção feita no main e o remote; nunca caminhos. */
export function parseCreateProjectInput(value: unknown): Parsed<CreateProjectInput> {
  if (!isRecord(value)) return INVALID
  const { selectionId, remoteName, hostConfirmed, name } = value
  if (
    !isLocalId(selectionId) ||
    typeof remoteName !== 'string' ||
    remoteName.length === 0 ||
    remoteName.length > 100 ||
    typeof hostConfirmed !== 'boolean' ||
    !(name === undefined || str(name, 200))
  ) {
    return INVALID
  }
  return { selectionId, remoteName, hostConfirmed, ...(name !== undefined ? { name } : {}) }
}

// ---------- Bancos do Notion ----------

export function parseWorkspaceInput(value: unknown): Parsed<NotionWorkspaceInput> {
  if (!isRecord(value)) return INVALID
  const { projectsDataSourceId, tasksDataSourceId, mapping } = value
  if (!isNotionId(projectsDataSourceId) || !isNotionId(tasksDataSourceId) || !isRecord(mapping)) {
    return INVALID
  }
  const out: NotionWorkspaceInput['mapping'] = {}
  for (const [key, id] of Object.entries(mapping)) {
    if (!(MAPPING_FIELDS as readonly string[]).includes(key)) return INVALID
    if (!(id === null || isNotionPropertyId(id))) return INVALID
    out[key as NotionMappingField] = id
  }
  return { projectsDataSourceId, tasksDataSourceId, mapping: out }
}

/** Busca de bancos: vazio/ausente = todos (`undefined`). */
export function parseDataSourceQuery(value: unknown): Parsed<string | undefined> {
  if (value === undefined || value === null || value === '') return undefined
  return str(value, 200) ? value : INVALID
}

// ---------- Quadro ----------

function parseOrkioStageChoice(value: unknown): Parsed<OrkioStageChoice> {
  if (!isRecord(value)) return INVALID
  if (value['mode'] === 'none' || value['mode'] === 'create') return { mode: value['mode'] }
  return value['mode'] === 'existing' && isNotionPropertyId(value['propertyId'])
    ? { mode: 'existing', propertyId: value['propertyId'] }
    : INVALID
}

export function parseBoardSaveInput(value: unknown): Parsed<BoardSaveInput> {
  if (!isRecord(value)) return INVALID
  const { stages, addMissingOptions, blockedPropertyId } = value
  if (!Array.isArray(stages) || stages.length === 0 || stages.length > STAGE_LIMITS.stages) {
    return INVALID
  }
  const parsedStages: BoardSaveInput['stages'] = []
  for (const s of stages) {
    if (!isRecord(s)) return INVALID
    const { id, name, notionStatusId, role } = s
    if (
      !(id === null || isStageId(id)) ||
      !str(name, STAGE_LIMITS.name) ||
      !isNotionPropertyId(notionStatusId) ||
      !(role === undefined || isStageRole(role))
    ) {
      return INVALID
    }
    parsedStages.push({ id, name, notionStatusId, ...(role !== undefined ? { role } : {}) })
  }
  const orkioStage = parseOrkioStageChoice(value['orkioStage'])
  if (
    orkioStage === INVALID ||
    typeof addMissingOptions !== 'boolean' ||
    !(blockedPropertyId === null || isNotionPropertyId(blockedPropertyId))
  ) {
    return INVALID
  }
  return { stages: parsedStages, orkioStage, addMissingOptions, blockedPropertyId }
}

// ---------- Fluxo do projeto (3C) ----------

function parseStageDraft(value: unknown): Parsed<FlowStageDraft> {
  if (!isRecord(value)) return INVALID
  const { id, name, notionStatusId, color, missingStatusName, role } = value
  if (
    !isStageId(id) ||
    !(role === undefined || isStageRole(role)) ||
    !str(name, STAGE_LIMITS.name) ||
    !(
      notionStatusId === null ||
      (typeof notionStatusId === 'string' && notionStatusId.length <= 200)
    ) ||
    !(color === undefined || typeof color === 'string') ||
    !(missingStatusName === undefined || str(missingStatusName, 200))
  ) {
    return INVALID
  }
  return {
    id,
    name,
    notionStatusId,
    ...(color !== undefined ? { color: color as NotionColor } : {}),
    ...(role !== undefined ? { role } : {}),
    ...(missingStatusName !== undefined ? { missingStatusName } : {})
  }
}

function parseBinding(value: unknown): Parsed<StageFlow> {
  if (!isRecord(value)) return INVALID
  const { stageId, flowId, enabled, mode } = value
  return isStageId(stageId) &&
    str(flowId, 100) &&
    typeof enabled === 'boolean' &&
    (mode === 'on_enter' || mode === 'manual')
    ? { stageId, flowId, enabled, mode }
    : INVALID
}

/** Valida a forma e devolve o rascunho normalizado; as regras (validateFlow) rodam no serviço. */
export function parseFlowDraft(value: unknown): Parsed<FlowDraft> {
  if (!isRecord(value)) return INVALID
  const { stages, rules, removals, bindings } = value
  if (!Array.isArray(stages) || stages.length > STAGE_LIMITS.stages) return INVALID
  if (!Array.isArray(rules) || rules.length > 100) return INVALID
  if (!isRecord(removals)) return INVALID
  const parsedStages = stages.map(parseStageDraft)
  if (parsedStages.some((s) => s === INVALID)) return INVALID
  const parsedRules = rules.map(parseRule)
  if (parsedRules.some((r) => r === null)) return INVALID
  const parsedRemovals: FlowDraft['removals'] = {}
  for (const [from, to] of Object.entries(removals)) {
    if (!isStageId(from) || !(to === null || isStageId(to))) return INVALID
    parsedRemovals[from] = to
  }
  let parsedBindings: StageFlow[] | undefined
  if (bindings !== undefined) {
    if (!Array.isArray(bindings) || bindings.length > STAGE_LIMITS.stages) return INVALID
    const list = bindings.map(parseBinding)
    if (list.some((b) => b === INVALID)) return INVALID
    parsedBindings = list as StageFlow[]
  }
  return {
    stages: parsedStages as FlowStageDraft[],
    rules: parsedRules as AutomationRule[],
    removals: parsedRemovals,
    ...(parsedBindings ? { bindings: parsedBindings } : {})
  }
}

// ---------- Claude Code ----------

/** Id de pedido de permissão/pergunta do CLI. */
export function isRequestId(value: unknown): value is string {
  return typeof value === 'string' && /^[\w-]{1,200}$/.test(value)
}

/**
 * Caminho relativo ao repositório vindo da lista de candidatos (o serviço confere de novo que é
 * um documento alterado nesta tarefa). Nada de absoluto, `..` ou controle.
 */
export function isRepoPath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 500 &&
    !value.startsWith('/') &&
    !/^[A-Za-z]:/.test(value) &&
    !value.split(/[\\/]/).includes('..') &&
    ![...value].some((c) => c.charCodeAt(0) < 0x20)
  )
}

export function parseStartRunRequest(value: unknown): Parsed<StartRunRequest> {
  if (!isRecord(value)) return INVALID
  const { projectId, taskId, mode, command, text, briefing, asAgent, branchKind } = value
  if (
    !isProjectId(projectId) ||
    !isTaskId(taskId) ||
    (mode !== 'prompt' && mode !== 'command') ||
    !(command === null || str(command, 100)) ||
    !str(text, MESSAGE_MAX) ||
    !str(briefing, BRIEFING_MAX) ||
    !(asAgent === undefined || typeof asAgent === 'boolean') ||
    !(branchKind === undefined || isBranchKind(branchKind))
  ) {
    return INVALID
  }
  return {
    projectId,
    taskId,
    mode,
    command,
    text,
    briefing,
    ...(asAgent !== undefined ? { asAgent } : {}),
    ...(branchKind !== undefined ? { branchKind } : {})
  }
}

type Attachment = NonNullable<SendMessageRequest['attachments']>[number]

/** Forma, quantidade, tamanho e nome; o tipo (bytes) quem confere é o `ClaudeService`. */
function parseAttachments(value: unknown): Parsed<Attachment[]> {
  if (!Array.isArray(value) || value.length > ATTACHMENT_LIMITS.maxFiles) return INVALID
  const out: Attachment[] = []
  for (const a of value) {
    if (!isRecord(a)) return INVALID
    const { name, mime, data } = a
    if (
      !Object.keys(a).every((k) => k === 'name' || k === 'mime' || k === 'data') ||
      typeof name !== 'string' ||
      name.length === 0 ||
      name.length > 120 ||
      !str(mime, 100) ||
      !(data instanceof Uint8Array) ||
      data.byteLength > ATTACHMENT_LIMITS.maxBytes
    ) {
      return INVALID
    }
    out.push({ name, mime, data })
  }
  return out
}

type RuntimePatch = NonNullable<SendMessageRequest['runtime']>

/** `{ model?, effort? }`: nome de modelo no padrão, raciocínio da lista; `null` = padrão. */
function parseRuntimePatch(value: unknown): Parsed<RuntimePatch> {
  if (!isRecord(value)) return INVALID
  if (Object.keys(value).some((k) => k !== 'model' && k !== 'effort')) return INVALID
  const { model, effort } = value
  if (
    !(model === undefined || model === null || isModelName(model)) ||
    !(effort === undefined || effort === null || isEffort(effort))
  ) {
    return INVALID
  }
  return {
    ...(model !== undefined ? { model } : {}),
    ...(effort !== undefined ? { effort } : {})
  }
}

export function parseSendMessageRequest(value: unknown): Parsed<SendMessageRequest> {
  if (!isRecord(value)) return INVALID
  const { projectId, taskId, text, fresh, asAgent } = value
  if (
    !isProjectId(projectId) ||
    !isTaskId(taskId) ||
    !str(text, MESSAGE_MAX) ||
    !(fresh === undefined || typeof fresh === 'boolean') ||
    !(asAgent === undefined || typeof asAgent === 'boolean')
  ) {
    return INVALID
  }
  const runtime = value['runtime'] === undefined ? undefined : parseRuntimePatch(value['runtime'])
  const attachments =
    value['attachments'] === undefined ? undefined : parseAttachments(value['attachments'])
  if (runtime === INVALID || attachments === INVALID) return INVALID
  return {
    projectId,
    taskId,
    text,
    ...(fresh !== undefined ? { fresh } : {}),
    ...(asAgent !== undefined ? { asAgent } : {}),
    ...(runtime !== undefined ? { runtime } : {}),
    ...(attachments !== undefined ? { attachments } : {})
  }
}

/** Respostas a uma pergunta do Claude (`AskUserQuestion`): pergunta → resposta. */
export function parseAnswers(value: unknown): Parsed<Record<string, string>> {
  if (!isRecord(value)) return INVALID
  const entries = Object.entries(value)
  if (entries.length > 20) return INVALID
  const out: Record<string, string> = {}
  for (const [question, answer] of entries) {
    if (question.length > 2000 || !str(answer, MESSAGE_MAX)) return INVALID
    out[question] = answer
  }
  return out
}

// ---------- Agentes e orquestrador ----------

/** Perfil vindo do editor: só a forma (tipos); as regras são do `validateAgent` no serviço. */
export function parseAgentProfile(value: unknown): Parsed<AgentProfile> {
  if (!isRecord(value)) return INVALID
  const v = value
  const limits = v['limits']
  if (!isRecord(limits)) return INVALID
  if (
    !str(v['id'], 40) ||
    !str(v['name'], 200) ||
    !str(v['role'], 20) ||
    !str(v['color'], 20) ||
    !str(v['model'], MODEL_NAME_MAX) ||
    !(v['effort'] === undefined || v['effort'] === null || str(v['effort'], EFFORT_NAME_MAX)) ||
    !(v['flow'] === null || str(v['flow'], 100)) ||
    !Array.isArray(v['commands']) ||
    v['commands'].length > 50 ||
    !v['commands'].every((c) => str(c, 100)) ||
    typeof v['delivery'] !== 'boolean' ||
    typeof v['archived'] !== 'boolean' ||
    !str(v['instructions'], 20_000) ||
    typeof limits['parallel'] !== 'number' ||
    typeof limits['stepsPerDay'] !== 'number' ||
    !(limits['costPerDayUsd'] === null || typeof limits['costPerDayUsd'] === 'number')
  ) {
    return INVALID
  }
  return {
    id: v['id'],
    name: v['name'],
    role: v['role'] as AgentProfile['role'],
    color: v['color'] as AgentProfile['color'],
    model: v['model'],
    effort: v['effort'] === undefined ? null : (v['effort'] as AgentProfile['effort']),
    flow: v['flow'] as string | null,
    commands: v['commands'] as string[],
    delivery: v['delivery'],
    archived: v['archived'],
    instructions: v['instructions'],
    limits: {
      parallel: limits['parallel'],
      stepsPerDay: limits['stepsPerDay'],
      costPerDayUsd: limits['costPerDayUsd'] as number | null
    }
  }
}

interface AgentSaveInput {
  projectId: string
  scope: Exclude<AgentScope, 'builtin'>
  profile: AgentProfile
  isNew: boolean
}

export function parseAgentSaveInput(value: unknown): Parsed<AgentSaveInput> {
  if (!isRecord(value)) return INVALID
  const { projectId, scope, isNew } = value
  const profile = parseAgentProfile(value['profile'])
  if (
    !isProjectId(projectId) ||
    (scope !== 'repo' && scope !== 'local') ||
    typeof isNew !== 'boolean' ||
    profile === INVALID
  ) {
    return INVALID
  }
  return { projectId, scope, profile, isNew }
}

export function parseAgentRules(value: unknown): Parsed<ProjectAgents['assignOnEnter']> {
  if (!Array.isArray(value) || value.length > 50) return INVALID
  const out: ProjectAgents['assignOnEnter'] = []
  for (const r of value) {
    if (!isRecord(r)) return INVALID
    const { stageId, agentKey } = r
    if (!isStageId(stageId) || !isAgentKey(agentKey)) return INVALID
    out.push({ stageId, agentKey })
  }
  return out
}

/** Hash sha256 (hex) do perfil aprovado. */
export function isProfileHash(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
}

/**
 * Config vinda do editor: só a forma, sem descartar nada em silêncio (a leitura tolerante da
 * config, `parseOrchestrator`, descartaria). As regras ficam no `validateOrchestrator` do serviço.
 * `enabledSince` é sempre do main.
 */
export function parseOrchestratorConfig(value: unknown): Parsed<OrchestratorConfig> {
  if (!isRecord(value)) return INVALID
  const lanes = value['lanes']
  if (
    typeof value['enabled'] !== 'boolean' ||
    !Array.isArray(lanes) ||
    lanes.length > ORCHESTRATOR_LIMITS.lanes
  ) {
    return INVALID
  }
  for (const lane of lanes) {
    if (!isRecord(lane)) return INVALID
    const agents = lane['agents']
    if (
      !isStageId(lane['stageId']) ||
      !(lane['next'] === null || isStageId(lane['next'])) ||
      !Array.isArray(agents) ||
      agents.length > ORCHESTRATOR_LIMITS.agentsPerLane ||
      !agents.every(isAgentKey) ||
      new Set(agents).size !== agents.length
    ) {
      return INVALID
    }
  }
  const parsed = parseOrchestrator({ ...value, enabledSince: null })
  // Etapa repetida seria descartada pela leitura tolerante: aqui é recusada.
  if (!parsed || parsed.lanes.length !== lanes.length) return INVALID
  return parsed
}

// ---------- Fluxos de tarefa (5A) e alva-flow (5B) ----------

/** Lista de fluxos vinda do editor: normalizada pelo mesmo parser da config. */
export function parseFlows(value: unknown): Parsed<Flow[]> {
  if (!Array.isArray(value) || value.length > 50) return INVALID
  const flows = value.map(parseFlowDef)
  if (!flows.every((f): f is Flow => f !== null)) return INVALID
  if (flows.some((f) => f.steps.length > 60 || f.id.length > 100)) return INVALID
  return flows
}

/** Valores de uma escolha no gate (ex.: revisores): logins ou `team:<slug>`, poucos e curtos. */
export function parseGateValues(value: unknown): Parsed<string[] | undefined> {
  if (value === undefined || value === null) return undefined
  return Array.isArray(value) && value.length <= 20 && value.every(isReviewer)
    ? [...value]
    : INVALID
}

export function parseDeliverySettings(value: unknown): Parsed<{ requirePushApproval: boolean }> {
  return isRecord(value) && typeof value['requirePushApproval'] === 'boolean'
    ? { requirePushApproval: value['requirePushApproval'] }
    : INVALID
}

interface AlvaBindings {
  plan: string | null
  deliver: string | null
  review: string | null
  reviewed: string | null
}

export function parseAlvaBindings(value: unknown): Parsed<AlvaBindings> {
  if (!isRecord(value)) return INVALID
  const stage = (v: unknown): v is string | null => v === null || isStageId(v)
  const { plan, deliver, review, reviewed } = value
  return stage(plan) && stage(deliver) && stage(review) && stage(reviewed)
    ? { plan, deliver, review, reviewed }
    : INVALID
}

// ---------- Visão geral (6D) ----------

/** Filtro da atividade: só campos conhecidos e válidos; ausente = sem filtro. */
export function parseActivityQuery(value: unknown): Parsed<ActivityQuery> {
  if (value === undefined || value === null) return {}
  if (!isRecord(value)) return INVALID
  const query: ActivityQuery = {}
  if (value['projectId'] !== undefined && value['projectId'] !== null) {
    if (!isProjectId(value['projectId'])) return INVALID
    query.projectId = value['projectId']
  }
  if (value['group'] !== undefined && value['group'] !== null) {
    if (!(ACTIVITY_GROUPS as readonly unknown[]).includes(value['group'])) return INVALID
    query.group = value['group'] as ActivityGroup
  }
  if (value['beforeId'] !== undefined && value['beforeId'] !== null) {
    if (!Number.isSafeInteger(value['beforeId']) || (value['beforeId'] as number) < 1) {
      return INVALID
    }
    query.beforeId = value['beforeId'] as number
  }
  if (value['limit'] !== undefined) {
    if (!Number.isSafeInteger(value['limit']) || (value['limit'] as number) < 1) return INVALID
    query.limit = Math.min(value['limit'] as number, 200)
  }
  return query
}
