/**
 * Rótulo + tom de cada estado que a tela mostra, um mapa por dado: conexão, bancos do Notion,
 * cores de opção do Notion, Claude Code, saúde do projeto, agente, execuções, CI/PR/revisão e
 * atualização. As telas leem daqui (nada de cor intermediária: os mapas falam só `StatusTone`).
 */
import type { StatusTone } from '../components/StatusToken'
import type { ClaudeCodeStatus, RunStatus } from '../../../shared/agent-run'
import type { AgentStatus } from '../../../shared/agent'
import type { ConnectedAccount, ConnectionStatus } from '../../../shared/connection'
import type { NotionColor, NotionWorkspaceStatus } from '../../../shared/notion'
import type { ProjectHealthState } from '../../../shared/projects'
import type { FlowRunStatus } from '../../../shared/task-flow'
import type {
  ChecksState,
  PullRequestState,
  ReviewDecision,
  TaskPullRequest
} from '../../../shared/task-signals'
import type { UpdateStatus } from '../../../shared/updates'
import type { AlvaCheckItem } from '../../../shared/alva'

export interface StatusText {
  label: string
  tone: StatusTone
}

const CHECKING: StatusText = { label: 'Verificando', tone: 'neutral' }

/** Onde a conta está (workspace do Notion; no GitHub, o login). */
export function accountName(account: ConnectedAccount): string {
  return account.handle ?? account.workspaceName ?? account.userName
}

/** Quem conectou (login do GitHub; no Notion, a pessoa, não o workspace). */
function personName(account: ConnectedAccount): string {
  return account.handle ?? account.userName
}

export function connectionStatusText(s: ConnectionStatus | null): StatusText {
  if (!s) return CHECKING
  switch (s.state) {
    case 'connected':
      return s.warning
        ? { label: 'Conectado, sem verificação', tone: 'warning' }
        : { label: `Conectado como ${personName(s.account)}`, tone: 'success' }
    case 'connecting':
      return { label: 'Conectando…', tone: 'neutral' }
    case 'error':
      return { label: 'Precisa reconectar', tone: 'danger' }
    case 'disconnected':
      return { label: 'Não conectado', tone: 'warning' }
  }
}

/**
 * Cor de uma opção do Notion → tom do app. Explícito por cor: o tema não tem marrom, azul, roxo
 * nem rosa (viram neutro), e `running` nunca aparece (é o tom de agente rodando, com halo).
 */
export const NOTION_COLOR_TONE: Record<NotionColor, StatusTone> = {
  default: 'neutral',
  gray: 'neutral',
  brown: 'neutral',
  orange: 'warning',
  yellow: 'warning',
  green: 'success',
  blue: 'neutral',
  purple: 'neutral',
  pink: 'neutral',
  red: 'danger'
}

export const WORKSPACE_HEALTH: Record<NotionWorkspaceStatus['health'], StatusText> = {
  checking: { label: 'Verificando…', tone: 'neutral' },
  ok: { label: 'Pronto', tone: 'success' },
  warning: { label: 'Revisar mapeamento', tone: 'warning' },
  broken: { label: 'Tarefas bloqueadas', tone: 'danger' },
  unverified: { label: 'Não verificado', tone: 'warning' }
}

export function isWorkspaceReady(s: NotionWorkspaceStatus | null): boolean {
  return !!s?.config && s.health === 'ok'
}

export function workspaceStatusText(
  s: NotionWorkspaceStatus | null,
  notion: ConnectionStatus | null
): StatusText {
  if (notion?.state !== 'connected') return { label: 'Conecte o Notion antes', tone: 'neutral' }
  if (!s) return CHECKING
  if (!s.config) return { label: 'Falta escolher os bancos', tone: 'warning' }
  return WORKSPACE_HEALTH[s.health]
}

/** Instalado, na versão mínima e com login (login não verificado conta como pronto). */
export function isClaudeReady(c: ClaudeCodeStatus | null): boolean {
  return !!c && c.installed && c.meetsMinimum && c.loggedIn !== false
}

export function claudeStatusText(c: ClaudeCodeStatus | null): StatusText {
  if (!c) return CHECKING
  if (!c.installed) return { label: 'Não encontrado', tone: 'warning' }
  if (!c.meetsMinimum) return { label: `Atualize para ${c.minimumVersion}`, tone: 'warning' }
  if (c.loggedIn === false) return { label: 'Sem login', tone: 'warning' }
  return { label: c.version ? `Pronto, ${c.version}` : 'Pronto', tone: 'success' }
}

export function claudeLoginText(c: ClaudeCodeStatus): StatusText {
  if (c.loggedIn === true) {
    return {
      label: c.authMethod === 'claude.ai' ? 'Logado (assinatura)' : 'Logado',
      tone: 'success'
    }
  }
  return c.loggedIn === false
    ? { label: 'Não logado', tone: 'danger' }
    : { label: 'Login não verificado', tone: 'neutral' }
}

export const PROJECT_HEALTH: Record<ProjectHealthState, StatusText> = {
  checking: { label: 'Verificando…', tone: 'neutral' },
  ok: { label: 'OK', tone: 'success' },
  missing_folder: { label: 'Pasta não encontrada', tone: 'danger' },
  not_a_repo: { label: 'Não é repositório', tone: 'danger' },
  repo_mismatch: { label: 'Outro repositório', tone: 'danger' },
  no_access: { label: 'Sem acesso', tone: 'danger' },
  github_disconnected: { label: 'GitHub desconectado', tone: 'warning' },
  unverified: { label: 'Não verificado', tone: 'warning' },
  git_error: { label: 'Erro do git', tone: 'danger' }
}

export const AGENT_STATUS: Record<AgentStatus, StatusText> = {
  ready: { label: 'Pronto', tone: 'success' },
  needs_review: { label: 'Revisar perfil', tone: 'warning' },
  invalid: { label: 'Perfil inválido', tone: 'danger' },
  archived: { label: 'Arquivado', tone: 'neutral' }
}

export const RUN_STATUS: Record<RunStatus, StatusText> = {
  queued: { label: 'Na fila', tone: 'warning' },
  running: { label: 'Rodando', tone: 'running' },
  succeeded: { label: 'Concluída', tone: 'success' },
  failed: { label: 'Falhou', tone: 'danger' },
  cancelled: { label: 'Cancelada', tone: 'neutral' }
}

export const FLOW_RUN_STATUS: Record<FlowRunStatus, StatusText> = {
  running: { label: 'Rodando', tone: 'running' },
  waiting_gate: { label: 'Esperando aprovação', tone: 'warning' },
  paused: { label: 'Pausado', tone: 'danger' },
  awaiting_decision: { label: 'Esperando sua decisão', tone: 'warning' },
  finished: { label: 'Concluído', tone: 'success' },
  cancelled: { label: 'Cancelado', tone: 'neutral' }
}

/** Item da pré-checagem do alva-flow (falta configurar é aviso: o resto do Orkio funciona). */
export const ALVA_CHECK: Record<AlvaCheckItem['state'], StatusText> = {
  ok: { label: 'OK', tone: 'success' },
  missing: { label: 'Falta', tone: 'warning' },
  warning: { label: 'Atenção', tone: 'warning' }
}

export const PR_STATE: Record<PullRequestState, StatusText> = {
  draft: { label: 'Rascunho', tone: 'neutral' },
  open: { label: 'Aberta', tone: 'success' },
  merged: { label: 'Mergeada', tone: 'success' },
  closed: { label: 'Fechada', tone: 'danger' }
}

export const REVIEW_DECISION: Record<ReviewDecision, StatusText> = {
  approved: { label: 'Aprovada', tone: 'success' },
  changes_requested: { label: 'Alterações pedidas', tone: 'danger' },
  review_required: { label: 'Revisão pendente', tone: 'warning' }
}

export const CI_STATUS: Record<ChecksState, StatusText> = {
  success: { label: 'CI ok', tone: 'success' },
  failure: { label: 'CI falhou', tone: 'danger' },
  pending: { label: 'CI rodando', tone: 'neutral' }
}

export function isPrOpen(pr: Pick<TaskPullRequest, 'state'> | null | undefined): boolean {
  return pr?.state === 'open' || pr?.state === 'draft'
}

/** Pronta para instalar: baixada (automática) ou disponível para baixar (macOS sem assinatura). */
export function isUpdateReady(s: UpdateStatus | null): boolean {
  return (
    !!s?.version &&
    ((s.mode === 'auto' && s.phase === 'downloaded') ||
      (s.mode === 'manual' && s.phase === 'available'))
  )
}

/** Token de Configurações › Atualizações (`null` = nada a destacar). */
export function updatePhaseText(s: UpdateStatus): StatusText | null {
  if (s.mode === 'disabled') return { label: 'Desligadas', tone: 'neutral' }
  if (isUpdateReady(s)) return { label: 'Nova versão', tone: 'warning' }
  if (s.phase === 'downloading' || s.phase === 'available') {
    return { label: 'Baixando', tone: 'neutral' }
  }
  return null
}
