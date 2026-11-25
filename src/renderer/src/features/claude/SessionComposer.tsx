import { useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/Spinner'
import { cn } from '@/lib/utils'
import type { AgentBadge } from '../../../../shared/agent'
import type { CatalogCommand, TaskRunsState } from '../../../../shared/agent-run'
import { runtimeLabel, type RuntimeChoice } from '../../../../shared/agent-runtime'
import { Alert } from '../../components/Alert'
import {
  ClaudeLogo,
  CloseIcon,
  EditIcon,
  ForkIcon,
  PaperclipIcon,
  SendIcon,
  StopIcon
} from '../../components/icons'
import { HANDOFF_TEXT } from '../../../../shared/handoff'
import { DRAFT_TEXT, type ComposerDraft } from './composer-draft'
import { formatBytes } from '../../lib/format'
import { ATTACHMENT_ACCEPT } from '../../../../shared/attachments'
import { checkNewAttachments, type PendingAttachment } from './attachments-ui'
import { RuntimePicker, useSupportsEffort } from './RuntimePicker'
import { isMac } from '../../lib/platform'
import { useTaskView } from '../task/task-view'
import { useCatalog } from './useCatalog'
import { ipcResult } from '../../lib/ipc'

const SEND_KEY = `${isMac() ? '⌘' : 'Ctrl'} ⏎ enviar`

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
 * Como no Claude Code, a mensagem nunca espera: com o Claude ou o piloto automático trabalhando,
 * ela interrompe o turno e a sessão continua com ela; com o fluxo esperando uma escolha, citar a
 * opção (ex.: TASK-5) escolhe. Sem texto, o botão é "Parar".
 */
export function SessionComposer({
  projectId,
  taskId,
  agent,
  state,
  flowRunning,
  autopilotStep = null,
  onSent,
  onNewSession,
  onContinueInClaude,
  continuing = false
}: {
  projectId: string
  taskId: string
  agent: AgentBadge | null
  state: TaskRunsState | null
  /** Um passo de fluxo está rodando (ou vai começar sozinho): a mensagem interrompe e segue. */
  flowRunning: boolean
  autopilotStep?: string | null
  onSent(state: TaskRunsState): void
  onNewSession(): void
  /** Fase 2: pausa o Orkio e leva esta sessão para o terminal ("Continuar no Claude"). */
  onContinueInClaude?(): void
  continuing?: boolean
}): React.JSX.Element {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [wantsCatalog, setWantsCatalog] = useState(false)
  const [runtime, setRuntime] = useState<Partial<RuntimeChoice>>({})
  const supportsEffort = useSupportsEffort()
  const [attachments, setAttachments] = useState<PendingAttachment[]>([])
  const [attachError, setAttachError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)
  // O campo é da tela da tarefa: "Pedir ajuste…" no gate leva até ele.
  const { setComposer, draft, clearDraft } = useTaskView()
  // Fase 2: "Editar mensagem"/"Ramificar daqui": a próxima mensagem sai daquele ponto. Cada clique
  // é um rascunho novo (outro objeto): o campo o adota uma vez, sem efeito (ajuste no render).
  const [fork, setFork] = useState<ComposerDraft | null>(null)
  const [adopted, setAdopted] = useState<ComposerDraft | null>(null)
  if (draft && draft !== adopted) {
    setAdopted(draft)
    setFork(draft)
    setText(draft.text)
    setError(null)
  }
  const fileInput = useRef<HTMLInputElement>(null)
  const nextKey = useRef(0)

  const activeRunId = state?.activeRunId ?? null
  const latest = state?.runs[0] ?? null
  const resumes = !!latest?.hasSession
  const who = agent?.name ?? 'o Claude Code'

  const slash = /^\/(\S*)$/.exec(text)
  const typed = slash ? slash[1]! : null
  // O catálogo só é lido quando você digita "/" pela primeira vez.
  if (typed !== null && !wantsCatalog) setWantsCatalog(true)
  const { groups } = useCatalog(wantsCatalog ? projectId : null, taskId)
  const catalog = useMemo(
    () => (wantsCatalog && groups ? groups.flatMap((g) => g.commands) : null),
    [wantsCatalog, groups]
  )
  const suggestions = useMemo(
    () => (typed !== null && catalog ? matchCommands(catalog, typed) : []),
    [typed, catalog]
  )

  const working = flowRunning || !!activeRunId

  const addFiles = (list: FileList | null): void => {
    const files = list ? Array.from(list) : []
    if (files.length === 0) return
    const problem = checkNewAttachments(
      attachments.map((a) => a.file),
      files
    )
    setAttachError(problem)
    if (problem) return
    setAttachments((cur) => [
      ...cur,
      ...files.map((file) => ({ key: `a${nextKey.current++}`, file }))
    ])
  }

  const send = async (): Promise<void> => {
    const message = text.trim()
    if (!message || sending) return
    setSending(true)
    setError(null)
    const sentAttachments: { name: string; mime: string; data: Uint8Array }[] = []
    for (const { file } of attachments) {
      try {
        sentAttachments.push({
          name: file.name,
          mime: file.type,
          data: new Uint8Array(await file.arrayBuffer())
        })
      } catch {
        setError(`Não foi possível ler o arquivo ${file.name}.`)
        setSending(false)
        return
      }
    }
    const r = await ipcResult(() =>
      window.orkio.claude.send({
        projectId,
        taskId,
        text: message,
        ...(Object.keys(runtime).length > 0 ? { runtime } : {}),
        ...(sentAttachments.length > 0 ? { attachments: sentAttachments } : {}),
        ...(fork ? { fork: fork.fork } : {})
      })
    )
    setSending(false)
    if (r.ok) {
      setText('')
      setRuntime({})
      setAttachments([])
      setAttachError(null)
      setFork(null)
      clearDraft()
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
      {fork && (
        <div
          role="status"
          data-testid="composer-fork"
          className="flex min-w-0 items-center gap-2 rounded-lg border border-border-soft bg-surface px-3 py-1.5 text-xs"
        >
          {fork.kind === 'edit' ? (
            <EditIcon aria-hidden="true" className="size-3.5 shrink-0 text-subtle-foreground" />
          ) : (
            <ForkIcon aria-hidden="true" className="size-3.5 shrink-0 text-subtle-foreground" />
          )}
          <span className="min-w-0 flex-1 truncate text-muted-foreground">
            <span className="text-foreground">{DRAFT_TEXT[fork.kind]}</span>{' '}
            <span title={fork.excerpt}>“{fork.excerpt}”</span> · {DRAFT_TEXT.files}
          </span>
          <Button
            size="xs"
            variant="ghost"
            onClick={() => {
              setFork(null)
              clearDraft()
              if (fork.kind === 'edit') setText('')
            }}
          >
            Cancelar
          </Button>
        </div>
      )}
      <div
        className={cn(
          'flex flex-col gap-1.5 rounded-[10px] border border-border bg-card py-1.5 pr-1.5 pl-3 focus-within:border-ring',
          dragging && 'border-brand bg-brand-tint'
        )}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes('Files')) return
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false)
        }}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          addFiles(e.dataTransfer.files)
        }}
      >
        {attachments.length > 0 && (
          <ul aria-label="Anexos da mensagem" className="flex flex-wrap gap-1.5 pr-1.5">
            {attachments.map((a) => (
              <li
                key={a.key}
                className="flex max-w-full items-center gap-1.5 rounded-md border border-border-soft bg-muted py-0.5 pr-0.5 pl-2 text-xs"
              >
                <span className="min-w-0 truncate text-foreground">{a.file.name}</span>
                <span className="shrink-0 text-subtle-foreground">{formatBytes(a.file.size)}</span>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label={`Remover ${a.file.name}`}
                  onClick={() => {
                    setAttachments((cur) => cur.filter((x) => x.key !== a.key))
                    setAttachError(null)
                  }}
                >
                  <CloseIcon className="size-3" />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-end gap-2">
          <textarea
            ref={(el) => {
              ref.current = el
              setComposer(el)
            }}
            aria-label={`Mensagem para ${who}`}
            placeholder={
              working
                ? `Escreva para interromper e mudar o rumo de ${who}…`
                : `Escreva para ${who}… ( / para comandos)`
            }
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            className="field-sizing-content max-h-48 min-h-7 min-w-0 flex-1 resize-none bg-transparent py-1 text-sm outline-none placeholder:text-subtle-foreground disabled:cursor-not-allowed"
          />
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            accept={ATTACHMENT_ACCEPT}
            data-testid="attach-input"
            onChange={(e) => {
              addFiles(e.target.files)
              e.target.value = ''
            }}
          />
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Anexar arquivo"
            title="Anexar imagem, PDF, Markdown ou texto"
            className="mb-0.5 shrink-0"
            onClick={() => fileInput.current?.click()}
          >
            <PaperclipIcon />
          </Button>
          <RuntimePicker
            value={runtime}
            onChange={setRuntime}
            supportsEffort={supportsEffort}
            inheritLabel={
              agent
                ? agent.model !== undefined
                  ? `Do agente: ${runtimeLabel({
                      model: agent.model === 'default' ? null : agent.model,
                      effort: agent.effort ?? null
                    })}`
                  : 'Do agente'
                : 'Padrão do Claude Code'
            }
            {...(flowRunning ? { title: 'No piloto automático vale o modelo do passo.' } : {})}
            className="mb-1 shrink-0"
          />
          {(!activeRunId || text.trim()) && (
            <span className="mb-2 shrink-0 font-mono text-2xs text-subtle-foreground">
              {SEND_KEY}
            </span>
          )}
          {activeRunId && !text.trim() ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void window.orkio.claude.cancel(activeRunId)}
            >
              <StopIcon />
              Parar
            </Button>
          ) : (
            <Button size="sm" disabled={!text.trim() || sending} onClick={() => void send()}>
              {sending ? <Spinner /> : <SendIcon />}
              Enviar
            </Button>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-xs text-subtle-foreground" data-testid="session-context">
          {flowRunning
            ? `Piloto automático${autopilotStep ? `: ${autopilotStep}` : ''}. Uma mensagem aqui interrompe o passo e ele continua com ela.`
            : activeRunId
              ? 'O Claude está trabalhando. Uma mensagem aqui interrompe o turno e a sessão continua com ela.'
              : resumes
                ? `Continua a sessão${latest?.command ? ` de /${latest.command}` : ''} na pasta de trabalho da tarefa.`
                : 'Começa uma sessão nova com o resumo da tarefa no Notion.'}
        </p>
        {onContinueInClaude && resumes && (
          <Button
            size="xs"
            variant="ghost"
            title={HANDOFF_TEXT.startHint}
            disabled={continuing}
            onClick={onContinueInClaude}
          >
            <ClaudeLogo aria-hidden="true" />
            {continuing ? 'Abrindo…' : HANDOFF_TEXT.start}
          </Button>
        )}
        {!activeRunId && !flowRunning && (
          <Button size="xs" variant="ghost" onClick={onNewSession}>
            Nova sessão…
          </Button>
        )}
      </div>
      {attachError && <Alert tone="danger">{attachError}</Alert>}
      {error && <Alert tone="danger">{error}</Alert>}
    </div>
  )
}
