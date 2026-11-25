/**
 * Aba "Terminal" da tarefa (Fase 2): terminais embutidos na pasta de trabalho da tarefa (o
 * worktree) e, com "Continuar no Claude", a sessão do Claude Code da tarefa num deles. Os
 * processos vivem no main: trocar de aba não fecha nada.
 */
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { HANDOFF_TEXT } from '../../../../shared/handoff'
import type { TerminalView as TerminalInfo } from '../../../../shared/terminal'
import { Alert } from '../../components/Alert'
import { ClaudeLogo, CloseIcon, PlusIcon, TerminalIcon } from '../../components/icons'
import { PageState } from '../../components/PageState'
import { StatusDot } from '../../components/StatusToken'
import { ScreenBarEnd, ScreenBarStart, Crumbs } from '../../app/ScreenBar'
import { ipcResult } from '../../lib/ipc'
import { useBoard } from '../board/useBoard'
import { HandoffBar } from './HandoffBar'
import { TerminalView } from './TerminalView'
import { pickTerminal, useHandoff, useTaskTerminals } from './useTaskTerminals'

export function TerminalPage({
  projectId,
  taskId,
  startClaude = false,
  onStarted,
  onOpenTask,
  embedded = false
}: {
  projectId: string
  taskId: string
  /** Dentro do painel da tarefa: sem a barra da tela (caminho e "Ver tarefa"). */
  embedded?: boolean
  /** Abriu pela paleta/menu "Continuar no Claude": começa sozinho, uma vez. */
  startClaude?: boolean
  onStarted?(): void
  onOpenTask(): void
}): React.JSX.Element {
  const board = useBoard(projectId)
  const card = board.view?.cards.find((c) => c.taskId === taskId) ?? null
  const taskLabel = card?.displayId ?? card?.title ?? 'Tarefa'
  const list = useTaskTerminals(projectId, taskId)
  const handoff = useHandoff(projectId, taskId)
  const [selected, setSelected] = useState<string | null>(null)
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const terminals = list.value?.terminals ?? []
  const available = list.value?.available ?? true
  const current = pickTerminal(terminals, selected, handoff.handoff)

  const openShell = async (): Promise<void> => {
    setOpening(true)
    setError(null)
    const r = await ipcResult(() => window.orkio.terminal.open(projectId, taskId))
    setOpening(false)
    if (!r.ok) setError(r.error.message)
    else {
      setSelected(r.value.id)
      void list.reload()
    }
  }
  const close = (t: TerminalInfo): void => {
    if (selected === t.id) setSelected(null)
    void window.orkio.terminal.close(t.id)
  }
  const startHandoff = async (): Promise<void> => {
    const view = await handoff.start()
    if (view?.terminalId) setSelected(view.terminalId)
    void list.reload()
  }
  const autoStart = useRef(startClaude)
  useEffect(() => {
    if (!autoStart.current) return
    autoStart.current = false
    onStarted?.()
    void startHandoff()
    // Uma vez, ao abrir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="flex h-full min-h-0 flex-col">
      {!embedded && (
        <>
          <ScreenBarStart>
            <Crumbs parts={[{ label: taskLabel, onClick: onOpenTask }, 'Terminal']} />
          </ScreenBarStart>
          <ScreenBarEnd>
            <Button size="sm" variant="ghost" onClick={onOpenTask}>
              Ver tarefa
            </Button>
          </ScreenBarEnd>
        </>
      )}

      <div className="flex shrink-0 items-center gap-1 border-b border-border-soft px-3 py-1.5">
        <div
          role="tablist"
          aria-label="Terminais da tarefa"
          className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
        >
          {terminals.map((t) => {
            const active = current?.id === t.id
            const Icon = t.kind === 'claude' ? ClaudeLogo : TerminalIcon
            return (
              <div
                key={t.id}
                className={cn(
                  'group flex h-7 shrink-0 items-center rounded-md border text-xs',
                  active
                    ? 'border-border-soft bg-card text-foreground'
                    : 'border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                )}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setSelected(t.id)}
                  className="flex h-full items-center gap-1.5 rounded-md pr-1 pl-2 outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                >
                  <Icon aria-hidden="true" className="size-3.5" />
                  {t.title}
                  {t.state === 'exited' && <span className="text-subtle-foreground">· saiu</span>}
                </button>
                <button
                  type="button"
                  aria-label={`Fechar ${t.title}`}
                  onClick={() => close(t)}
                  className="mr-1 grid size-5 place-items-center rounded-sm text-subtle-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
                >
                  <CloseIcon aria-hidden="true" className="size-3" />
                </button>
              </div>
            )
          })}
        </div>
        {available && (
          <Button
            size="sm"
            variant="ghost"
            disabled={opening}
            onClick={() => void openShell()}
            aria-label="Novo terminal"
          >
            <PlusIcon aria-hidden="true" />
            Novo terminal
          </Button>
        )}
        {available && !handoff.handoff && handoff.hasSession && (
          <Button
            size="sm"
            variant="outline"
            title={HANDOFF_TEXT.startHint}
            disabled={handoff.busy !== null}
            onClick={() => void startHandoff()}
          >
            <ClaudeLogo aria-hidden="true" />
            {handoff.busy === 'start' ? 'Abrindo…' : HANDOFF_TEXT.start}
          </Button>
        )}
      </div>

      {handoff.handoff && (
        <div className="shrink-0 px-3 pt-3">
          <HandoffBar
            handoff={handoff.handoff}
            busy={handoff.busy}
            error={handoff.error}
            terminalAvailable={available}
            onGiveBack={(mode) => void handoff.giveBack(mode)}
            onReopen={() =>
              void handoff.reopen().then((v) => {
                if (v?.terminalId) setSelected(v.terminalId)
                void list.reload()
              })
            }
          />
        </div>
      )}
      {(error ?? (!handoff.handoff ? handoff.error : null)) && (
        <div className="shrink-0 px-3 pt-3">
          <Alert tone="danger">{error ?? handoff.error}</Alert>
        </div>
      )}

      <div className="min-h-0 flex-1">
        {list.error && !list.value ? (
          <div className="p-6">
            <PageState kind="error" message={list.error.message} />
          </div>
        ) : !list.value ? (
          <div className="p-6">
            <PageState kind="loading" label="Carregando terminais" />
          </div>
        ) : current ? (
          <div className="flex h-full min-h-0 flex-col">
            <TerminalView
              key={current.id}
              id={current.id}
              running={current.state === 'running'}
              label={`Terminal ${current.title} de ${taskLabel}`}
            />
            {current.state === 'exited' && (
              <p className="flex shrink-0 items-center gap-2 border-t border-border-soft px-4 py-2 text-xs text-muted-foreground">
                <StatusDot tone="neutral" />O processo terminou
                {current.exitCode !== null ? ` (código ${current.exitCode})` : ''}.
              </p>
            )}
          </div>
        ) : (
          <TerminalStart
            available={available}
            hasSession={handoff.hasSession && !handoff.handoff}
            busy={opening || handoff.busy !== null}
            onShell={() => void openShell()}
            onClaude={() => void startHandoff()}
          />
        )}
      </div>
    </div>
  )
}

/** Sem terminal aberto: os dois pontos de partida, em frase comum. */
function TerminalStart({
  available,
  hasSession,
  busy,
  onShell,
  onClaude
}: {
  available: boolean
  hasSession: boolean
  busy: boolean
  onShell(): void
  onClaude(): void
}): React.JSX.Element {
  if (!available) {
    return (
      <div className="p-6">
        <PageState
          kind="empty"
          title="Terminal embutido indisponível"
          description="Este computador não carregou o terminal do Orkio. Use “Abrir terminal aqui” na tarefa para abrir o terminal do sistema na pasta dela."
        />
      </div>
    )
  }
  const cards = [
    {
      key: 'shell',
      icon: TerminalIcon,
      title: 'Abrir um terminal na pasta da tarefa',
      body: 'Um shell no ambiente da tarefa (o worktree), com a branch dela.',
      onClick: onShell,
      show: true
    },
    {
      key: 'claude',
      icon: ClaudeLogo,
      title: HANDOFF_TEXT.start,
      body: HANDOFF_TEXT.startHint,
      onClick: onClaude,
      show: hasSession
    }
  ].filter((c) => c.show)
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-3 px-6 py-10">
      <h2 className="text-sm font-medium text-foreground">Por onde começar</h2>
      <div className="grid gap-2 sm:grid-cols-2">
        {cards.map((c) => (
          <button
            key={c.key}
            type="button"
            disabled={busy}
            onClick={c.onClick}
            className="flex flex-col items-start gap-1.5 rounded-lg border border-border bg-card px-4 py-3 text-left outline-none hover:border-border hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-60"
          >
            <c.icon aria-hidden="true" className="size-4 text-muted-foreground" />
            <span className="text-sm font-medium text-foreground">{c.title}</span>
            <span className="text-xs text-muted-foreground">{c.body}</span>
          </button>
        ))}
      </div>
      {hasSession && <p className="text-xs text-subtle-foreground">{HANDOFF_TEXT.warning}</p>}
    </div>
  )
}
