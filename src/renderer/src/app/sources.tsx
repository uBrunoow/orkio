/**
 * Fontes de dados compartilhadas pelas telas (uma por dado do main): criadas uma vez no topo do
 * App e lidas pelos hooks das features (`useOverview`, `useTaskSignals`, `useBoard`, `useProjects`,
 * `useConnection`, `useUpdates`, `useClaudeStatus`). Cada fonte tem uma carga, uma assinatura de
 * eventos e um poll, por mais telas que a leiam ao mesmo tempo.
 */
import { createContext, useContext, useState } from 'react'
import { createSource, ipcCall, IPC_FAILURE_MESSAGE, unwrap, type Source } from '../lib/ipc'
import type { ClaudeCodeStatus } from '../../../shared/agent-run'
import type { BoardCard, BoardView } from '../../../shared/board'
import type { AuthOptions, ConnectionStatus } from '../../../shared/connection'
import type { OverviewSnapshot } from '../../../shared/overview'
import type { ProjectView } from '../../../shared/projects'
import type { ResultError } from '../../../shared/result'
import type { TaskSignalsResult } from '../../../shared/task-signals'
import type { UpdateStatus } from '../../../shared/updates'

/** Relê a visão (só dados locais) a cada minuto com a janela visível: PRs e saúde mudam sozinhos. */
const OVERVIEW_POLL_MS = 60_000
/** Sinais: atualização leve (o main usa ETag: quase sempre 304), com a janela visível e em foco. */
const SIGNALS_POLL_MS = 60_000

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
  updates: Source<UpdateStatus>
}

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
        return () => {
          offChanged()
          offSync()
        }
      }
    }),
    projects: createSource<ProjectsState, 'revalidate'>({
      load: async (_key, arg) => {
        const r = await window.orkio.projects[arg === 'revalidate' ? 'revalidate' : 'list']()
        return { projects: r.projects, warning: r.warning ?? null }
      },
      // Branch ao vivo (evento do main) e estado local ao voltar para a janela.
      listen: (src) =>
        window.orkio.projects.onBranchChanged(({ projectId, branch }) =>
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
        ),
      refreshOnFocus: true
    }),
    connections: createSource({
      // Status salvo (local, sem rede); relido ao voltar para a janela.
      load: (kind) => ipcCall(() => connectorApi(kind).getStatus(), CONNECTION_IPC_FAILURE),
      refreshOnFocus: true
    }),
    verifiedAt: createSource<Date | null>({ load: () => Promise.resolve(null) }),
    authOptions: createSource({
      load: (kind) => ipcCall(() => connectorApi(kind).getAuthOptions(), { oauth: false })
    }),
    claude: createSource({
      load: (_key, arg) => window.orkio.claude.status(arg ? { force: arg.force } : undefined)
    }),
    updates: createSource({
      load: () => window.orkio.updates.status(),
      listen: (src) => window.orkio.updates.onStatus((s) => src.set('', s))
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
