/**
 * Execuções do Claude Code numa tarefa (Etapa 4A): tipos compartilhados main ↔ renderer.
 * O log é normalizado a partir do `stream-json` do CLI (ver main/claude/stream.ts).
 */
import type { BranchKind } from './slug'

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
      /** Comando de entrega (5C): a aprovação vale só nesta execução (sem "sempre"). */
      delivery?: boolean
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
  /** A execução guardou a sessão do Claude Code (dá para continuar a conversa). */
  hasSession: boolean
  /** Agente (8A) que rodou, ou `null`. */
  agentKey: string | null
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
  /** ID do Notion (ORK-142); `null` em bancos sem a propriedade de ID. */
  displayId: string | null
  title: string
  briefing: string
  /** Tipos de bloco do Notion não convertidos. */
  unsupported: string[]
  /** Branch existente da tarefa ou a que será criada (com o tipo padrão, `feat/`). */
  branch: string
  /** A branch ainda não existe: o formulário deixa escolher o tipo (feat/fix/hotfix). */
  branchIsNew: boolean
  /** Comandos vistos na última sessão do Claude Code (system/init). */
  commands: string[]
  /** Avisos do contexto do projeto (página ilegível, contexto cortado pelo limite). */
  contextWarnings: string[]
  /** Agente da tarefa (8A): "Rodar como <nome>"; `problem` = não pode rodar agora (e por quê). */
  agent: { name: string; problem: string | null } | null
}

export interface StartRunRequest {
  projectId: string
  taskId: string
  mode: RunMode
  command: string | null
  text: string
  briefing: string
  /** 8A: rodar com as instruções do agente da tarefa (padrão: sim, se houver agente). */
  asAgent?: boolean
  /** Tipo da branch nova, se ela ainda não existe (padrão `feat`). */
  branchKind?: BranchKind
}

/** Branches da tarefa (Detalhes > GitHub > "Vincular branch"). */
export interface TaskBranchesView {
  /** Ligadas à tarefa: criada pelo Orkio (`orkio`) ou vinculada à mão (`manual`). */
  linked: { branch: string; source: 'orkio' | 'manual' }[]
  /** Branches locais e remotas do projeto, para escolher (sem as já ligadas). */
  available: string[]
}

/** Mensagem do campo da sessão: continua a última sessão da tarefa (ou começa uma). */
export interface SendMessageRequest {
  projectId: string
  taskId: string
  /** Texto livre, ou `/comando argumentos`. */
  text: string
  /** Começa uma sessão nova (com o briefing do Notion) em vez de continuar a última. */
  fresh?: boolean
  /** 8A: rodar com as instruções do agente da tarefa (padrão: sim, se houver agente). */
  asAgent?: boolean
}

export type EditorId = 'cursor' | 'code'

export type UncommittedStatus = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked'

/** Arquivo do ambiente da tarefa que ainda não está em nenhum commit. */
export interface UncommittedFile {
  path: string
  status: UncommittedStatus
}

/** Resultado de "Ver diff": o diff contra a base e o que ainda está fora de commit. */
export interface ClaudeDiff {
  diff: string
  /** O texto passou do limite e foi cortado. */
  truncated: boolean
  /** Arquivos novos fora do git (não entram no `git diff`). */
  untracked: string[]
  /** Tudo que ainda não foi commitado (modificado, novo, removido, renomeado). */
  uncommitted: UncommittedFile[]
  /** Arquivos com linha adicionada que parece segredo (o valor já vem escondido em `diff`). */
  secrets: string[]
}

/**
 * Uma linha do `git status --porcelain` (v1: "XY caminho") → arquivo e estado. Caminhos entre
 * aspas perdem as aspas; renomeado fica com o nome novo.
 */
export function parsePorcelainLine(line: string): UncommittedFile | null {
  if (line.length < 4) return null
  const xy = line.slice(0, 2)
  let path = line.slice(3)
  const arrow = path.indexOf(' -> ')
  if (arrow >= 0) path = path.slice(arrow + 4)
  if (path.length >= 2 && path.startsWith('"') && path.endsWith('"')) {
    path = path.slice(1, -1).replace(/\\(["\\])/g, '$1')
  }
  if (!path) return null
  const status: UncommittedStatus =
    xy === '??'
      ? 'untracked'
      : xy.includes('R')
        ? 'renamed'
        : xy.includes('D')
          ? 'deleted'
          : xy.includes('A')
            ? 'added'
            : 'modified'
  return { path, status }
}

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
