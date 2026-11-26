/**
 * Execuções do Claude Code numa tarefa (Etapa 4A): tipos compartilhados main ↔ renderer.
 * O log é normalizado a partir do `stream-json` do CLI (ver main/claude/stream.ts).
 */
import type { HandoffView } from './handoff'
import type { BranchKind } from './slug'
import type { RuntimeChoice } from './agent-runtime'
import { isScratchPath } from './orkio-scratch'

/** Nome de comando do Claude Code (`review`, `alva-flow:pr`), sem a barra: catálogo, execução e perfis. */
const COMMAND_NAME = /^[A-Za-z0-9][\w:.-]{0,80}$/

export function isCommandName(value: unknown): value is string {
  return typeof value === 'string' && COMMAND_NAME.test(value)
}

/** Versão mínima testada com as flags usadas (stream-json in/out, --permission-prompt-tool, --settings). */
export const CLAUDE_MIN_VERSION = '2.1.0'

/**
 * Teto de um texto que vai para a sessão da tarefa (mensagem do campo, resposta ao Claude, pedido
 * de ajuste do gate, respostas a perguntas): todos seguem no mesmo `--resume`. Regras mais
 * estreitas (ex.: `MAX_PROMPT_CHARS` do ajuste) ficam no serviço, com a mensagem delas.
 */
export const MESSAGE_MAX = 200_000
/** Teto do briefing editável antes de rodar. */
export const BRIEFING_MAX = 200_000

/**
 * Por que a política do Orkio bloqueou um pedido (no evento `permission`): `push`/`gh` = publicar
 * fora do modo entrega (a tela oferece "Abrir PR"); `delivery` = regra do modo entrega.
 */
export type PermissionBlockCode =
  | 'outside'
  | 'push'
  | 'gh'
  | 'alias'
  | 'delivery'
  | 'read_only'
  /** Fase 5: esperar no shell (`gh pr checks --watch`, `sleep` longo, `tail -f`). */
  | 'wait'

export type RunMode = 'prompt' | 'command'
export type RunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'

/** Status de uma execução que ainda não terminou (fonte do TS e do SQL do `RunService`). */
export const ACTIVE_RUN_STATUSES = ['queued', 'running'] as const satisfies readonly RunStatus[]

/** A execução ainda não terminou (na fila ou rodando)? */
export function isRunLive(status: RunStatus): boolean {
  return (ACTIVE_RUN_STATUSES as readonly RunStatus[]).includes(status)
}

export type RunLogEvent =
  | { kind: 'status'; status: RunStatus; message?: string }
  | { kind: 'init'; model: string | null; plugins: string[]; commands: string[] }
  | {
      kind: 'text'
      text: string
      /** Id da mensagem do Claude na sessão (Fase 2: "Ramificar daqui"/"Editar mensagem"). */
      uuid?: string
    }
  /** Uso do contexto na mensagem principal (só números; ver `shared/context-usage.ts`). */
  | { kind: 'usage'; inputTokens: number; contextWindow: number }
  | {
      kind: 'tool'
      id: string
      tool: string
      summary: string
      file?: string
      /** Id do `Task`/`Agent` que lançou esta chamada (ferramenta de um subagente). */
      parent?: string
    }
  | {
      kind: 'subagent'
      id: string
      title: string
      agentType: string | null
      background: boolean
      at: string
    }
  | { kind: 'tool_result'; id: string; error: boolean }
  /** Imagem de uma ferramenta, gravada em `<runs>/<runId>/images/<n>.<ext>` (nunca o conteúdo). */
  | { kind: 'image'; toolId: string; runId: string; n: number; mime: string }
  | {
      kind: 'permission'
      requestId: string
      tool: string
      summary: string
      state: 'pending' | 'allowed' | 'denied' | 'blocked'
      reason?: string
      /** Bloqueio (`state: 'blocked'`) pela política: o motivo em código. */
      code?: PermissionBlockCode
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
      /** Janela de contexto real do modelo, informada pelo CLI (`modelUsage`); logs antigos sem. */
      contextWindow?: number
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
  /** Sessão do Claude Code desta execução (várias execuções continuam a mesma sessão). */
  sessionId: string | null
  /** Sessão de onde esta saiu ("Ramificar daqui"/"Editar mensagem"), só na primeira execução dela. */
  forkedFrom: string | null
  /** É de um sidechat (conversa ao lado, só de leitura; nunca a sessão da tarefa). */
  side: boolean
}

/** Evento main → renderer (`onRunEvent`). */
export interface RunEventMessage {
  runId: string
  projectId: string
  taskId: string
  event: RunLogEvent
  /** É de um sidechat (a conversa principal não segue esta execução). */
  side?: boolean
}

export const PERMISSION_ANSWERS = ['allow_once', 'allow_always', 'deny'] as const
export type PermissionAnswer = (typeof PERMISSION_ANSWERS)[number]

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
  /** O CLI aceita `--effort` (versão ≥ `CLAUDE_EFFORT_VERSION`). */
  supportsEffort: boolean
}

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
  /** Fase 2: a sessão da tarefa está com você no terminal ("Continuar no Claude"). */
  handoff?: HandoffView | null
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
  /**
   * Agente da tarefa (8A): "Rodar como <nome>"; `problem` = não pode rodar agora (e por quê);
   * `command` = comando preferido dele (Fase 3: o formulário já vem no modo comando com ele).
   */
  agent: { name: string; problem: string | null; command?: string | null } | null
  /** A página da tarefa no Notion foi lida e está vazia (fluxos não rodam assim). */
  descriptionEmpty: boolean
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
  /** Continua esta sessão da tarefa (lista "Sessões") em vez da mais recente. */
  session?: string
  /**
   * Sidechat: conversa ao lado, só de leitura, sem interromper a sessão principal. Com `session`
   * (de um sidechat), continua ele; sem, abre um a partir do ponto atual da sessão principal.
   */
  side?: boolean
  /** 8A: rodar com as instruções do agente da tarefa (padrão: sim, se houver agente). */
  asAgent?: boolean
  /** Modelo e/ou raciocínio só desta mensagem (vence o passo e o agente). */
  runtime?: Partial<RuntimeChoice>
  /** Arquivos anexados (imagem, PDF, md, txt): o main valida pelo conteúdo e grava no worktree. */
  attachments?: { name: string; mime: string; data: Uint8Array }[]
  /**
   * Fase 2: a mensagem sai de outro ponto da conversa, numa sessão nova (`--fork-session`).
   * `at` = id de uma resposta do Claude nesta execução ("Ramificar daqui"); `null` = logo antes do
   * pedido desta execução ("Editar mensagem").
   */
  fork?: SessionFork
}

export interface SessionFork {
  runId: string
  at: string | null
}

export const EDITOR_IDS = ['cursor', 'code'] as const
export type EditorId = (typeof EDITOR_IDS)[number]

export type UncommittedStatus = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked'

/** Arquivo do ambiente da tarefa que ainda não está em nenhum commit. */
export interface UncommittedFile {
  path: string
  status: UncommittedStatus
}

/** Resultado de "Ver diff": o diff contra a base e o que ainda está fora de commit. */
export interface ClaudeDiff {
  diff: string
  truncated: boolean
  /** Arquivos novos fora do git (não entram no `git diff`). */
  untracked: string[]
  /** Tudo que ainda não foi commitado (modificado, novo, removido, renomeado). */
  uncommitted: UncommittedFile[]
  /** Arquivos com linha adicionada que parece segredo (o valor já vem escondido em `diff`). */
  secrets: string[]
  /** Linhas adicionadas/removidas contra a base (tudo que o git diff vê); `null` = não deu para ler. */
  shortstat: { added: number; removed: number } | null
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
  if (isScratchPath(path)) return false
  return /\.(md|mdx|markdown|txt|adoc|rst)$/i.test(path)
}

export const ARTIFACT_PUBLISH_MODES = ['section', 'child_page'] as const
export type ArtifactPublishMode = (typeof ARTIFACT_PUBLISH_MODES)[number]

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

export const CLAUDE_CODE_DOCS_URL = 'https://code.claude.com/docs/en/setup'

/** Imagens das ferramentas por execução: tamanho de cada uma (decodificada) e quantidade. */
export const IMAGE_LIMITS = { maxBytes: 5 * 1024 * 1024, perRun: 20 } as const
