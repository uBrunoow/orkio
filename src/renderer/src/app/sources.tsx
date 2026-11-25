/**
 * Fontes de dados compartilhadas pelas telas (uma por dado do main): criadas uma vez no topo do
 * App e lidas pelos hooks das features (`useOverview`, `useTaskSignals`, `useBoard`, `useProjects`,
 * `useConnection`, `useUpdates`, `useClaudeStatus`, `useProjectFlows`, `useCatalog`,
 * `useAlvaPrecheck`, `useAutomationStatus`, `useProjectActivity`, `usePersonalTasks`). Cada fonte tem uma carga, uma assinatura de
 * eventos e um poll, por mais telas que a leiam ao mesmo tempo.
 */
import { createContext, useContext, useState } from 'react'
import {
  createSource,
  ipcCall,
  ipcResult,
  IPC_FAILURE_MESSAGE,
  unwrap,
  type Source,
  type SourceControl
} from '../lib/ipc'
import type { CatalogGroup, ClaudeCodeStatus } from '../../../shared/agent-run'
import type { AlvaPrecheck } from '../../../shared/alva'
import type { AutomationStatus } from '../../../shared/automation'
import type { BoardCard, BoardView } from '../../../shared/board'
import type { AuthOptions, ConnectionStatus } from '../../../shared/connection'
import type { NotionWorkspaceStatus } from '../../../shared/notion'
import type { ActivityItem, OverviewSnapshot } from '../../../shared/overview'
import type { ProjectView } from '../../../shared/projects'
import type { ResultError } from '../../../shared/result'
import type { TaskFlowsProject } from '../../../shared/task-flow'
import type { PersonalTasksSnapshot } from '../../../shared/task-lanes'
import type { ActivityGroup } from '../../../shared/task-events'
import type { TaskSignalsResult } from '../../../shared/task-signals'
import type { UpdateStatus } from '../../../shared/updates'
import type { ClaudeUsageView } from '../../../shared/claude-usage'

/** Relê a visão (só dados locais) a cada minuto com a janela visível: PRs e saúde mudam sozinhos. */
const OVERVIEW_POLL_MS = 60_000
/** Sinais: atualização leve (o main usa ETag: quase sempre 304), com a janela visível e em foco. */
const SIGNALS_POLL_MS = 60_000
/** Estado das automações do projeto (próxima verificação, erro) enquanto o Quadro está aberto. */
const AUTOMATION_POLL_MS = 15_000
/** Situação das tarefas (raias): só dados locais, com a janela visível. */
const PERSONAL_TASKS_POLL_MS = 30_000
/** Medidor de uso do Claude: só com a janela em foco (o main ainda guarda 60 s de cache). */
const USAGE_POLL_MS = 60_000
/** Quantos eventos de fluxo/execução o sino lê para montar o "Concluído". */
const FINISHED_SCAN = 60

export type ConnectorKind = 'notion' | 'github'

export const CONNECTION_IPC_FAILURE: ConnectionStatus = {
  state: 'error',
  message: IPC_FAILURE_MESSAGE
}

/** Quadro do projeto + a última recusa do Notion (aviso que a tela mostra até fechar). */
export interface BoardState {
  view: BoardView
  notice: (ResultError & { taskId?: string }) | null
}

export interface ProjectsState {
  projects: ProjectView[]
  warning: string | null
}

export interface AppSources {
  overview: Source<OverviewSnapshot>
  signals: Source<TaskSignalsResult, { force: boolean }>
  board: Source<BoardState, { force: boolean }>
  projects: Source<ProjectsState, 'revalidate'>
  connections: Source<ConnectionStatus>
  /** Momento da última verificação bem-sucedida nesta sessão, por conector. */
  verifiedAt: Source<Date | null>
  authOptions: Source<AuthOptions>
  claude: Source<ClaudeCodeStatus, { force: boolean }>
  notionWorkspace: Source<NotionWorkspaceStatus, 'revalidate'>
  updates: Source<UpdateStatus>
  /** Fluxos de tarefa, ligações e entrega do projeto. Quem grava devolve o novo (ou relê). */
  projectFlows: Source<TaskFlowsProject>
  /** Catálogo do Claude Code, chave `catalogKey(projeto, tarefa)`; falha = vazio. */
  catalog: Source<CatalogGroup[]>
  /** Pré-checagem do alva-flow por projeto (`force` refaz). */
  alvaPrecheck: Source<AlvaPrecheck, { force: boolean }>
  automation: Source<AutomationStatus>
  /** Atividade recente do projeto por grupo, chave `activityKey(projeto, grupo)`. */
  activity: Source<ActivityItem[]>
  /** Sino: fluxos e execuções que terminaram, de todos os projetos (o sino filtra). */
  finished: Source<ActivityItem[]>
  /** Medidor de uso do Claude (% e quando renova); `usage: null` = some. */
  claudeUsage: Source<ClaudeUsageView>
  /** Situação de cada tarefa (raia, o quê, chips da PR) de todos os projetos; chave `''`. */
  personalTasks: Source<PersonalTasksSnapshot>
}

export const catalogKey = (projectId: string, taskId: string | null): string =>
  JSON.stringify([projectId, taskId])

export const activityKey = (projectId: string, group: ActivityGroup): string =>
  JSON.stringify([projectId, group])

export const connectorApi = (
  kind: string
): typeof window.orkio.github | typeof window.orkio.notion =>
  kind === 'github' ? window.orkio.github : window.orkio.notion

function patchCard(
  state: BoardState | null,
  taskId: string,
  patch: (card: BoardCard) => BoardCard
): BoardState | null {
  if (!state) return state
  const cards = state.view.cards.map((c) => (c.taskId === taskId ? patch(c) : c))
  return {
    ...state,
    view: {
      ...state.view,
      cards,
      pendingCount: cards.filter((c) => c.sync.state === 'pending').length
    }
  }
}

export { patchCard as patchBoardCard }

/**
 * Quadro de um projeto lido fora de um componente (busca, lista de projetos): pela fonte, que junta
 * a leitura com a de outras telas e guarda o resultado; `null` = sem quadro ou falha.
 */
export async function readBoard(
  board: AppSources['board'],
  projectId: string
): Promise<BoardView | null> {
  await board.reload(projectId)
  return board.get(projectId).value?.view ?? null
}

/** Relê todas as chaves lidas quando a conta de um serviço muda (conectou, desconectou...). */
function reloadOnConnection<T, A>(
  src: SourceControl<T, A>,
  ...services: ('notion' | 'github')[]
): () => void {
  const offs = services.map((kind) =>
    connectorApi(kind).onChanged(() => {
      for (const key of src.keys()) void src.reload(key)
    })
  )
  return () => offs.forEach((off) => off())
}

export function createAppSources(): AppSources {
  return {
    overview: createSource({
      load: () => window.orkio.overview.get().then(unwrap),
      listen: (src) => window.orkio.overview.onChanged(() => void src.reload('')),
      pollMs: OVERVIEW_POLL_MS
    }),
    signals: createSource({
      load: (projectId, arg) =>
        window.orkio.signals.get(projectId, { force: arg?.force ?? false }).then(unwrap),
      listen: (src) =>
        window.orkio.projects.onBranchChanged((e) => {
          if (src.keys().includes(e.projectId)) void src.reload(e.projectId)
        }),
      pollMs: SIGNALS_POLL_MS,
      pollWhen: () => document.visibilityState === 'visible' && document.hasFocus()
    }),
    board: createSource<BoardState, { force: boolean }>({
      load: async (projectId, arg) => {
        const view = unwrap(await window.orkio.board.get(projectId, { force: arg?.force ?? false }))
        return { view, notice: null }
      },
      listen: (src) => {
        // Movimento por automação (3B): relê o quadro (sem forçar o Notion).
        const offChanged = window.orkio.board.onChanged((e) => {
          if (src.keys().includes(e.projectId)) void src.reload(e.projectId)
        })
        // Escrita no Notion (sincronizada, pendente ou recusada → card volta).
        const offSync = window.orkio.board.onSyncChanged((event) => {
          if (!src.keys().includes(event.projectId)) return
          src.set(event.projectId, (current) => {
            const next = patchCard(current, event.taskId, (card) => ({
              ...card,
              stageId: event.stageId,
              blocked: event.blocked,
              sync:
                event.state === 'pending'
                  ? { state: 'pending', ...(event.message ? { message: event.message } : {}) }
                  : { state: event.state === 'failed' ? 'failed' : 'synced' }
            }))
            if (!next || event.state !== 'failed') return next
            return {
              ...next,
              notice: {
                code: 'rejected',
                message: event.message ?? 'O Notion recusou a mudança.',
                taskId: event.taskId,
                ...(event.canReconnect ? { canReconnect: true } : {})
              }
            }
          })
        })
        const offConnection = reloadOnConnection(src, 'notion', 'github')
        return () => {
          offChanged()
          offSync()
          offConnection()
        }
      }
    }),
    projects: createSource<ProjectsState, 'revalidate'>({
      load: async (_key, arg) => {
        const r = await window.orkio.projects[arg === 'revalidate' ? 'revalidate' : 'list']()
        return { projects: r.projects, warning: r.warning ?? null }
      },
      listen: (src) => {
        const offConnection = reloadOnConnection(src, 'github')
        const offBranch = window.orkio.projects.onBranchChanged(({ projectId, branch }) =>
          src.set('', (s) =>
            s
              ? {
                  ...s,
                  projects: s.projects.map((p) =>
                    p.id === projectId && p.local ? { ...p, local: { ...p.local, branch } } : p
                  )
                }
              : s
          )
        )
        return () => {
          offConnection()
          offBranch()
        }
      },
      refreshOnFocus: true
    }),
    connections: createSource({
      // Status salvo (local, sem rede); relido ao voltar para a janela.
      load: (kind) => ipcCall(() => connectorApi(kind).getStatus(), CONNECTION_IPC_FAILURE),
      listen: (src) => reloadOnConnection(src, 'notion', 'github'),
      refreshOnFocus: true
    }),
    verifiedAt: createSource<Date | null>({ load: () => Promise.resolve(null) }),
    authOptions: createSource({
      load: (kind) => ipcCall(() => connectorApi(kind).getAuthOptions(), { oauth: false })
    }),
    notionWorkspace: createSource<NotionWorkspaceStatus, 'revalidate'>({
      // Estado dos bancos (o main revalida uma vez por sessão; 'revalidate' força).
      load: (_key, arg) =>
        ipcCall(() => window.orkio.notionWorkspace[arg ?? 'getStatus'](), {
          config: null,
          health: 'unverified',
          messages: [IPC_FAILURE_MESSAGE],
          connection: null
        }),
      listen: (src) => reloadOnConnection(src, 'notion'),
      refreshOnFocus: true
    }),
    claude: createSource({
      load: (_key, arg) => window.orkio.claude.status(arg ? { force: arg.force } : undefined)
    }),
    updates: createSource({
      load: () => window.orkio.updates.status(),
      listen: (src) => window.orkio.updates.onStatus((s) => src.set('', s))
    }),
    projectFlows: createSource({
      load: (projectId) => window.orkio.taskFlows.getProject(projectId).then(unwrap)
    }),
    catalog: createSource({
      load: (key) => {
        const [projectId, taskId] = JSON.parse(key) as [string, string | null]
        return ipcResult(() => window.orkio.claude.catalog(projectId, taskId)).then((r) =>
          r.ok ? r.value : []
        )
      }
    }),
    alvaPrecheck: createSource<AlvaPrecheck, { force: boolean }>({
      load: (projectId, arg) =>
        window.orkio.alva.precheck(projectId, arg?.force ? { force: true } : undefined).then(unwrap)
    }),
    automation: createSource({
      load: (projectId) => window.orkio.automation.status(projectId),
      pollMs: AUTOMATION_POLL_MS
    }),
    activity: createSource({
      load: (key) => {
        const [projectId, group] = JSON.parse(key) as [string, ActivityGroup]
        return ipcResult(() =>
          window.orkio.overview.activity({ projectId, group, limit: 200 })
        ).then((r) => (r.ok ? r.value.items : []))
      },
      // Uma execução nova de regra ou fluxo muda a visão geral (mesmo evento de antes).
      listen: (src) =>
        window.orkio.overview.onChanged(() => {
          for (const key of src.keys()) void src.reload(key)
        })
    }),
    finished: createSource({
      load: async () => {
        const read = (group: ActivityGroup): Promise<ActivityItem[]> =>
          ipcResult(() => window.orkio.overview.activity({ group, limit: FINISHED_SCAN })).then(
            (r) => (r.ok ? r.value.items : [])
          )
        const [flows, runs] = await Promise.all([read('flow'), read('claude')])
        return [...flows, ...runs]
      },
      listen: (src) => window.orkio.overview.onChanged(() => void src.reload(''))
    }),
    claudeUsage: createSource({
      load: () => ipcCall(() => window.orkio.usage.claude(), { enabled: true, usage: null }),
      pollMs: USAGE_POLL_MS,
      pollWhen: () => document.visibilityState === 'visible' && document.hasFocus(),
      refreshOnFocus: true
    }),
    personalTasks: createSource({
      load: () => window.orkio.overview.tasks().then(unwrap),
      listen: (src) => {
        const reload = (): void => void src.reload('')
        const offs = [
          window.orkio.overview.onChanged(reload),
          window.orkio.taskFlows.onChanged(reload),
          window.orkio.board.onChanged(reload)
        ]
        return () => offs.forEach((off) => off())
      },
      pollMs: PERSONAL_TASKS_POLL_MS
    })
  }
}

const SourcesContext = createContext<AppSources | null>(null)

export function SourcesProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [sources] = useState(createAppSources)
  return <SourcesContext.Provider value={sources}>{children}</SourcesContext.Provider>
}

export function useSources(): AppSources {
  const sources = useContext(SourcesContext)
  if (!sources) throw new Error('SourcesProvider ausente')
  return sources
}
