/**
 * Integração com o plugin alva-flow (Etapa 5B): os nomes do plugin (comandos, status, variáveis,
 * marcador dos fluxos), tipos compartilhados e as funções puras de leitura das tasks do Backlog.md
 * (frontmatter, status, critérios, perguntas em aberto). Quem fala do plugin usa as constantes
 * daqui (pré-checagem, extrator, modelos, fases da tela, problemas do fluxo).
 */
import type { FlowOutput } from './orkio-actions'
import { FLOW_NO, FLOW_YES } from './task-flow'
import type { TaskPhaseId } from './task-phase'

export const ALVA_PLUGIN = 'alva-flow'
export const ALVA_COMMANDS = ['spec', 'plan', 'implement', 'review', 'fix', 'commit', 'pr'] as const
export type AlvaCommand = (typeof ALVA_COMMANDS)[number]

/** Nome do comando no catálogo (`alva-flow:spec`). */
export function alvaCommand(command: AlvaCommand): string {
  return `${ALVA_PLUGIN}:${command}`
}

/** Qual comando do plugin é este (`alva-flow:review` → `review`); `null` se não é do plugin. */
export function alvaCommandOf(command: string): AlvaCommand | null {
  const prefix = `${ALVA_PLUGIN}:`
  if (!command.startsWith(prefix)) return null
  const name = command.slice(prefix.length)
  return ALVA_COMMANDS.find((c) => c === name) ?? null
}

/** Fase da tarefa (barra do topo) de cada comando do plugin. */
export const ALVA_COMMAND_PHASE: Record<AlvaCommand, TaskPhaseId> = {
  spec: 'spec',
  plan: 'plan',
  implement: 'implement',
  review: 'review',
  fix: 'review',
  commit: 'pr',
  pr: 'pr'
}

/** Documento do Backlog.md que o comando escreve: a spec (`/spec`) ou o plano (`/plan`). */
export function backlogDocumentOf(command: string | null): 'spec' | 'plan' | null {
  const c = command ? alvaCommandOf(command) : null
  return c === 'spec' || c === 'plan' ? c : null
}

/** Opção do `/pr` que trata os comentários da PR (sem ela, o `/pr` abre a PR e acompanha o CI). */
export const ALVA_PR_COMMENTS_FLAG = '--comments'

/** O passo espera o CI do GitHub: o `/pr` do plugin sem `--comments` acompanha os checks até o fim. */
export function alvaWaitsForCi(command: string, args: string): boolean {
  return alvaCommandOf(command) === 'pr' && !args.split(/\s+/).includes(ALVA_PR_COMMENTS_FLAG)
}

/** Marcador (`Flow.tags`) dos fluxos que usam o plugin: pré-checagem, variáveis e limite. */
export const ALVA_TAG = 'alva'
/** Prefixo das variáveis do alva-flow nos fluxos. */
export const ALVA_VAR_PREFIX = 'alva.'

/** Variáveis que a integração grava (no início do fluxo e pelo extrator `alva`). */
export const ALVA_VARS = {
  taskId: 'alva.task_id',
  specArg: 'alva.spec_arg',
  linked: 'alva.linked',
  status: 'alva.status',
  openQuestions: 'alva.open_questions',
  reviewBlocker: 'alva.review_blocker',
  size: 'alva.size'
} as const

/** Id do extrator do alva-flow (lê a task do Backlog.md depois de cada comando). */
export const ALVA_EXTRACTOR = 'alva'

/** Códigos de falha de passo do alva-flow (a tela de problema reconhece por eles). */
export const ALVA_FAILURES = {
  /** O /spec terminou sem criar nem alterar uma task em backlog/tasks/. */
  noTaskCreated: 'alva_no_task',
  /** O passo usa `alva.*`, mas a tarefa ainda não tem task do Backlog vinculada. */
  notLinked: 'alva_not_linked'
} as const

/** Quantos fluxos Alva podem rodar ao mesmo tempo num projeto com Docker (portas). */
export const ALVA_MAX_PARALLEL = { min: 1, max: 4, fallback: 1 } as const

export function clampAlvaParallel(value: number): number {
  return Math.min(ALVA_MAX_PARALLEL.max, Math.max(ALVA_MAX_PARALLEL.min, Math.floor(value)))
}

export type AlvaCheckState = 'ok' | 'missing' | 'warning'

export interface AlvaCheckItem {
  id: 'plugin' | 'backlog' | 'backlog_mcp' | 'gh' | 'python' | 'makefile' | 'docker'
  label: string
  state: AlvaCheckState
  detail: string
  /** Comando ou link para resolver (mostrado para copiar). */
  fix?: string
}

export interface AlvaPrecheck {
  /** Nenhum item faltando (avisos não bloqueiam). */
  ready: boolean
  pluginVersion: string | null
  hasDocker: boolean
  items: AlvaCheckItem[]
  checkedAt: string
}

/** Status do Backlog.md usados pelo alva-flow (o config do projeto pode ter outros). */
export const ALVA_STATUSES = [
  'To Do',
  'Requirements Defined',
  'Architected',
  'Executed',
  'Reviewed',
  'Done'
] as const
export type AlvaTaskStatus = (typeof ALVA_STATUSES)[number]
/** Status depois de um `/review` limpo (ou de um `/spec` do caminho Pequeno, que já implementa). */
export const ALVA_REVIEWED: AlvaTaskStatus = 'Reviewed'

/** As variáveis do alva-flow como saídas declaradas (o validador confere os fluxos contra elas). */
export const ALVA_OUTPUTS: readonly FlowOutput[] = [
  { key: ALVA_VARS.taskId, about: 'ID da task do Backlog.md vinculada (ex.: TASK-12)' },
  { key: ALVA_VARS.specArg, about: 'argumento do /spec (o ID, ou o resumo da tarefa sem vínculo)' },
  { key: ALVA_VARS.linked, values: [FLOW_YES, FLOW_NO], about: 'a tarefa já tem task vinculada' },
  { key: ALVA_VARS.status, about: 'status da task no Backlog.md' },
  { key: ALVA_VARS.openQuestions, about: 'perguntas em aberto na spec' },
  {
    key: ALVA_VARS.reviewBlocker,
    values: [FLOW_YES, FLOW_NO],
    about: 'o /review deixou blocker'
  },
  { key: ALVA_VARS.size, values: ['Pequeno', 'Médio', 'Grande'], about: 'tamanho dado pelo /spec' }
]

/** O que o Orkio lê de uma task do Backlog.md (nada de descrição, plano ou notas). */
export interface BacklogTaskInfo {
  id: string
  title: string
  status: string
  criteria: { done: number; total: number }
  /** Itens `- [ ]` na seção "Perguntas em aberto" da descrição. */
  openQuestions: number
}

/** Tamanho máximo do texto da task mostrado na tela (o resto é cortado, com aviso). */
export const BACKLOG_DOC_LIMIT = 60_000

/** A task do Backlog.md para leitura (spec, critérios e plano), só no renderer, nunca guardada. */
export interface BacklogTaskDocument {
  info: BacklogTaskInfo
  /** Markdown sem o frontmatter e sem os marcadores HTML; segredos ocultados no main. */
  body: string
  truncated: boolean
  /** Ainda não vinculada: o rascunho que o `/spec` desta tarefa está escrevendo no worktree. */
  draft?: boolean
}

/**
 * Corpo legível da task: tira o frontmatter e os marcadores (`<!-- AC:BEGIN -->`...), junta
 * linhas em branco e corta no limite (no fim de uma linha).
 */
export function backlogTaskBody(markdown: string): { body: string; truncated: boolean } {
  const withoutFrontmatter = markdown.replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n?/, '')
  const clean = withoutFrontmatter
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  if (clean.length <= BACKLOG_DOC_LIMIT) return { body: clean, truncated: false }
  const cut = clean.slice(0, BACKLOG_DOC_LIMIT)
  const lastBreak = cut.lastIndexOf('\n')
  return { body: (lastBreak > 0 ? cut.slice(0, lastBreak) : cut).trimEnd(), truncated: true }
}

/** Spec e plano da task do Backlog.md (abas Spec e Plano): separa no título do plano. */
const PLAN_HEADING = /^#{1,3}\s+(implementation plan|plano)\b.*$/im

export function splitBacklogBody(body: string): { spec: string; plan: string | null } {
  const match = PLAN_HEADING.exec(body)
  if (!match) return { spec: body.trim(), plan: null }
  return { spec: body.slice(0, match.index).trim(), plan: body.slice(match.index).trim() }
}

function unquote(v: string): string {
  const t = v.trim()
  if ((t.startsWith("'") && t.endsWith("'")) || (t.startsWith('"') && t.endsWith('"'))) {
    return t.slice(1, -1).replace(/''/g, "'")
  }
  return t
}

/** Frontmatter + critérios + perguntas em aberto. `null` se não parece uma task do Backlog.md. */
export function parseBacklogTask(markdown: string): BacklogTaskInfo | null {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown)
  if (!fm) return null
  const fields: Record<string, string> = {}
  for (const line of fm[1]!.split(/\r?\n/)) {
    const m = /^(id|title|status):\s*(.*)$/.exec(line)
    if (m) fields[m[1]!] = unquote(m[2]!)
  }
  if (!fields['id'] || !fields['status']) return null

  const ac = /<!-- AC:BEGIN -->([\s\S]*?)<!-- AC:END -->/.exec(markdown)?.[1] ?? ''
  const items = [...ac.matchAll(/^\s*- \[( |x|X)\]/gm)]
  const description =
    /<!-- SECTION:DESCRIPTION:BEGIN -->([\s\S]*?)<!-- SECTION:DESCRIPTION:END -->/.exec(
      markdown
    )?.[1] ?? markdown
  const questions = /^##+\s*Perguntas em aberto\s*$([\s\S]*?)(?=^##+\s|$(?![\s\S]))/m.exec(
    description
  )?.[1]
  return {
    id: fields['id'],
    title: fields['title'] ?? '',
    status: fields['status'],
    criteria: {
      done: items.filter((m) => m[1] !== ' ').length,
      total: items.length
    },
    openQuestions: questions ? [...questions.matchAll(/^\s*- \[ \]/gm)].length : 0
  }
}

/**
 * Tamanho da demanda pela mensagem final do /spec ("**Tamanho:** Médio"), que só aparece no
 * Médio/Grande. Pequeno é reconhecido pelo status Reviewed depois do /spec (sinal confiável).
 */
export function sizeFromSpecResult(resultText: string): 'Médio' | 'Grande' | null {
  const m = /\*\*Tamanho:\*\*\s*(M[ée]dio|Grande)/i.exec(resultText)
  if (!m) return null
  return /grande/i.test(m[1]!) ? 'Grande' : 'Médio'
}

/** Arquivo de task do Backlog.md (`task-12 - Titulo.md`) → prefixo do id em minúsculas. */
export function taskFileId(fileName: string): string | null {
  return /^([A-Za-z]+-\d+(?:\.\d+)*) - .*\.md$/.exec(fileName)?.[1]?.toLowerCase() ?? null
}

export interface AlvaStatusView {
  precheck: AlvaPrecheck | null
  templates: {
    id: string
    name: string
    stageId: string | null
    mode: 'on_enter' | 'manual' | null
  }[]
  /** Colunas que já têm algum fluxo ligado (ids das etapas): a tela não sugere trocar. */
  boundStages: string[]
  maxParallel: number
}
