import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/Spinner'
import { Timestamp } from '@/components/Timestamp'
import { cn } from '@/lib/utils'
import { isRunLive, type RunLogEvent } from '../../../../shared/agent-run'
import { Alert } from '../../components/Alert'
import { ArrowUpIcon, PlusIcon, ReadIcon, StopIcon } from '../../components/icons'
import { ipcResult } from '../../lib/ipc'
import { RunBlock } from '../claude/RunBlock'
import { sideChats } from './task-sessions'
import { useTaskView } from './task-view'

/**
 * Sidechat (como no Compozy): uma conversa ao lado para perguntar sobre a tarefa sem mexer na
 * sessão principal. Parte do ponto atual da conversa principal, só lê (não edita arquivos), roda
 * junto dela sem interromper e nunca vira a sessão que a tarefa e os fluxos continuam.
 */
export function SidechatPanel(): React.JSX.Element {
  const view = useTaskView()
  const { projectId, taskId, runs, agent } = view
  const chats = useMemo(() => sideChats(runs.state?.runs ?? []), [runs.state])
  // `null` = o mais recente; `'new'` = o próximo envio abre um sidechat novo.
  const [chosen, setChosen] = useState<string | 'new' | null>(null)
  const current = chosen === 'new' ? null : (chats.find((c) => c.id === chosen) ?? chats[0] ?? null)
  const liveRun = current?.runs.find((r) => isRunLive(r.status)) ?? null
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scroller = useRef<HTMLDivElement>(null)

  // Log ao vivo dos sidechats desta tarefa (a conversa principal ignora estes eventos).
  const [live, setLive] = useState<Record<string, RunLogEvent[]>>({})
  useEffect(
    () =>
      window.orkio.claude.onRunEvent((m) => {
        if (m.taskId !== taskId || !m.side) return
        setLive((cur) => ({ ...cur, [m.runId]: [...(cur[m.runId] ?? []), m.event] }))
      }),
    [taskId]
  )
  const runCount = current?.runs.length ?? 0
  useEffect(() => {
    const box = scroller.current
    if (box) box.scrollTop = box.scrollHeight
  }, [runCount, live])

  const send = async (): Promise<void> => {
    const message = text.trim()
    if (!message || sending || liveRun) return
    setSending(true)
    setError(null)
    const r = await ipcResult(() =>
      window.orkio.claude.send({
        projectId,
        taskId,
        text: message,
        side: true,
        ...(current ? { session: current.id } : {})
      })
    )
    setSending(false)
    if (!r.ok) {
      setError(r.error.message)
      return
    }
    setText('')
    runs.setState(r.value)
    // O sidechat novo (o mais recente) passa a ser o mostrado.
    if (chosen === 'new') setChosen(sideChats(r.value.runs)[0]?.id ?? null)
  }

  return (
    <section aria-label="Sidechat" className="flex min-h-[420px] flex-col gap-3">
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 text-xs text-muted-foreground">
          Pergunte sobre a tarefa sem mexer na sessão principal. Parte do ponto atual da conversa e
          só lê: não edita arquivos.
        </p>
        <Button
          size="xs"
          variant="outline"
          disabled={chosen === 'new' || chats.length === 0}
          onClick={() => {
            setChosen('new')
            setError(null)
          }}
        >
          <PlusIcon />
          Novo sidechat
        </Button>
      </div>

      {chats.length > 1 && (
        <div
          role="radiogroup"
          aria-label="Sidechats da tarefa"
          className="scroll-x-clean flex gap-1.5 pr-8"
        >
          {chats.map((c) => {
            const on = c.id === current?.id
            return (
              <button
                key={c.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setChosen(c.id)}
                className={cn(
                  'flex max-w-48 shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-2xs outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
                  on
                    ? 'border-brand/40 bg-brand-tint text-foreground'
                    : 'border-border-soft text-muted-foreground hover:bg-muted hover:text-foreground'
                )}
              >
                {c.live && (
                  <span
                    aria-hidden="true"
                    className="size-1.5 shrink-0 animate-pulse rounded-full bg-brand motion-reduce:animate-none"
                  />
                )}
                <span className="truncate">{c.title}</span>
                <span className="shrink-0 text-subtle-foreground">
                  <Timestamp value={c.lastAt} />
                </span>
              </button>
            )
          })}
        </div>
      )}

      <div
        ref={scroller}
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto rounded-xl border border-border-soft bg-background/40 p-3"
      >
        {current ? (
          <ul aria-label="Conversa do sidechat" className="flex flex-col gap-4">
            {current.runs.map((r) => (
              <li key={r.id}>
                <RunBlock
                  side
                  run={r}
                  agent={agent}
                  liveLog={isRunLive(r.status) || live[r.id] ? (live[r.id] ?? []) : null}
                />
              </li>
            ))}
          </ul>
        ) : (
          <div
            data-testid="sidechat-empty"
            className="flex flex-1 flex-col items-center justify-center gap-2 px-4 py-8 text-center"
          >
            <span className="grid size-9 place-items-center rounded-lg border border-border-soft bg-muted text-muted-foreground">
              <ReadIcon className="size-[18px]" />
            </span>
            <p className="text-sm text-foreground">
              {chosen === 'new' ? 'Sidechat novo' : 'Nenhum sidechat ainda'}
            </p>
            <p className="max-w-xs text-xs text-muted-foreground">
              Ex.: “por que você escolheu esse caminho?”, “onde fica a validação disso?”. A sessão
              principal continua de onde está.
            </p>
          </div>
        )}
      </div>

      <div className="flex items-end gap-1.5 rounded-xl border border-border bg-card p-2 focus-within:border-ring">
        <textarea
          aria-label="Mensagem do sidechat"
          placeholder="Pergunte ao lado…"
          value={text}
          rows={1}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || e.shiftKey || e.altKey || e.nativeEvent.isComposing) return
            e.preventDefault()
            void send()
          }}
          className="field-sizing-content max-h-36 min-h-8 min-w-0 flex-1 resize-none bg-transparent px-1 py-1 text-sm outline-none placeholder:text-subtle-foreground"
        />
        {liveRun ? (
          <Button
            size="icon-sm"
            variant="secondary"
            aria-label="Parar o sidechat"
            title="Parar"
            className="shrink-0 rounded-full"
            onClick={() => void window.orkio.claude.cancel(liveRun.id)}
          >
            <StopIcon />
          </Button>
        ) : (
          <Button
            size="icon-sm"
            aria-label="Enviar no sidechat"
            title="Enviar (Enter) · Shift+Enter quebra a linha"
            className="shrink-0 rounded-full"
            disabled={!text.trim() || sending}
            onClick={() => void send()}
          >
            {sending ? <Spinner /> : <ArrowUpIcon className="size-4" />}
          </Button>
        )}
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
    </section>
  )
}
