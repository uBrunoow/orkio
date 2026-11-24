import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible'
import { Timestamp } from '@/components/Timestamp'
import type { AgentBadge } from '../../../../shared/agent'
import type { AgentRunView, RunLogEvent, RunSummary } from '../../../../shared/agent-run'
import { StatusToken } from '../../components/StatusToken'
import { AutomationIcon, ClaudeLogo, DiffIcon, ReadIcon, UserIcon } from '../../components/icons'
import type { FlowStepOrigin } from '../task-flows/flow-plan'
import { BacklogDocumentView } from '../alva/BacklogDocumentView'
import { formatDuration, formatUsd, plural } from '../../lib/format'
import { AgentAvatar } from '../agents/AgentAvatar'
import { CollapsibleHeader } from '../../components/CollapsibleHeader'
import { RunTranscript } from './RunTranscript'
import { buildTranscript } from './run-transcript'
import { RUN_STATUS } from '../../lib/status-text'
import { backlogDocumentOf } from '../../../../shared/alva'
import { TaskDiffView } from '../task/TaskDiffView'
import { useTaskView } from '../task/task-view'

export function RunBlock({
  run,
  agent,
  liveLog,
  onRerun,
  focused = false,
  showDocument = false,
  changesOpen = false,
  origin = null
}: {
  run: AgentRunView
  /**
   * Passo de fluxo que disparou esta execução: em vez de "Você", o turno é do piloto automático
   * (fluxo, passo N de M e o comando que ele mandou), como numa sessão dirigida pelo Orkio.
   */
  origin?: FlowStepOrigin | null
  agent: AgentBadge | null
  /** Log ao vivo (só para a execução mais recente, vindo do `useTaskRuns`). */
  liveLog: readonly RunLogEvent[] | null
  /** "Rodar de novo": abre a nova sessão com o mesmo modo, comando e texto (só sem nada rodando). */
  onRerun?: () => void
  focused?: boolean
  /**
   * Execução que criou/atualizou a spec ou o plano (alva-flow): mostra a task do Backlog.md logo
   * abaixo da conversa (aberta na mais recente; as anteriores recolhidas, porque é o mesmo arquivo).
   */
  showDocument?: boolean | 'open'
  changesOpen?: boolean
}): React.JSX.Element {
  const canOpenPr = useTaskView().openPr.available
  const [loaded, setLoaded] = useState<RunLogEvent[] | null>(null)
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [focused])
  const live = run.status === 'running' || run.status === 'queued'
  useEffect(() => {
    if (liveLog) return
    let active = true
    void window.orkio.claude
      .readLog(run.id)
      .catch(() => [])
      .then((events) => {
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
    run.endedAt ? formatDuration(Date.parse(run.endedAt) - Date.parse(run.startedAt)) : null,
    run.costUsd !== null ? formatUsd(run.costUsd) : null
  ]
    .filter(Boolean)
    .join(' · ')
  const youSaid = !origin && run.mode === 'prompt' && run.text ? run.text : null
  const autopilotSaid = origin
    ? [run.command ? `/${run.command}` : null, run.text].filter(Boolean).join(' ')
    : null

  return (
    <article
      ref={ref}
      aria-label={`${who}${run.command ? ` · /${run.command}` : ''} · ${RUN_STATUS[run.status].label}`}
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
              <StatusToken {...RUN_STATUS[run.status]} data-testid="run-status" />
              {meta && <span className="tabular font-mono text-2xs">{meta}</span>}
            </span>
          </div>

          <RunTranscript items={items} openPr={canOpenPr} />

          {showDocument && !live && (
            <RunDocument command={run.command ?? ''} defaultOpen={showDocument === 'open'} />
          )}

          {run.summary && !live && <RunChanges summary={run.summary} defaultOpen={changesOpen} />}

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

function RunDocument({
  command,
  defaultOpen
}: {
  command: string
  defaultOpen: boolean
}): React.JSX.Element {
  const [open, setOpen] = useState(defaultOpen)
  const what = backlogDocumentOf(command) === 'plan' ? 'Plano' : 'Spec'
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
          {open && <BacklogDocumentView />}
        </CollapsibleContent>
      </Collapsible>
    </section>
  )
}

function RunChanges({
  summary,
  defaultOpen
}: {
  summary: RunSummary
  defaultOpen: boolean
}): React.JSX.Element {
  const [open, setOpen] = useState(defaultOpen && summary.files.length > 0)
  const [showDiff, setShowDiff] = useState(false)
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
          <Button size="sm" variant="ghost" onClick={() => setShowDiff((v) => !v)}>
            <DiffIcon />
            {showDiff ? 'Esconder o diff' : 'Ver o diff da tarefa'}
          </Button>
        </div>
        {showDiff && <TaskDiffView label="Diff da tarefa" />}
      </CollapsibleContent>
    </Collapsible>
  )
}
