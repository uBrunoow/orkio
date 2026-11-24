/**
 * Primeiros passos: os 7 passos e o estado de cada um, derivados do estado real (nada é guardado).
 * O primeiro não feito é o atual. O GitHub é obrigatório (o projeto é verificado no GitHub).
 */
import type { ClaudeCodeStatus } from '../../../../shared/agent-run'
import type { ConnectionStatus } from '../../../../shared/connection'
import type { NotionWorkspaceStatus } from '../../../../shared/notion'
import type { ProjectView } from '../../../../shared/projects'

export type SetupStepId =
  'github' | 'notion' | 'claude' | 'folder' | 'notion-data' | 'board' | 'first-task'

export type SetupStepState = 'done' | 'current' | 'todo'

export interface SetupStep {
  id: SetupStepId
  title: string
  summary: string | null
  state: SetupStepState
}

export interface SetupInput {
  github: ConnectionStatus | null
  notion: ConnectionStatus | null
  claude: ClaudeCodeStatus | null
  project: ProjectView | null
  workspace: NotionWorkspaceStatus | null
  boardConfigured: boolean
}

export const SETUP_TITLES: Record<SetupStepId, string> = {
  github: 'Entrar com GitHub',
  notion: 'Conectar o Notion',
  claude: 'Claude Code',
  folder: 'Escolher a pasta do projeto',
  'notion-data': 'Onde ficam suas tarefas no Notion',
  board: 'Montar o quadro',
  'first-task': 'Abrir a primeira tarefa'
}

/** Passos que contam para "Falta N passos": todos menos a primeira tarefa (que nunca fica feita). */
const REQUIRED: readonly SetupStepId[] = [
  'github',
  'notion',
  'claude',
  'folder',
  'notion-data',
  'board'
]

function account(s: ConnectionStatus | null): string | null {
  return s?.state === 'connected'
    ? (s.account.handle ?? s.account.workspaceName ?? s.account.userName)
    : null
}

function claudeReady(c: ClaudeCodeStatus | null): boolean {
  return !!c && c.installed && c.meetsMinimum && c.loggedIn !== false
}

function shortPath(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean)
  return parts.length > 2 ? `…/${parts.slice(-2).join('/')}` : path
}

export function setupSteps(input: SetupInput): SetupStep[] {
  const { project } = input
  const done: Record<SetupStepId, boolean> = {
    github: input.github?.state === 'connected',
    notion: input.notion?.state === 'connected',
    claude: claudeReady(input.claude),
    folder: project !== null,
    'notion-data': !!input.workspace?.config && !!project?.notionProject,
    board: input.boardConfigured,
    'first-task': false
  }
  const summary: Record<SetupStepId, string | null> = {
    github: account(input.github),
    notion: account(input.notion),
    claude: claudeReady(input.claude)
      ? `v${input.claude?.version ?? '?'} · logado`
      : input.claude && !input.claude.installed
        ? 'não encontrado'
        : null,
    folder: project ? shortPath(project.localPath) : null,
    'notion-data': project?.notionProject?.name ?? null,
    board: null,
    'first-task': null
  }
  let currentSet = false
  return (Object.keys(SETUP_TITLES) as SetupStepId[]).map((id) => {
    let state: SetupStepState
    if (done[id]) state = 'done'
    else if (!currentSet) {
      state = 'current'
      currentSet = true
    } else state = 'todo'
    return { id, title: SETUP_TITLES[id], summary: summary[id], state }
  })
}

export function setupPending(steps: readonly SetupStep[]): number {
  return steps.filter((s) => REQUIRED.includes(s.id) && s.state !== 'done').length
}
