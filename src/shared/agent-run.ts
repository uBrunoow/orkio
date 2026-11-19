/**
 * Execuções do Claude Code numa tarefa (Etapa 4A): tipos compartilhados main ↔ renderer.
 * O log é normalizado a partir do `stream-json` do CLI (ver main/claude/stream.ts).
 */

export type RunMode = 'prompt' | 'command'
export type RunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'

export type RunLogEvent =
  | { kind: 'status'; status: RunStatus; message?: string }
  | { kind: 'init'; model: string | null; plugins: string[]; commands: string[] }
  | { kind: 'text'; text: string }
  | { kind: 'tool'; id: string; tool: string; summary: string; file?: string }
  | { kind: 'tool_result'; id: string; error: boolean }
  | {
      kind: 'permission'
      requestId: string
      tool: string
      summary: string
      state: 'pending' | 'allowed' | 'denied' | 'blocked'
      reason?: string
      /** Padrão sugerido para "sempre neste projeto" (ex.: "npm test"). */
      suggestion?: string
    }
  | {
      kind: 'question'
      requestId: string
      questions: { question: string; options: string[]; multiSelect: boolean }[]
      state: 'pending' | 'answered' | 'cancelled'
    }
  | {
      kind: 'result'
      ok: boolean
      durationMs: number | null
      costUsd: number | null
      turns: number | null
      text: string
    }
  | { kind: 'info'; text: string }

export interface RunSummary {
  files: string[]
  diffStat: string
  commits: { hash: string; subject: string }[]
  /** Comandos de teste vistos no log (ex.: "npm test"). */
  tests: string[]
}

export interface AgentRunView {
  id: string
  projectId: string
  taskId: string
  mode: RunMode
  command: string | null
  status: RunStatus
  startedAt: string
  endedAt: string | null
  costUsd: number | null
  /** Branch e pasta do worktree (exibição; o renderer nunca as envia de volta). */
  branch: string | null
  worktreePath: string | null
  summary: RunSummary | null
}

/** Evento main → renderer (`onRunEvent`). */
export interface RunEventMessage {
  runId: string
  projectId: string
  taskId: string
  event: RunLogEvent
}

export type PermissionAnswer = 'allow_once' | 'allow_always' | 'deny'
