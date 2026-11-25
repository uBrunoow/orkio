/**
 * Terminal embutido (Fase 2): tipos, limites e validadores do terminal da tarefa. O processo (PTY)
 * vive no main (`main/terminal/terminal.service.ts`); o renderer só manda teclas e tamanho para um
 * terminal pelo id e recebe a saída por evento. O main escolhe a pasta (worktree da tarefa) e o
 * programa (shell do usuário ou `claude --resume <sessão>`): nada disso vem do renderer.
 */
import { isRecord } from './guards'

/** `shell`: terminal comum na pasta da tarefa; `claude`: a sessão da tarefa no Claude Code. */
/**
 * "Tarefa" dos terminais na pasta do projeto (tela Terminais), que não são de uma tarefa: um id no
 * formato de página do Notion que nunca existe, para passar pelas mesmas validações e eventos.
 */
export const PROJECT_TERMINAL_TASK = '00000000-0000-0000-0000-000000000000'

export const TERMINAL_KINDS = ['shell', 'claude'] as const
export type TerminalKind = (typeof TERMINAL_KINDS)[number]

export interface TerminalView {
  id: string
  projectId: string
  taskId: string
  kind: TerminalKind
  /** Nome curto da aba ("zsh", "Claude"). */
  title: string
  state: 'running' | 'exited'
  exitCode: number | null
  startedAt: string
}

/** Lista dos terminais de uma tarefa e se o terminal embutido existe neste computador. */
export interface TaskTerminals {
  /** `false` = o módulo nativo do terminal não carregou: só o terminal do sistema. */
  available: boolean
  terminals: TerminalView[]
}

/** Saída de um terminal (main → renderer), em lotes. */
export interface TerminalDataEvent {
  id: string
  data: string
  /** Posição do lote na saída inteira (caracteres antes dele): casa com `TerminalSnapshot.end`. */
  at: number
}

/** O que já saiu (o fim, até o limite) e onde termina: lotes com `at` antes disso já estão aqui. */
export interface TerminalSnapshot {
  data: string
  end: number
}

/** Lote → só o que ainda não estava na foto (`null` = nada novo). */
export function unseenPart(event: TerminalDataEvent, end: number): string | null {
  const stop = event.at + event.data.length
  if (stop <= end) return null
  return event.at >= end ? event.data : event.data.slice(end - event.at)
}

/** Um terminal mudou (abriu, saiu, fechou): o renderer relê a lista da tarefa. */
export interface TerminalChangedEvent {
  projectId: string
  taskId: string
}

export const TERMINAL_LIMITS = {
  /** Terminais abertos ao mesmo tempo (todas as tarefas). */
  maxOpen: 8,
  /** Teclas/colar numa chamada. */
  maxInput: 64 * 1024,
  /** Saída guardada no main para redesenhar ao voltar à aba (caracteres). */
  scrollback: 256 * 1024,
  minCols: 2,
  maxCols: 500,
  minRows: 1,
  maxRows: 300
} as const

const TERMINAL_ID = /^t-[a-z0-9]{6,40}$/

export function isTerminalId(v: unknown): v is string {
  return typeof v === 'string' && TERMINAL_ID.test(v)
}

export function isTerminalKind(v: unknown): v is TerminalKind {
  return TERMINAL_KINDS.some((k) => k === v)
}

/** Tamanho pedido pelo renderer (inteiros dentro dos limites) ou `null`. */
export function parseTerminalSize(v: unknown): { cols: number; rows: number } | null {
  if (!isRecord(v)) return null
  const { cols, rows } = v
  const ok = (n: unknown, min: number, max: number): n is number =>
    typeof n === 'number' && Number.isInteger(n) && n >= min && n <= max
  if (!ok(cols, TERMINAL_LIMITS.minCols, TERMINAL_LIMITS.maxCols)) return null
  if (!ok(rows, TERMINAL_LIMITS.minRows, TERMINAL_LIMITS.maxRows)) return null
  return { cols, rows }
}

/**
 * Id de sessão do Claude Code: UUID. Vai como argumento do `claude --resume`, então só passa o
 * formato exato (nada que pareça outra flag).
 */
export function isSessionUuid(v: unknown): v is string {
  return (
    typeof v === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
  )
}

/** Mantém só o fim da saída (o começo de uma linha cortada pode ficar torto; é só histórico). */
export function trimScrollback(text: string, max: number = TERMINAL_LIMITS.scrollback): string {
  return text.length <= max ? text : text.slice(text.length - max)
}
