import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible'
import { Timestamp } from '@/components/Timestamp'
import type { AgentBadge } from '../../../../shared/agent'
import type { AgentRunView, RunLogEvent, RunSummary } from '../../../../shared/agent-run'
import { StatusToken, toneOf } from '../../components/StatusToken'
import { Alert } from '../../components/Alert'
import { DiffView } from '../../components/DiffView'
import { AutomationIcon, ClaudeLogo, DiffIcon, ReadIcon, UserIcon } from '../../components/icons'
import type { FlowStepOrigin } from '../task-flows/flow-plan'
import { BacklogDocumentView } from '../alva/BacklogDocumentView'
import { formatUsd, plural } from '../../lib/format'
import { AgentAvatar } from '../agents/AgentAvatar'
import { CollapsibleHeader } from '../board/TaskDetails'
import { RunTranscript } from './RunTranscript'
import { buildTranscript } from './run-transcript'
import { STATUS_COLOR, STATUS_LABEL } from './run-status'

/** Duração curta: "40 s", "4 min", "1 h 12 min". */
export function shortDuration(start: string, end: string | null): string | null {
  if (!end) return null
  const s = Math.max(0, Math.round((Date.parse(end) - Date.parse(start)) / 1000))
  if (s < 60) return `${s} s`
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min`
  return `${Math.floor(m / 60)} h ${m % 60} min`
}

/**
 * Uma execução do Claude Code dentro da sessão da tarefa: quem falou (agente ou Claude Code), o
 * comando, o estado, a mensagem que você mandou (prompt) e a conversa inteira (respostas em
 * markdown, ferramentas agrupadas numa frase). Depois dela, o que ela produziu: a spec ou o plano
 * (alva-flow) e as mudanças no código (arquivos, commits, diff).
 */
export function RunBlock({
  run,
  agent,
  liveLog,
  onRerun,
  focused = false,
  projectId,
  showDocument = false,
  changesOpen = false,
  origin = null,
  canOpenPr = false
}: {
  run: AgentRunView
  /**
   * Passo de fluxo que disparou esta execução: em vez de "Você", o turno é do piloto automático
   * (fluxo, passo N de M e o comando que ele mandou), como numa sessão dirigida pelo Orkio.
   */
  origin?: FlowStepOrigin | null
  /** Agente da tarefa: se foi ele que rodou, mostra o avatar e o nome. */
  agent: AgentBadge | null
  /** Log ao vivo (só para a execução mais recente, vindo do `useTaskRuns`). */
  liveLog: readonly RunLogEvent[] | null
  /** "Rodar de novo": abre a nova sessão com o mesmo modo, comando e texto (só sem nada rodando). */
  onRerun?: () => void
  /** Pedido para mostrar esta execução ("Ver a sessão do passo"): abre e rola até ela. */
  focused?: boolean
  projectId: string
  /**
   * Execução que criou/atualizou a spec ou o plano (alva-flow): mostra a task do Backlog.md logo
   * abaixo da conversa (aberta na mais recente; as anteriores recolhidas, porque é o mesmo arquivo).
   */
  showDocument?: boolean | 'open'
  /** Mudanças (arquivos, commits, diff) abertas por padrão (a execução mais recente que mudou código). */
  changesOpen?: boolean
  /** A tarefa pode abrir PR agora (sem PR aberta): recibos de push/gh bloqueado ganham "Abrir PR". */
  canOpenPr?: boolean
}): React.JSX.Element {
  const [loaded, setLoaded] = useState<RunLogEvent[] | null>(null)
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [focused])
  const live = run.status === 'running' || run.status === 'queued'
  // Execuções anteriores: lê o log uma vez para mostrar a última fala.
  useEffect(() => {
    if (liveLog) return
    let active = true
    void window.orkio.claude.readLog(run.id).then((events) => {
      if (active) setLoaded(events)
    })
    return () => {
      active = false
    }
  }, [run.id, liveLog, run.status])
  const items = useMemo(
    () => buildTranscript(liveLog ?? loaded ?? [], live, run.status),
    [liveLog, loaded, live, run.status]
  )
  const byAgent = !!agent && !!run.agentKey && run.agentKey === agent.key
  const who = byAgent ? agent.name : 'Claude Code'
  const meta = [
    shortDuration(run.startedAt, run.endedAt),
    run.costUsd !== null ? formatUsd(run.costUsd) : null
  ]
    .filter(Boolean)
    .join(' · ')
  const youSaid = !origin && run.mode === 'prompt' && run.text ? run.text : null
  // O que o piloto mandou: o comando e os argumentos (ou o texto, num passo em modo prompt).
  const autopilotSaid = origin
    ? [run.command ? `/${run.command}` : null, run.text].filter(Boolean).join(' ')
    : null

  return (
    <article
      ref={ref}
      aria-label={`${who}${run.command ? ` · /${run.command}` : ''} · ${STATUS_LABEL[run.status]}`}
      data-testid="session-run"
      data-run-id={run.id}
      className="flex scroll-mt-4 flex-col gap-4"
    >
      {youSaid && (
        <div className="ml-auto flex max-w-[70%] flex-col gap-1 rounded-[10px] border border-border bg-muted px-3 py-2.5">
          <p className="text-sm break-words whitespace-pre-wrap">{youSaid}</p>
          <p className="flex items-center gap-1 text-[11.5px] text-subtle-foreground">
            <UserIcon className="size-3" />
            Você · <Timestamp value={run.startedAt} />
          </p>
        </div>
      )}
      {origin && (
        <div
          data-testid="autopilot-turn"
          className="ml-auto flex max-w-[80%] flex-col gap-1 rounded-[10px] border border-border bg-muted px-3 py-2.5"
        >
          {autopilotSaid && (
            <code className="line-clamp-3 font-mono text-xs break-words text-foreground">
              {autopilotSaid}
            </code>
          )}
          <p className="flex flex-wrap items-center gap-1 text-[11.5px] text-subtle-foreground">
            <AutomationIcon className="size-3" />
            <span className="font-medium text-muted-foreground">Piloto automático</span> ·{' '}
            {origin.flowName} · passo {origin.position} de {origin.total}: {origin.stepName}
            {origin.visit > 1 ? ` (${origin.visit}ª vez)` : ''} ·{' '}
            <Timestamp value={run.startedAt} />
          </p>
        </div>
      )}
      <div className="flex min-w-0 gap-2.5">
        <span className="mt-px flex size-6 shrink-0 items-center justify-center">
          {byAgent ? (
            <AgentAvatar name={agent.name} color={agent.color} seed={agent.key} />
          ) : (
            <span className="flex size-6 items-center justify-center rounded-[7px] border border-border-soft bg-card text-brand">
              <ClaudeLogo className="size-3.5" />
            </span>
          )}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5 text-[11.5px] text-subtle-foreground">
            <span className="font-medium text-muted-foreground">{who}</span>
            {run.command && !origin && <span className="font-mono">· /{run.command}</span>}
            {!youSaid && !origin && (
              <span>
                · <Timestamp value={run.startedAt} />
              </span>
            )}
            <span className="ml-auto flex items-center gap-2 pl-2">
              <StatusToken
                tone={toneOf(STATUS_COLOR[run.status])}
                label={STATUS_LABEL[run.status]}
                data-testid="run-status"
              />
              {meta && <span className="tabular font-mono text-2xs">{meta}</span>}
            </span>
          </div>

          <RunTranscript
            items={items}
            {...(canOpenPr ? { openPr: { projectId, taskId: run.taskId } } : {})}
          />

          {showDocument && !live && (
            <RunDocument
              projectId={projectId}
              taskId={run.taskId}
              command={run.command ?? ''}
              defaultOpen={showDocument === 'open'}
              refreshKey={run.endedAt ?? ''}
            />
          )}

          {run.summary && !live && (
            <RunChanges
              projectId={projectId}
              taskId={run.taskId}
              summary={run.summary}
              defaultOpen={changesOpen}
            />
          )}

          {onRerun && !live && (
            <div>
              <Button size="sm" variant="ghost" onClick={onRerun}>
                Rodar de novo
              </Button>
            </div>
          )}
        </div>
      </div>
    </article>
  )
}

/** Spec ou plano (task do Backlog.md) logo depois da execução que o criou ou atualizou. */
function RunDocument({
  projectId,
  taskId,
  command,
  defaultOpen,
  refreshKey
}: {
  projectId: string
  taskId: string
  command: string
  defaultOpen: boolean
  refreshKey: string
}): React.JSX.Element {
  const [open, setOpen] = useState(defaultOpen)
  const what = /plan$/.test(command) ? 'Plano' : 'Spec'
  return (
    <section
      aria-label={`${what} criado(a) por /${command}`}
      data-testid="run-document"
      className="rounded-lg border border-border-soft bg-surface"
    >
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleHeader open={open} className="px-2.5 py-2 text-xs">
          <ReadIcon className="size-3.5 text-subtle-foreground" />
          <span className="font-medium text-foreground">
            {what === 'Plano' ? 'Plano no Backlog.md' : 'Spec no Backlog.md'}
          </span>
          <span className="text-subtle-foreground">versão atual do arquivo</span>
        </CollapsibleHeader>
        <CollapsibleContent className="border-t border-border-soft px-3 py-3">
          {open && (
            <BacklogDocumentView
              projectId={projectId}
              taskId={taskId}
              refreshKey={refreshKey.length}
            />
          )}
        </CollapsibleContent>
      </Collapsible>
    </section>
  )
}

/** O que a execução mudou: arquivos, commits, testes e o diff da tarefa. */
function RunChanges({
  projectId,
  taskId,
  summary,
  defaultOpen
}: {
  projectId: string
  taskId: string
  summary: RunSummary
  defaultOpen: boolean
}): React.JSX.Element {
  const [open, setOpen] = useState(defaultOpen && summary.files.length > 0)
  const [diff, setDiff] = useState<{
    diff: string
    truncated: boolean
    untracked: string[]
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const loadDiff = async (): Promise<void> => {
    if (diff) {
      setDiff(null)
      return
    }
    const r = await window.orkio.claude.diff(projectId, taskId)
    if (r.ok) {
      setDiff(r.value)
      setError(null)
    } else setError(r.error.message)
  }
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="rounded-lg border border-border-soft bg-surface"
    >
      <CollapsibleHeader open={open} className="px-2.5 py-2 text-xs text-muted-foreground">
        <span data-testid="run-summary">
          {plural(summary.files.length, 'arquivo alterado', 'arquivos alterados')} ·{' '}
          {plural(summary.commits.length, 'commit', 'commits')} ·{' '}
          {summary.tests.length > 0 ? `testes: ${summary.tests.join('; ')}` : 'nenhum teste rodado'}
        </span>
      </CollapsibleHeader>
      <CollapsibleContent className="flex flex-col gap-2.5 border-t border-border-soft px-2.5 py-2.5">
        {summary.files.length > 0 && (
          <ul
            aria-label="Arquivos alterados"
            className="flex flex-col gap-0.5 font-mono text-xs text-muted-foreground"
          >
            {summary.files.slice(0, 50).map((f) => (
              <li key={f} className="truncate">
                {f}
              </li>
            ))}
          </ul>
        )}
        {summary.commits.length > 0 && (
          <ul aria-label="Commits" className="flex flex-col gap-0.5 text-xs">
            {summary.commits.map((c) => (
              <li key={c.hash} className="flex min-w-0 items-baseline gap-2">
                <code className="shrink-0 font-mono text-subtle-foreground">{c.hash}</code>
                <span className="min-w-0 truncate">{c.subject}</span>
              </li>
            ))}
          </ul>
        )}
        <div>
          <Button size="sm" variant="ghost" onClick={() => void loadDiff()}>
            <DiffIcon />
            {diff ? 'Esconder o diff' : 'Ver o diff da tarefa'}
          </Button>
        </div>
        {error && <Alert tone="danger">{error}</Alert>}
        {diff && (
          <DiffView
            label="Diff da tarefa"
            diff={diff.diff}
            truncated={diff.truncated}
            untracked={diff.untracked}
          />
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}
