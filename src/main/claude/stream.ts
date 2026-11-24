/**
 * Leitura do `--output-format stream-json` do Claude Code (uma linha JSON por evento).
 * Função pura: linha → eventos do log do Orkio. Nada de conteúdo de arquivos `.env` passa adiante.
 */
import { isAbsolute, relative } from 'node:path'
import { isEditTool, type RunLogEvent } from '../../shared/agent-run'
import { contextWindowFor, inputTokensOf } from '../../shared/context-usage'
import { redactSecrets } from './redact'

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)

function short(text: string, max = 200): string {
  const one = text.replace(/\s+/g, ' ').trim()
  return one.length > max ? `${one.slice(0, max - 1)}…` : one
}

/** Caminho relativo ao worktree (para exibir); fora dele, o absoluto. */
export function displayPath(path: string, worktree: string): string {
  if (!isAbsolute(path)) return path
  const rel = relative(worktree, path)
  return rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel : path
}

/** Resumo curto de uma chamada de ferramenta (sem conteúdo de arquivos). */
export function summarizeTool(
  tool: string,
  input: unknown,
  worktree: string
): { summary: string; file?: string } {
  const i = isRecord(input) ? input : {}
  const path = str(i['file_path']) ?? str(i['notebook_path']) ?? str(i['path'])
  if (isEditTool(tool)) {
    const file = path ? displayPath(path, worktree) : '?'
    return { summary: file, file }
  }
  switch (tool) {
    case 'Bash':
      return { summary: short(redactSecrets(str(i['command']) ?? '')) }
    case 'Read':
      return { summary: path ? displayPath(path, worktree) : '?' }
    case 'Grep':
    case 'Glob':
      return { summary: short(str(i['pattern']) ?? '') }
    case 'WebFetch':
      return { summary: short(str(i['url']) ?? '') }
    case 'WebSearch':
      return { summary: short(str(i['query']) ?? '') }
    case 'Task':
    case 'Agent':
      return { summary: short(str(i['description']) ?? '') }
    case 'Skill':
      return { summary: short(str(i['skill']) ?? str(i['command']) ?? '') }
    default:
      return { summary: '' }
  }
}

/** Uma linha do stream → zero ou mais eventos do log. Linha inválida vira `info`. */
export function parseStreamLine(
  line: string,
  worktree: string,
  now: () => Date = () => new Date(),
  /** Modelo do `init` da execução (define a janela do contexto). */
  model: string | null = null
): RunLogEvent[] {
  const trimmed = line.trim()
  if (!trimmed) return []
  let msg: unknown
  try {
    msg = JSON.parse(trimmed)
  } catch {
    return [{ kind: 'info', text: short(redactSecrets(trimmed)) }]
  }
  if (!isRecord(msg)) return []
  const type = msg['type']

  if (type === 'system' && msg['subtype'] === 'init') {
    const plugins = Array.isArray(msg['plugins'])
      ? msg['plugins'].flatMap((p) =>
          isRecord(p) && typeof p['name'] === 'string' ? [p['name']] : []
        )
      : []
    const commands = Array.isArray(msg['slash_commands'])
      ? msg['slash_commands'].filter((c): c is string => typeof c === 'string')
      : []
    return [{ kind: 'init', model: str(msg['model']), plugins, commands }]
  }

  if (type === 'assistant' && isRecord(msg['message'])) {
    // Mensagens de subagentes também chegam; mostramos só as da conversa principal como texto.
    const parent = str(msg['parent_tool_use_id'])
    const main = msg['parent_tool_use_id'] === null || msg['parent_tool_use_id'] === undefined
    const content = msg['message']['content']
    if (!Array.isArray(content)) return []
    const events: RunLogEvent[] = []
    const inputTokens = main ? inputTokensOf(msg['message']['usage']) : null
    if (inputTokens !== null) {
      events.push({ kind: 'usage', inputTokens, contextWindow: contextWindowFor(model) })
    }
    for (const block of content) {
      if (!isRecord(block)) continue
      if (
        block['type'] === 'text' &&
        main &&
        typeof block['text'] === 'string' &&
        block['text'].trim()
      ) {
        events.push({ kind: 'text', text: redactSecrets(block['text']) })
      } else if (block['type'] === 'tool_use' && typeof block['id'] === 'string') {
        const tool = str(block['name']) ?? 'ferramenta'
        events.push({
          kind: 'tool',
          id: block['id'],
          tool,
          ...summarizeTool(tool, block['input'], worktree),
          ...(parent ? { parent } : {})
        })
        if (main && (tool === 'Task' || tool === 'Agent')) {
          const input = isRecord(block['input']) ? block['input'] : {}
          const type = str(input['subagent_type'])
          events.push({
            kind: 'subagent',
            id: block['id'],
            title: short(
              redactSecrets(str(input['description']) ?? str(input['prompt']) ?? ''),
              80
            ),
            agentType: type ? short(type, 60) : null,
            background: input['run_in_background'] === true,
            at: now().toISOString()
          })
        }
      }
    }
    return events
  }

  if (type === 'user' && isRecord(msg['message'])) {
    const content = msg['message']['content']
    if (!Array.isArray(content)) return []
    return content.flatMap((block): RunLogEvent[] =>
      isRecord(block) && block['type'] === 'tool_result' && typeof block['tool_use_id'] === 'string'
        ? [{ kind: 'tool_result', id: block['tool_use_id'], error: block['is_error'] === true }]
        : []
    )
  }

  if (type === 'result') {
    const num = (v: unknown): number | null =>
      typeof v === 'number' && Number.isFinite(v) ? v : null
    return [
      {
        kind: 'result',
        ok: msg['is_error'] !== true && msg['subtype'] === 'success',
        durationMs: num(msg['duration_ms']),
        costUsd: num(msg['total_cost_usd']),
        turns: num(msg['num_turns']),
        text: redactSecrets(str(msg['result']) ?? '')
      }
    ]
  }

  // Hooks do projeto (ex.: `make format` do alva-flow instalado por cópia) rodam no worktree:
  // só registramos que rodaram, nunca a saída. Formato do evento não confirmado: leitura tolerante.
  if (type === 'system' && typeof msg['subtype'] === 'string' && /hook/i.test(msg['subtype'])) {
    const name = str(msg['hook_event_name']) ?? str(msg['hook_name']) ?? str(msg['event']) ?? 'hook'
    return [{ kind: 'info', text: `Hook do projeto rodou: ${name.slice(0, 60)}` }]
  }
  if (type === 'system' && msg['subtype'] === 'api_retry') {
    return [{ kind: 'info', text: 'A API do Claude falhou; tentando de novo…' }]
  }
  return []
}
