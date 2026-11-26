import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import {
  isServerLive,
  type ServerView,
  type TaskServers as TaskServersData
} from '../../../../shared/servers'
import { Alert } from '../../components/Alert'
import {
  ExternalLinkIcon,
  PlayIcon,
  ServerIcon,
  StopIcon,
  TerminalIcon
} from '../../components/icons'
import { StatusToken } from '../../components/StatusToken'
import { ipcResult, unwrap, useIpcResource } from '../../lib/ipc'
import { TerminalView } from '../terminal/TerminalView'
import { serverStateText } from './servers-logic'

/**
 * Painel Ambiente › Servidores: os servidores cadastrados do projeto nesta tarefa, com o estado,
 * a URL (abre no navegador pelo main), Subir/Parar e o log (terminal só leitura num modal).
 * Sem cadastro, a seção não aparece.
 */
export function TaskServers({
  projectId,
  taskId,
  hasWorkspace
}: {
  projectId: string
  taskId: string
  hasWorkspace: boolean
}): React.JSX.Element | null {
  const data = useIpcResource<TaskServersData>(
    `${projectId}|${taskId}`,
    () => window.orkio.servers.list(projectId, taskId).then(unwrap),
    {
      subscribe: (reload) =>
        window.orkio.servers.onChanged((e) => {
          if (e.taskId === taskId) reload()
        })
    }
  )
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [log, setLog] = useState<ServerView | null>(null)
  const servers = data.value?.servers ?? []
  if (servers.length === 0) return null
  const available = data.value?.available !== false

  async function act(s: ServerView, action: 'start' | 'stop' | 'open'): Promise<void> {
    setBusy(`${action}:${s.id}`)
    setError(null)
    const r = await ipcResult(() => window.orkio.servers[action](projectId, taskId, s.id))
    setBusy(null)
    if (!r.ok) setError(r.error.message)
    else if (action !== 'open') void data.reload()
  }
  // O modal acompanha o estado (saiu enquanto estava aberto → só leitura sem cursor).
  const logView = log ? (servers.find((s) => s.id === log.id) ?? log) : null

  return (
    <section
      aria-label="Servidores"
      data-testid="task-servers"
      className="flex flex-col gap-0.5 border-t border-border-soft pt-3"
    >
      <h3 className="px-2 text-xs font-medium text-muted-foreground">Servidores</h3>
      {!available && (
        <p className="px-2 text-xs text-muted-foreground">
          O terminal embutido não carregou neste computador; o Orkio não consegue rodar servidores.
        </p>
      )}
      <ul className="flex flex-col">
        {servers.map((s) => {
          const live = isServerLive(s.state)
          const state = serverStateText(s)
          return (
            <li
              key={s.id}
              aria-label={`Servidor ${s.name}`}
              className="flex min-h-8 flex-wrap items-center gap-x-2.5 gap-y-1 rounded-md px-2 py-1 text-sm"
            >
              <ServerIcon aria-hidden="true" className="size-4 shrink-0 text-subtle-foreground" />
              <span className="font-mono text-xs text-foreground">{s.name}</span>
              <StatusToken
                label={state.label}
                tone={state.tone}
                className="text-xs"
                data-testid="server-state"
              />
              {s.url && (
                <button
                  type="button"
                  title={`Abrir ${s.url} no navegador`}
                  onClick={() => void act(s, 'open')}
                  className="inline-flex min-w-0 items-center gap-1 truncate rounded font-mono text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
                >
                  {s.url.replace(/^http:\/\//, '')}
                  <ExternalLinkIcon aria-hidden="true" className="size-3 shrink-0" />
                </button>
              )}
              <span className="ml-auto flex shrink-0 items-center gap-0.5">
                {s.terminalId && (
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label={`Ver log de ${s.name}`}
                    title="Ver log"
                    className="text-subtle-foreground hover:text-foreground"
                    onClick={() => setLog(s)}
                  >
                    <TerminalIcon />
                  </Button>
                )}
                {live ? (
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label={`Parar ${s.name}`}
                    title="Parar"
                    className="text-danger hover:text-danger"
                    disabled={busy !== null}
                    onClick={() => void act(s, 'stop')}
                  >
                    <StopIcon />
                  </Button>
                ) : s.removed ? null : (
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label={`Subir ${s.name}`}
                    title={hasWorkspace ? 'Subir' : 'Pasta criada quando o agente começar'}
                    className="text-subtle-foreground hover:text-foreground"
                    disabled={!hasWorkspace || !available || busy !== null}
                    onClick={() => void act(s, 'start')}
                  >
                    <PlayIcon />
                  </Button>
                )}
              </span>
            </li>
          )
        })}
      </ul>
      {error && <Alert tone="danger">{error}</Alert>}

      <Dialog open={logView !== null} onOpenChange={(o) => !o && setLog(null)}>
        <DialogContent className="flex h-[70vh] flex-col gap-3 sm:max-w-[min(90vw,960px)]">
          <div className="flex flex-col gap-0.5 pr-6">
            <DialogTitle className="text-sm">Log de {logView?.name}</DialogTitle>
            <DialogDescription className="font-mono text-xs text-muted-foreground">
              {logView?.command}
            </DialogDescription>
          </div>
          {logView?.terminalId && (
            <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-border-soft">
              <TerminalView
                key={logView.terminalId}
                id={logView.terminalId}
                running={false}
                label={`Log do servidor ${logView.name}`}
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </section>
  )
}
