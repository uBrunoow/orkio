/**
 * Agentes do Orkio (Etapa 8A): perfil (nome, papel, instruções, modelo, fluxo preferido, comandos,
 * entrega, limites) guardado num arquivo `.md` com frontmatter. Puro: usado no main (ler/gravar,
 * validar, montar o prompt) e no renderer (editor e prévia).
 *
 * Regras:
 * - O agente nunca ganha permissões: as instruções só entram no `--append-system-prompt`; a política
 *   (`policy.ts`), os gates, o modo entrega e "Exigir minha aprovação" continuam iguais.
 * - Ele pode ter MENOS: sem entrega (`delivery: false`) e só alguns comandos (`commands`).
 * - O parser aceita só um subconjunto estrito de YAML (escalares, listas `[a, b]` e um nível de
 *   mapa em `limits`); qualquer outra coisa vira erro ou aviso, nunca execução.
 */
import { CLAUDE_MODELS, isEffort, isModelName, type Effort } from './agent-runtime'
import { isCommandName } from './agent-run'
import type { Flow } from './task-flow'
import { normalizeLabel } from './text'

export const AGENT_FORMAT = 'agent/v1'

export const AGENT_ROLES = [
  'implementer',
  'reviewer',
  'qa',
  'triager',
  'documenter',
  'custom'
] as const
export type AgentRole = (typeof AGENT_ROLES)[number]

export const AGENT_ROLE_LABELS: Record<AgentRole, string> = {
  implementer: 'Implementador(a)',
  reviewer: 'Revisor(a)',
  qa: 'QA e testes',
  triager: 'Triagem',
  documenter: 'Documentação',
  custom: 'Outro papel'
}

/** Cores do avatar: nomes das cores de `Token` da Astryx (o tema decide o tom; nada de hex). */
export const AGENT_COLORS = ['orange', 'blue', 'green', 'purple', 'pink', 'teal', 'yellow'] as const
export type AgentColor = (typeof AGENT_COLORS)[number]

/** Modelos sugeridos no editor; qualquer nome que passe `isModelName` também vale. */
export const AGENT_MODELS: readonly string[] = CLAUDE_MODELS.map((m) => m.id)

export const AGENT_MODEL_LABELS: Record<string, string> = Object.fromEntries(
  CLAUDE_MODELS.map((m) => [m.id, m.label])
)

export const AGENT_LIMITS = {
  /** Tamanho máximo do arquivo do perfil (bytes). */
  fileBytes: 16 * 1024,
  instructions: 8_000,
  name: 40,
  commands: 50,
  parallel: 4,
  stepsPerDay: 500,
  costPerDayUsd: 1_000
} as const

export const AGENT_ID = /^[a-z0-9][a-z0-9-]{0,39}$/
const FLOW_ID = /^[\w-]{1,80}$/

export interface AgentLimits {
  /** Fluxos deste agente ao mesmo tempo (todas as tarefas). */
  parallel: number
  /** Execuções do Claude Code por dia (dia local), somando fluxos e "Rodar". */
  stepsPerDay: number
  /** Custo por dia (US$, o que o CLI informa); `null` = sem limite. */
  costPerDayUsd: number | null
}

export interface AgentProfile {
  id: string
  name: string
  role: AgentRole
  color: AgentColor
  /** `default` (padrão do Claude Code) ou um nome de modelo (`isModelName`). */
  model: string
  /** Raciocínio (`--effort`); `null` = padrão do Claude Code. */
  effort: Effort | null
  /** Fluxo de tarefa preferido (id no projeto); `null` = usa o fluxo da coluna. */
  flow: string | null
  /** Comandos/skills do catálogo que o agente pode rodar; vazio = todos. */
  commands: string[]
  /** Pode rodar passos em modo entrega, push e pedir review. */
  delivery: boolean
  limits: AgentLimits
  archived: boolean
  /** Markdown; entra no `--append-system-prompt` (nunca no lugar do briefing). */
  instructions: string
}

/**
 * Onde o perfil mora: no repositório do projeto, só neste computador ou embutido no Orkio
 * (`builtin`: catálogo pré-criado, só leitura, já aprovado; "Duplicar" gera uma cópia editável).
 */
export type AgentScope = 'repo' | 'local' | 'builtin'

/** Escopos em que o Orkio grava o perfil (o embutido vem do código). */
export type WritableAgentScope = Exclude<AgentScope, 'builtin'>

/**
 * `repo:<id>` (vale no projeto), `local:<id>` (vale em todos os seus projetos) ou `builtin:<id>`
 * (catálogo do Orkio, vale em todos).
 */
export type AgentKey = string

export function agentKey(scope: AgentScope, id: string): AgentKey {
  return `${scope}:${id}`
}

export function parseAgentKey(key: unknown): { scope: AgentScope; id: string } | null {
  if (typeof key !== 'string') return null
  const m = /^(repo|local|builtin):(.+)$/.exec(key)
  if (!m || !AGENT_ID.test(m[2]!)) return null
  return { scope: m[1] as AgentScope, id: m[2]! }
}

export function defaultAgent(partial: Partial<AgentProfile> = {}): AgentProfile {
  return {
    id: '',
    name: '',
    role: 'implementer',
    color: 'orange',
    model: 'default',
    effort: null,
    flow: null,
    commands: [],
    delivery: true,
    limits: { parallel: 1, stepsPerDay: 40, costPerDayUsd: null },
    archived: false,
    instructions: '',
    ...partial
  }
}

/** "Ana Souza" → "AS"; "ana" → "AN". */
export function agentInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase()
  return `${words[0]![0]}${words[words.length - 1]![0]}`.toUpperCase()
}

/** Id a partir do nome: minúsculas, sem acento, hífens. */
export function agentIdFromName(name: string): string {
  return normalizeLabel(name)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '')
}

// ---------- Arquivo (.md com frontmatter) ----------

export type AgentParse =
  { ok: true; profile: AgentProfile; warnings: string[] } | { ok: false; errors: string[] }

type Scalar = string | number | boolean | null
type Value = Scalar | string[] | Record<string, Scalar>

const KNOWN_KEYS = new Set([
  'orkio',
  'id',
  'name',
  'role',
  'color',
  'model',
  'effort',
  'flow',
  'commands',
  'delivery',
  'limits',
  'archived'
])
const LIMIT_KEYS = new Set(['parallel', 'stepsPerDay', 'costPerDayUsd'])

/** Lê um perfil. Nunca lança: arquivo estranho vira `{ ok: false, errors }`. */
export function parseAgentFile(text: string): AgentParse {
  if (byteLength(text) > AGENT_LIMITS.fileBytes) {
    return { ok: false, errors: ['O arquivo do agente passa de 16 KB.'] }
  }
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
  const m = /^---\n([\s\S]*?)\n---[ \t]*(?:\n([\s\S]*))?$/.exec(normalized)
  if (!m) return { ok: false, errors: ['O arquivo precisa começar com o cabeçalho entre “---”.'] }
  const head = parseHead(m[1]!)
  if ('error' in head) return { ok: false, errors: [head.error] }
  const warnings: string[] = []
  for (const key of Object.keys(head.values)) {
    if (!KNOWN_KEYS.has(key)) warnings.push(`Campo desconhecido ignorado: ${key}.`)
  }
  const v = head.values
  if (v['orkio'] !== AGENT_FORMAT) {
    return { ok: false, errors: [`Formato não reconhecido (esperado “orkio: ${AGENT_FORMAT}”).`] }
  }
  const errors: string[] = []
  const str = (key: string): string | null => (typeof v[key] === 'string' ? v[key] : null)
  const limitsRaw = v['limits'] ?? {}
  if (typeof limitsRaw !== 'object' || limitsRaw === null || Array.isArray(limitsRaw)) {
    errors.push('“limits” precisa ser um bloco com parallel, stepsPerDay e costPerDayUsd.')
  }
  const limitsObj = (
    typeof limitsRaw === 'object' && limitsRaw !== null && !Array.isArray(limitsRaw)
      ? limitsRaw
      : {}
  ) as Record<string, Scalar>
  for (const key of Object.keys(limitsObj)) {
    if (!LIMIT_KEYS.has(key)) warnings.push(`Limite desconhecido ignorado: ${key}.`)
  }
  const base = defaultAgent()
  const commandsRaw = v['commands'] ?? []
  if (!Array.isArray(commandsRaw)) errors.push('“commands” precisa ser uma lista: [a, b].')
  const profile: AgentProfile = {
    id: str('id') ?? '',
    name: str('name') ?? '',
    role: (str('role') ?? base.role) as AgentRole,
    color: (str('color') ?? base.color) as AgentColor,
    model: str('model') ?? base.model,
    effort: v['effort'] === undefined || v['effort'] === null ? null : (v['effort'] as Effort),
    flow: v['flow'] === null || v['flow'] === undefined ? null : (str('flow') ?? '\u0000'),
    commands: Array.isArray(commandsRaw) ? commandsRaw : [],
    delivery: v['delivery'] === undefined ? base.delivery : (v['delivery'] as boolean),
    limits: {
      parallel: (limitsObj['parallel'] ?? base.limits.parallel) as number,
      stepsPerDay: (limitsObj['stepsPerDay'] ?? base.limits.stepsPerDay) as number,
      costPerDayUsd: (limitsObj['costPerDayUsd'] ?? null) as number | null
    },
    archived: v['archived'] === undefined ? false : (v['archived'] as boolean),
    instructions: (m[2] ?? '').replace(/^\n+/, '').replace(/\s+$/, '')
  }
  errors.push(...validateAgent(profile))
  return errors.length > 0 ? { ok: false, errors } : { ok: true, profile, warnings }
}

/** Erros que impedem usar o perfil (mensagens pt-BR). */
export function validateAgent(p: AgentProfile): string[] {
  const errors: string[] = []
  if (typeof p.id !== 'string' || !AGENT_ID.test(p.id)) {
    errors.push('Id inválido: use letras minúsculas, números e hífens (até 40).')
  }
  if (typeof p.name !== 'string' || !p.name.trim()) errors.push('Dê um nome ao agente.')
  else if (p.name.length > AGENT_LIMITS.name) errors.push('Nome com mais de 40 caracteres.')
  else if (/[\n\r]/.test(p.name)) errors.push('O nome não pode ter quebras de linha.')
  if (!AGENT_ROLES.includes(p.role)) errors.push('Papel desconhecido.')
  if (!AGENT_COLORS.includes(p.color)) errors.push('Cor desconhecida.')
  if (!isModelName(p.model)) errors.push('Modelo inválido')
  if (p.effort !== null && !isEffort(p.effort)) errors.push('Raciocínio inválido')
  if (p.flow !== null && (typeof p.flow !== 'string' || !FLOW_ID.test(p.flow))) {
    errors.push('Fluxo preferido inválido.')
  }
  if (!Array.isArray(p.commands) || p.commands.length > AGENT_LIMITS.commands) {
    errors.push('Lista de comandos inválida (até 50).')
  } else if (p.commands.some((c) => !isCommandName(c))) {
    errors.push('Há um comando com nome inválido na lista.')
  }
  if (typeof p.delivery !== 'boolean') errors.push('“delivery” precisa ser true ou false.')
  if (typeof p.archived !== 'boolean') errors.push('“archived” precisa ser true ou false.')
  const l = p.limits
  if (!isInt(l.parallel, 1, AGENT_LIMITS.parallel)) {
    errors.push(`Execuções em paralelo: de 1 a ${AGENT_LIMITS.parallel}.`)
  }
  if (!isInt(l.stepsPerDay, 1, AGENT_LIMITS.stepsPerDay)) {
    errors.push(`Execuções por dia: de 1 a ${AGENT_LIMITS.stepsPerDay}.`)
  }
  if (
    l.costPerDayUsd !== null &&
    !(
      typeof l.costPerDayUsd === 'number' &&
      Number.isFinite(l.costPerDayUsd) &&
      l.costPerDayUsd > 0 &&
      l.costPerDayUsd <= AGENT_LIMITS.costPerDayUsd
    )
  ) {
    errors.push('Custo por dia: um valor maior que zero, ou vazio para sem limite.')
  }
  if (typeof p.instructions !== 'string') errors.push('Instruções inválidas.')
  else if (p.instructions.length > AGENT_LIMITS.instructions) {
    errors.push(
      `Instruções com mais de ${AGENT_LIMITS.instructions.toLocaleString('pt-BR')} caracteres.`
    )
  } else if (/^---[ \t]*$/m.test(p.instructions)) {
    errors.push('As instruções não podem ter uma linha só com “---”.')
  }
  return errors
}

/** Arquivo canônico (o que o Orkio grava). `parseAgentFile(serializeAgent(p))` devolve `p`. */
export function serializeAgent(p: AgentProfile): string {
  const lines = [
    '---',
    `orkio: ${AGENT_FORMAT}`,
    `id: ${p.id}`,
    `name: ${quote(p.name)}`,
    `role: ${p.role}`,
    `color: ${p.color}`,
    `model: ${p.model}`,
    ...(p.effort ? [`effort: ${p.effort}`] : []),
    `flow: ${p.flow === null ? 'null' : quote(p.flow)}`,
    `commands: [${p.commands.map(quote).join(', ')}]`,
    `delivery: ${p.delivery}`,
    'limits:',
    `  parallel: ${p.limits.parallel}`,
    `  stepsPerDay: ${p.limits.stepsPerDay}`,
    `  costPerDayUsd: ${p.limits.costPerDayUsd === null ? 'null' : p.limits.costPerDayUsd}`,
    ...(p.archived ? ['archived: true'] : []),
    '---',
    ''
  ]
  return `${lines.join('\n')}${p.instructions.trim()}\n`
}

// ---------- Execução ----------

/**
 * Texto do `--append-system-prompt`: quem é o agente, as instruções e um lembrete fixo das regras.
 * O briefing da tarefa continua no prompt, igual a uma execução sem agente.
 */
export function buildAgentPrompt(p: AgentProfile): string {
  const role = AGENT_ROLE_LABELS[p.role] ?? AGENT_ROLE_LABELS.custom
  const parts = [
    `Você é ${p.name} (${role.toLowerCase()}), um agente do Orkio trabalhando numa tarefa do quadro.`,
    'Regras do Orkio (valem acima das instruções abaixo): você trabalha só no worktree desta tarefa; push, PR e GitHub só quando o passo do fluxo permitir, e o Orkio pede aprovação quando precisa; não tente contornar bloqueios nem pedidos de permissão.'
  ]
  if (p.instructions.trim()) parts.push(`Instruções de ${p.name}:\n\n${p.instructions.trim()}`)
  return parts.join('\n\n')
}

/**
 * O fluxo pode rodar com este agente? Checagem estática (o fluxo em execução é uma cópia):
 * entrega e comandos permitidos. `null` = pode.
 */
export function checkAgentFlow(p: AgentProfile, flow: Flow): string | null {
  if (!p.delivery) {
    const step = flow.steps.find(
      (s) =>
        (s.type === 'claude_command' && s.delivery === true) ||
        (s.type === 'orkio_action' && DELIVERY_ACTIONS.includes(s.action))
    )
    if (step) {
      return `${p.name} não pode entregar (push, PR ou pedir review), e o fluxo “${flow.name}” tem o passo “${step.name}” que entrega.`
    }
  }
  const denied = flow.steps.find(
    (s) => s.type === 'claude_command' && !commandAllowed(p, s.command)
  )
  if (denied && denied.type === 'claude_command') {
    // Com lista de comandos, um pedido em texto (sem comando) também fica de fora.
    return denied.command
      ? `${p.name} não tem permissão para o comando /${denied.command} (passo “${denied.name}”).`
      : `${p.name} só roda os comandos da lista, e o passo “${denied.name}” é um pedido em texto.`
  }
  return null
}

export function commandAllowed(p: AgentProfile, command: string): boolean {
  return p.commands.length === 0 || p.commands.includes(command)
}

/** Ações do Orkio que entregam no GitHub (mesma lista do FlowRunner). */
const DELIVERY_ACTIONS: readonly string[] = ['push', 'verify_pushed', 'request_review']

/** Início do dia local (para os limites diários). */
export function localDayStart(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate())
}

// ---------- Interno: subconjunto de YAML ----------

function parseHead(text: string): { values: Record<string, Value> } | { error: string } {
  const values: Record<string, Value> = {}
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (!line.trim() || /^\s*#/.test(line)) continue
    const m = /^([A-Za-z][A-Za-z0-9_]*):(?:[ \t]+(.*))?$/.exec(line)
    if (!m) return { error: `Linha ${i + 2} do cabeçalho não reconhecida.` }
    const key = m[1]!
    if (Object.prototype.hasOwnProperty.call(values, key)) {
      return { error: `Campo repetido no cabeçalho: ${key}.` }
    }
    const raw = stripComment(m[2] ?? '')
    if (raw === '') {
      // Bloco: linhas indentadas `  chave: valor` (um nível só).
      const block: Record<string, Scalar> = {}
      while (i + 1 < lines.length && /^[ \t]+\S/.test(lines[i + 1]!)) {
        i++
        const bm = /^[ \t]+([A-Za-z][A-Za-z0-9_]*):[ \t]+(.*)$/.exec(lines[i]!)
        if (!bm) return { error: `Linha ${i + 2} do cabeçalho não reconhecida.` }
        const value = scalar(stripComment(bm[2]!))
        if (value === undefined) return { error: `Valor inválido em ${key}.${bm[1]}.` }
        block[bm[1]!] = value
      }
      values[key] = block
      continue
    }
    if (raw.startsWith('[')) {
      const list = inlineList(raw)
      if (!list) return { error: `Lista inválida em ${key}.` }
      values[key] = list
      continue
    }
    const value = scalar(raw)
    if (value === undefined) return { error: `Valor inválido em ${key}.` }
    values[key] = value
  }
  return { values }
}

function stripComment(raw: string): string {
  const t = raw.trim()
  if (t.startsWith('"') || t.startsWith("'") || t.startsWith('[')) return t
  return t.replace(/\s+#.*$/, '').trim()
}

function scalar(raw: string): Scalar | undefined {
  if (raw === 'null' || raw === '~') return null
  if (raw === 'true') return true
  if (raw === 'false') return false
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw)
  if (raw.startsWith('"')) {
    if (!/^"(?:[^"\\]|\\.)*"$/.test(raw)) return undefined
    try {
      return JSON.parse(raw) as string
    } catch {
      return undefined
    }
  }
  if (raw.startsWith("'")) {
    if (!/^'(?:[^']|'')*'$/.test(raw)) return undefined
    return raw.slice(1, -1).replace(/''/g, "'")
  }
  // Nada de âncoras, tags, blocos ou mapas inline.
  if (/^[&*!|>{[]/.test(raw)) return undefined
  return raw
}

function inlineList(raw: string): string[] | null {
  if (!raw.endsWith(']')) return null
  const inner = raw.slice(1, -1).trim()
  if (!inner) return []
  const out: string[] = []
  for (const part of inner.split(',')) {
    const v = scalar(part.trim())
    if (typeof v !== 'string') return null
    out.push(v)
  }
  return out
}

function quote(s: string): string {
  return JSON.stringify(s)
}

function isInt(n: unknown, min: number, max: number): boolean {
  return typeof n === 'number' && Number.isInteger(n) && n >= min && n <= max
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length
}

// ---------- Config por projeto ----------

/** `orkio-config.json` → `agents[projectId]` (v9): regras de atribuição por coluna. */
export interface ProjectAgents {
  /** "Tarefas que entram em <etapa> vão para <agente>" (uma regra por etapa). */
  assignOnEnter: { stageId: string; agentKey: AgentKey }[]
}

export function parseProjectAgents(value: unknown): ProjectAgents | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const raw = (value as Record<string, unknown>)['assignOnEnter']
  if (!Array.isArray(raw)) return null
  const seen = new Set<string>()
  const assignOnEnter: ProjectAgents['assignOnEnter'] = []
  for (const r of raw.slice(0, 50)) {
    if (typeof r !== 'object' || r === null) continue
    const { stageId, agentKey: key } = r as Record<string, unknown>
    if (typeof stageId !== 'string' || !stageId || seen.has(stageId)) continue
    if (!parseAgentKey(key)) continue
    seen.add(stageId)
    assignOnEnter.push({ stageId, agentKey: key as string })
  }
  return { assignOnEnter }
}

// ---------- Visões para a tela ----------

/**
 * - `ready`: pode receber e rodar tarefas.
 * - `needs_review`: perfil do repositório novo ou alterado fora do Orkio; aprove antes de rodar.
 * - `invalid`: arquivo com erro (não roda nem recebe tarefas).
 * - `archived`: guardado, sem receber tarefas.
 */
export type AgentStatus = 'ready' | 'needs_review' | 'invalid' | 'archived'

export interface AgentView {
  key: AgentKey
  scope: AgentScope
  id: string
  /** Caminho para mostrar: `.orkio/agents/ana.md` (repositório) ou `agents/ana.md` (este computador). */
  file: string
  status: AgentStatus
  /** `null` quando o arquivo é inválido. */
  profile: AgentProfile | null
  errors: string[]
  warnings: string[]
  /** Hash do arquivo (para aprovar exatamente o que você revisou). */
  hash: string
  /** Tarefas atribuídas neste projeto. */
  assigned: number
  usageToday: { runs: number; costUsd: number }
  /** Execuções por hora nas últimas `ACTIVITY_HOURS` horas (todos os projetos), da mais antiga à atual. */
  activity: number[]
}

/** Janela da atividade dos agentes (mini-histograma da tela Agentes). */
export const ACTIVITY_HOURS = 12

export interface AgentsState {
  projectId: string
  agents: AgentView[]
  rules: ProjectAgents['assignOnEnter']
  /** Etapas do quadro e fluxos de tarefa do projeto (para o editor). */
  stages: { id: string; name: string }[]
  flows: { id: string; name: string }[]
}

/** O que o card do quadro mostra. */
export interface AgentBadge {
  key: AgentKey
  name: string
  color: AgentColor
  initials: string
  /** Modelo/raciocínio do perfil (rótulo "Do agente: …" no seletor); ausente = perfil indisponível. */
  model?: string
  effort?: Effort | null
  /** Perfil apagado, inválido ou sem aprovação: o card avisa. */
  problem: string | null
}
