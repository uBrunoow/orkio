import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/Spinner'
import { cn } from '@/lib/utils'
import type { AgentBadge } from '../../../../shared/agent'
import type { CatalogCommand, TaskRunsState } from '../../../../shared/agent-run'
import { Alert } from '../../components/Alert'
import { SendIcon, StopIcon } from '../../components/icons'

const IS_MAC = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform)
const SEND_KEY = `${IS_MAC ? '⌘' : 'Ctrl'} ⏎ enviar`

/** Comandos do catálogo que começam com o que foi digitado depois da barra. */
export function matchCommands(
  commands: readonly CatalogCommand[],
  typed: string,
  limit = 6
): CatalogCommand[] {
  const q = typed.toLowerCase()
  const starts = commands.filter((c) => c.name.toLowerCase().startsWith(q))
  const contains = commands.filter(
    (c) => !c.name.toLowerCase().startsWith(q) && c.name.toLowerCase().includes(q)
  )
  return [...starts, ...contains].slice(0, limit)
}

/**
 * Campo de mensagem da sessão da tarefa: continua a última sessão do Claude Code (`--resume`) ou
 * começa uma com o briefing do Notion. `/` sugere comandos do catálogo; Ctrl/Cmd+Enter envia.
 * Enquanto o Claude trabalha, o botão vira "Parar"; com um passo de fluxo rodando, fica bloqueado.
 */
export function SessionComposer({
  projectId,
  taskId,
  agent,
  state,
  flowRunning,
  autopilotStep = null,
  onSent,
  onNewSession
}: {
  projectId: string
  taskId: string
  agent: AgentBadge | null
  state: TaskRunsState | null
  /** Um passo de fluxo está rodando (ou vai começar sozinho): não dá para mandar mensagem. */
  flowRunning: boolean
  /** Passo que o piloto automático (fluxo) está rodando agora. */
  autopilotStep?: string | null
  onSent(state: TaskRunsState): void
  /** Abre o formulário completo (briefing editável, modo, comando, rodar como). */
  onNewSession(): void
}): React.JSX.Element {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [catalog, setCatalog] = useState<CatalogCommand[] | null>(null)
  const ref = useRef<HTMLTextAreaElement>(null)

  const activeRunId = state?.activeRunId ?? null
  const latest = state?.runs[0] ?? null
  const resumes = !!latest?.hasSession
  const who = agent?.name ?? 'o Claude Code'

  const slash = /^\/(\S*)$/.exec(text)
  const typed = slash ? slash[1]! : null
  useEffect(() => {
    if (typed === null || catalog !== null) return
    let active = true
    void window.orkio.claude.catalog(projectId, taskId).then((r) => {
      if (active) setCatalog(r.ok ? r.value.flatMap((g) => g.commands) : [])
    })
    return () => {
      active = false
    }
  }, [typed, catalog, projectId, taskId])
  const suggestions = useMemo(
    () => (typed !== null && catalog ? matchCommands(catalog, typed) : []),
    [typed, catalog]
  )

  const blocked = flowRunning
    ? `O piloto automático está rodando${autopilotStep ? ` “${autopilotStep}”` : ' um passo'}. Ele para quando precisar de você; aí você responde aqui.`
    : activeRunId
      ? 'Espere o Claude terminar o turno ou pare a execução.'
      : null

  const send = async (): Promise<void> => {
    const message = text.trim()
    if (!message || blocked || sending) return
    setSending(true)
    setError(null)
    const r = await window.orkio.claude.send({ projectId, taskId, text: message })
    setSending(false)
    if (r.ok) {
      setText('')
      onSent(r.value)
    } else {
      setError(r.error.message)
    }
  }
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      void send()
    }
  }
  const disabled = !!blocked && !activeRunId

  return (
    <div role="group" aria-label="Mensagem para a sessão" className="flex flex-col gap-2">
      {suggestions.length > 0 && (
        <ul
          aria-label="Comandos sugeridos"
          className="flex flex-col overflow-hidden rounded-lg border border-border-soft bg-card"
        >
          {suggestions.map((c) => (
            <li key={c.name} className="border-b border-border-soft last:border-b-0">
              <button
                type="button"
                className="flex w-full min-w-0 items-baseline gap-2 px-3 py-1.5 text-left hover:bg-muted"
                onClick={() => {
                  setText(`/${c.name} `)
                  ref.current?.focus()
                }}
              >
                <code className="shrink-0 font-mono text-xs text-foreground">/{c.name}</code>
                {c.description && (
                  <span className="min-w-0 truncate text-xs text-muted-foreground">
                    {c.description}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div
        className={cn(
          'flex items-end gap-2 rounded-[10px] border border-border bg-card py-1.5 pr-1.5 pl-3 focus-within:border-ring',
          disabled && 'opacity-60'
        )}
      >
        <textarea
          ref={ref}
          aria-label={`Mensagem para ${who}`}
          placeholder={`Escreva para ${who}… ( / para comandos)`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          disabled={disabled}
          {...(disabled && blocked ? { title: blocked } : {})}
          className="field-sizing-content max-h-48 min-h-7 min-w-0 flex-1 resize-none bg-transparent py-1 text-sm outline-none placeholder:text-subtle-foreground disabled:cursor-not-allowed"
        />
        {!activeRunId && !disabled && (
          <span className="mb-2 shrink-0 font-mono text-2xs text-subtle-foreground">
            {SEND_KEY}
          </span>
        )}
        {activeRunId ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void window.orkio.claude.cancel(activeRunId)}
          >
            <StopIcon />
            Parar
          </Button>
        ) : (
          <Button
            size="sm"
            disabled={!text.trim() || !!blocked || sending}
            onClick={() => void send()}
          >
            {sending ? <Spinner /> : <SendIcon />}
            Enviar
          </Button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-xs text-subtle-foreground" data-testid="session-context">
          {flowRunning
            ? `Piloto automático${autopilotStep ? `: ${autopilotStep}` : ''}. Quando ele parar ou pedir algo, responda aqui.`
            : activeRunId
              ? 'O Claude está trabalhando. A próxima mensagem continua desta sessão.'
              : resumes
                ? `Continua a sessão${latest?.command ? ` de /${latest.command}` : ''} na pasta de trabalho da tarefa.`
                : 'Começa uma sessão nova com o resumo da tarefa no Notion.'}
        </p>
        {!activeRunId && !flowRunning && (
          <Button size="xs" variant="ghost" onClick={onNewSession}>
            Nova sessão…
          </Button>
        )}
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
    </div>
  )
}
