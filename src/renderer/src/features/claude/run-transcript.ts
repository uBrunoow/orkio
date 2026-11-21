/**
 * Transcrição de uma execução do Claude Code (puro, sem React): transforma o log normalizado
 * (`RunLogEvent[]`) em itens de conversa. Ferramentas em sequência viram um grupo com uma frase
 * ("Rodou 6 comandos · Editou 2 arquivos"); pedidos pendentes ficam de fora (têm cartão próprio);
 * permissões negadas/bloqueadas e erros continuam visíveis na ordem em que aconteceram.
 */
import type { RunLogEvent } from '../../../../shared/agent-run'
import { plural } from '../../lib/format'

export type StepCategory = 'command' | 'edit' | 'read' | 'search' | 'subagent' | 'tool'
export type StepState = 'running' | 'ok' | 'failed'

export interface WorkStep {
  id: string
  tool: string
  summary: string
  category: StepCategory
  /** Arquivo editado (só ferramentas de edição). */
  file: string | null
  state: StepState
}

export type TranscriptItem =
  | { kind: 'started'; key: string; model: string | null }
  | { kind: 'message'; key: string; text: string }
  | { kind: 'work'; key: string; steps: WorkStep[]; approvals: number; live: boolean }
  | { kind: 'receipt'; key: string; tone: 'info' | 'problem'; text: string; count: number }
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

export function categoryOf(tool: string): StepCategory {
  switch (tool) {
    case 'Bash':
      return 'command'
    case 'Edit':
    case 'MultiEdit':
    case 'Write':
    case 'NotebookEdit':
      return 'edit'
    case 'Read':
      return 'read'
    case 'Grep':
    case 'Glob':
    case 'WebFetch':
    case 'WebSearch':
      return 'search'
    case 'Task':
    case 'Agent':
      return 'subagent'
    default:
      return 'tool'
  }
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
export function buildTranscript(events: readonly RunLogEvent[], live: boolean): TranscriptItem[] {
  const items: TranscriptItem[] = []
  const byId = new Map<string, WorkStep>()
  let group: Extract<TranscriptItem, { kind: 'work' }> | null = null
  let lastMessage = ''
  let started = false

  const push = (item: TranscriptItem): void => {
    group = null
    items.push(item)
  }
  const receipt = (tone: 'info' | 'problem', text: string, key: string): void => {
    const last = items[items.length - 1]
    if (last?.kind === 'receipt' && last.text === text && last.tone === tone) {
      last.count += 1
      return
    }
    push({ kind: 'receipt', key, tone, text, count: 1 })
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
        push({ kind: 'message', key, text: e.text })
        break
      case 'tool': {
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
        const step = byId.get(e.id)
        if (step) step.state = e.error ? 'failed' : 'ok'
        break
      }
      case 'permission':
        if (e.state === 'allowed') {
          if (group) group.approvals += 1
        } else if (e.state === 'blocked') {
          receipt('problem', `Bloqueado: ${e.summary}${e.reason ? ` (${e.reason})` : ''}`, key)
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
  return items
}
