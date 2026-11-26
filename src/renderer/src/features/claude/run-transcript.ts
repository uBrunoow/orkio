/**
 * Transcrição de uma execução do Claude Code (puro, sem React): transforma o log normalizado
 * (`RunLogEvent[]`) em itens de conversa. Ferramentas em sequência viram um grupo com uma frase
 * ("Rodou 6 comandos · Editou 2 arquivos"); pedidos pendentes ficam de fora (têm cartão próprio);
 * permissões negadas/bloqueadas e erros continuam visíveis na ordem em que aconteceram.
 */
import type { PermissionBlockCode, RunLogEvent, RunStatus } from '../../../../shared/agent-run'
import { toolCategory, type ToolCategory } from '../../../../shared/claude-tools'
import { plural } from '../../lib/format'

export type StepCategory = 'command' | 'edit' | 'read' | 'search' | 'subagent' | 'tool'
export type StepState = 'running' | 'ok' | 'failed'

export interface WorkStep {
  id: string
  tool: string
  summary: string
  category: StepCategory
  file: string | null
  state: StepState
}

export type SubagentState = 'running' | 'done' | 'failed' | 'background' | 'interrupted'

export interface SubagentRow {
  id: string
  title: string
  type: string | null
  /** Ferramentas que o subagente chamou (eventos com `parent`). */
  tools: number
  /** As chamadas dele, em ordem (o que está fazendo), com o estado de cada uma. */
  steps: WorkStep[]
  state: SubagentState
  at: string
}

/** Bloqueio de push ou de `gh` que publica fora do modo entrega: o recibo oferece "Abrir PR". */
const PUBLISH_BLOCK: ReadonlySet<PermissionBlockCode> = new Set(['push', 'gh'])

export type TranscriptItem =
  | { kind: 'started'; key: string; model: string | null }
  /** Texto do agente (inteiro); `uuid` = ponto da conversa para "Ramificar daqui". */
  | { kind: 'message'; key: string; text: string; uuid?: string }
  | { kind: 'work'; key: string; steps: WorkStep[]; approvals: number; live: boolean }
  | { kind: 'subagents'; key: string; agents: SubagentRow[] }
  | {
      kind: 'receipt'
      key: string
      tone: 'info' | 'problem'
      text: string
      count: number
      /** Ação que o recibo oferece (hoje só "Abrir PR", num push/gh bloqueado). */
      action?: 'open-pr'
    }
  | { kind: 'notice'; key: string; tone: 'danger' | 'neutral'; text: string }
  | {
      kind: 'result'
      key: string
      ok: boolean
      /** Texto final, só quando não repete a última mensagem (ou quando a execução falhou). */
      text: string
      turns: number | null
      durationMs: number | null
      costUsd: number | null
    }

const STEP_CATEGORY: Record<ToolCategory, StepCategory> = {
  edit: 'edit',
  read: 'read',
  search: 'search',
  web: 'search',
  command: 'command',
  subagent: 'subagent',
  plan: 'tool',
  question: 'tool'
}

export function categoryOf(tool: string): StepCategory {
  const c = toolCategory(tool)
  return c ? STEP_CATEGORY[c] : 'tool'
}

const VERB: Record<string, string> = {
  Bash: 'Rodou',
  Edit: 'Editou',
  MultiEdit: 'Editou',
  NotebookEdit: 'Editou',
  Write: 'Escreveu',
  Read: 'Leu',
  Grep: 'Buscou',
  Glob: 'Buscou',
  WebFetch: 'Abriu',
  WebSearch: 'Pesquisou',
  Task: 'Delegou',
  Agent: 'Delegou',
  Skill: 'Usou a skill'
}

/** Verbo da linha de uma ferramenta ("Rodou", "Leu"...); ferramenta desconhecida mostra o nome. */
export function verbOf(tool: string): string {
  return VERB[tool] ?? tool
}

const CATEGORY_ORDER: readonly StepCategory[] = [
  'command',
  'edit',
  'read',
  'search',
  'subagent',
  'tool'
]

export interface WorkSummary {
  /** "Rodou 6 comandos · Editou 2 arquivos". */
  label: string
  failed: number
}

/**
 * Frase do grupo: ordem fixa; edições e leituras contam arquivos distintos (editar o mesmo
 * arquivo duas vezes é um arquivo).
 */
export function summarizeSteps(steps: readonly WorkStep[]): WorkSummary {
  const units = new Map<StepCategory, Set<string>>()
  const counts = new Map<StepCategory, number>()
  for (const [i, s] of steps.entries()) {
    counts.set(s.category, (counts.get(s.category) ?? 0) + 1)
    if (s.category === 'edit' || s.category === 'read') {
      const set = units.get(s.category) ?? new Set<string>()
      set.add(s.file ?? (s.summary || `#${i}`))
      units.set(s.category, set)
    }
  }
  const parts: string[] = []
  for (const category of CATEGORY_ORDER) {
    const n = units.get(category)?.size ?? counts.get(category) ?? 0
    if (n === 0) continue
    switch (category) {
      case 'command':
        parts.push(`Rodou ${plural(n, 'comando', 'comandos')}`)
        break
      case 'edit':
        parts.push(`Editou ${plural(n, 'arquivo', 'arquivos')}`)
        break
      case 'read':
        parts.push(`Leu ${plural(n, 'arquivo', 'arquivos')}`)
        break
      case 'search':
        parts.push(n === 1 ? 'Buscou 1 vez' : `Buscou ${n} vezes`)
        break
      case 'subagent':
        parts.push(`Delegou a ${plural(n, 'subagente', 'subagentes')}`)
        break
      case 'tool':
        parts.push(`Usou ${plural(n, 'ferramenta', 'ferramentas')}`)
        break
    }
  }
  return { label: parts.join(' · '), failed: steps.filter((s) => s.state === 'failed').length }
}

/** "1 falhou" / "2 falharam". */
export function failedLabel(n: number): string {
  return n === 1 ? '1 falhou' : `${n} falharam`
}

const norm = (text: string): string => text.replace(/\s+/g, ' ').trim()

/**
 * `live`: a execução ainda roda. Fora dela, uma ferramenta sem resultado conta como concluída
 * (o log pode ter perdido o `tool_result`).
 */
export function buildTranscript(
  events: readonly RunLogEvent[],
  live: boolean,
  finalStatus?: RunStatus
): TranscriptItem[] {
  const items: TranscriptItem[] = []
  const byId = new Map<string, WorkStep>()
  let group: Extract<TranscriptItem, { kind: 'work' }> | null = null
  let subs: Extract<TranscriptItem, { kind: 'subagents' }> | null = null
  const agentById = new Map<string, SubagentRow>()
  // `Task`/`Agent` com evento `subagent` aparecem no cartão dos subagentes, não no grupo de trabalho.
  const spawned = new Set<string>()
  for (const e of events) if (e.kind === 'subagent') spawned.add(e.id)
  let lastMessage = ''
  let started = false

  const push = (item: TranscriptItem): void => {
    group = null
    subs = null
    items.push(item)
  }
  const receipt = (
    tone: 'info' | 'problem',
    text: string,
    key: string,
    action?: 'open-pr'
  ): void => {
    const last = items[items.length - 1]
    if (last?.kind === 'receipt' && last.text === text && last.tone === tone) {
      last.count += 1
      return
    }
    push({ kind: 'receipt', key, tone, text, count: 1, ...(action ? { action } : {}) })
  }

  for (const [i, e] of events.entries()) {
    const key = `e${i}`
    switch (e.kind) {
      case 'init':
        if (!started) {
          started = true
          push({ kind: 'started', key, model: e.model })
        }
        break
      case 'text':
        lastMessage = norm(e.text)
        push({ kind: 'message', key, text: e.text, ...(e.uuid ? { uuid: e.uuid } : {}) })
        break
      case 'subagent': {
        const row: SubagentRow = {
          id: e.id,
          title: e.title || 'Subagente',
          type: e.agentType,
          tools: 0,
          steps: [],
          state: e.background ? 'background' : 'running',
          at: e.at
        }
        agentById.set(e.id, row)
        if (!subs) {
          const item: Extract<TranscriptItem, { kind: 'subagents' }> = {
            kind: 'subagents',
            key,
            agents: []
          }
          push(item)
          subs = item
        }
        subs.agents.push(row)
        break
      }
      case 'tool': {
        if (e.parent) {
          const owner = agentById.get(e.parent)
          if (owner) {
            const step: WorkStep = {
              id: e.id,
              tool: e.tool,
              summary: e.summary,
              category: categoryOf(e.tool),
              file: e.file ?? null,
              state: 'running'
            }
            byId.set(e.id, step)
            owner.steps.push(step)
            owner.tools += 1
          }
          break
        }
        if (spawned.has(e.id)) break
        const step: WorkStep = {
          id: e.id,
          tool: e.tool,
          summary: e.summary,
          category: categoryOf(e.tool),
          file: e.file ?? null,
          state: 'running'
        }
        byId.set(e.id, step)
        if (!group) {
          group = { kind: 'work', key, steps: [], approvals: 0, live: false }
          items.push(group)
        }
        group.steps.push(step)
        break
      }
      case 'tool_result': {
        const agent = agentById.get(e.id)
        if (agent) {
          if (e.error) agent.state = 'failed'
          else if (agent.state === 'running') agent.state = 'done'
          // Terminou: o que ficou sem resposta não está mais rodando.
          for (const st of agent.steps) if (st.state === 'running') st.state = 'ok'
          break
        }
        const step = byId.get(e.id)
        if (step) step.state = e.error ? 'failed' : 'ok'
        break
      }
      case 'permission':
        if (e.state === 'allowed') {
          if (group) group.approvals += 1
        } else if (e.state === 'blocked') {
          receipt(
            'problem',
            `Bloqueado: ${e.summary}${e.reason ? ` (${e.reason})` : ''}`,
            key,
            e.code && PUBLISH_BLOCK.has(e.code) ? 'open-pr' : undefined
          )
        } else if (e.state === 'denied') {
          receipt('problem', `Negado: ${e.summary}`, key)
        }
        break
      case 'question':
        if (e.state === 'answered') receipt('info', 'Pergunta respondida', key)
        else if (e.state === 'cancelled') receipt('info', 'Pergunta cancelada', key)
        break
      case 'status':
        if (e.status === 'failed') {
          push({ kind: 'notice', key, tone: 'danger', text: e.message || 'A execução falhou.' })
        } else if (e.status === 'cancelled') {
          push({ kind: 'notice', key, tone: 'neutral', text: e.message || 'Execução cancelada.' })
        }
        break
      case 'info':
        receipt('info', e.text, key)
        break
      case 'result': {
        // O texto final costuma repetir a última mensagem: só aparece se for diferente ou se deu erro.
        const text = e.text.trim()
        const repeats = text !== '' && norm(text) === lastMessage
        push({
          kind: 'result',
          key,
          ok: e.ok,
          text: !e.ok || !repeats ? text : '',
          turns: e.turns,
          durationMs: e.durationMs,
          costUsd: e.costUsd
        })
        break
      }
    }
  }

  const tail = items[items.length - 1]
  for (const item of items) {
    if (item.kind !== 'work') continue
    if (!live) for (const s of item.steps) if (s.state === 'running') s.state = 'ok'
    item.live = live && item === tail && item.steps.some((s) => s.state === 'running')
  }
  if (!live) {
    const stopped = finalStatus === 'cancelled' || finalStatus === 'failed'
    for (const row of agentById.values()) {
      if (row.state === 'running') row.state = stopped ? 'interrupted' : 'done'
      for (const st of row.steps) if (st.state === 'running') st.state = 'ok'
    }
  }
  return items
}

export function runningSubagents(items: readonly TranscriptItem[]): SubagentRow[] {
  return items
    .flatMap((i) => (i.kind === 'subagents' ? i.agents : []))
    .filter((a) => a.state === 'running')
}

/** "Esperando 2 subagentes: Revisar API, Escrever testes" (vazio quando nenhum roda). */
export function waitingSubagentsLabel(running: readonly SubagentRow[]): string | null {
  if (running.length === 0) return null
  return `Esperando ${plural(running.length, 'subagente', 'subagentes')}: ${running
    .map((a) => a.title)
    .join(', ')}`
}
