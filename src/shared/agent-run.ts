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
  /** Prompt ou argumentos usados ("Rodar de novo"). O briefing não é guardado. */
  text: string | null
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

/** Card "Claude Code" em Integrações. Nunca contém e-mail, token ou credenciais. */
export interface ClaudeCodeStatus {
  installed: boolean
  version: string | null
  /** `null` = não deu para verificar. */
  loggedIn: boolean | null
  /** Só o tipo (ex.: "claude.ai" = assinatura). */
  authMethod: string | null
  meetsMinimum: boolean
  minimumVersion: string
}

/** Resultado das operações do Claude Code no renderer (erros já em pt-BR). */
export type ClaudeResult<T> =
  { ok: true; value: T } | { ok: false; error: { code: string; message: string; files?: string[] } }

/** Ambiente (worktree) da tarefa, para exibição. */
export interface TaskWorkspace {
  branch: string
  path: string
  /** Mudanças não commitadas (`null` = não deu para ler). */
  changes: number | null
}

/** Estado da tarefa para o painel: execuções e ambiente (local, sem rede). */
export interface TaskRunsState {
  runs: AgentRunView[]
  activeRunId: string | null
  workspace: TaskWorkspace | null
}

/** Antes de rodar: briefing montado do Notion (editável) e a branch que será usada. */
export interface RunPreparation extends TaskRunsState {
  taskId: string
  displayId: string
  title: string
  briefing: string
  /** Tipos de bloco do Notion não convertidos. */
  unsupported: string[]
  /** Branch existente da tarefa ou a que será criada. */
  branch: string
  /** Comandos vistos na última sessão do Claude Code (system/init). */
  commands: string[]
  /** Avisos do contexto do projeto (página ilegível, contexto cortado pelo limite). */
  contextWarnings: string[]
}

export interface StartRunRequest {
  projectId: string
  taskId: string
  mode: RunMode
  command: string | null
  text: string
  briefing: string
}

export type EditorId = 'cursor' | 'code'

/** Catálogo de comandos do Claude Code (4B): só nome e descrição. */
export interface CatalogCommand {
  /** Nome para `/nome` (plugins: `plugin:nome`). */
  name: string
  description: string
  kind: 'command' | 'skill'
}

export interface CatalogGroup {
  id: string
  title: string
  source: 'user' | 'project' | 'plugin'
  commands: CatalogCommand[]
}

/** Documento gerado/alterado que pode virar artefato da tarefa (4B). */
export function isDocFile(path: string): boolean {
  if (path.startsWith('.orkio/')) return false
  return /\.(md|mdx|markdown|txt|adoc|rst)$/i.test(path)
}

export type ArtifactPublishMode = 'section' | 'child_page'

/** Documento candidato a artefato (alterado desde a base). */
export interface ArtifactCandidate {
  path: string
  /** Sem mudanças pendentes: dá para anexar (o anexo aponta para um commit). */
  committed: boolean
}

/** Artefato anexado: só caminho + commit (o conteúdo fica no git). */
export interface ArtifactView {
  id: string
  path: string
  commit: string
  runId: string | null
  attachedAt: string
  notion: { mode: ArtifactPublishMode; pageId: string | null; publishedAt: string } | null
}

/** Contexto do projeto para o Claude Code (4B): vai no briefing de toda execução. */
export interface ProjectClaudeContext {
  /** Instruções fixas (convenções, comandos de teste, o que evitar...). */
  instructions: string
  /** Páginas de referência do Notion (só id e nome; o conteúdo é lido na hora). */
  notionPages: { id: string; name: string }[]
}

export const CONTEXT_LIMITS = {
  instructions: 8_000,
  pages: 5,
  /** Total de contexto (instruções + páginas) no briefing; acima disso corta com aviso. */
  total: 30_000
} as const
