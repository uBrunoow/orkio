import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { CheckboxField, Field, RadioListField, TextAreaField, TextField } from '@/components/form'
import { Spinner } from '@/components/Spinner'
import { cn } from '@/lib/utils'
import { StatusDot, StatusToken, toneOf } from '../../components/StatusToken'
import type { RunSummary } from '../../../../shared/agent-run'
import { ALVA_TEMPLATE_IDS } from '../../../../shared/alva-templates'
import type { TaskPullRequest } from '../../../../shared/task-signals'
import { isReviewer } from '../../../../shared/github-names'
import {
  isPromptStep,
  MAX_PROMPT_CHARS,
  type ActionConfirm,
  type ConfirmReview,
  type FlowRunView,
  type FlowStepStatus,
  type GateShow,
  type StageFlow
} from '../../../../shared/task-flow'
import { Alert } from '../../components/Alert'
import {
  AutomationIcon,
  ColumnExpandIcon,
  ExternalLinkIcon,
  PlayIcon
} from '../../components/icons'
import { DiffView } from '../../components/DiffView'
import { describeFlowProblem } from '../../../../shared/flow-problem'
import { FlowProblemCard } from './FlowProblemCard'
import { BacklogDocumentView } from '../alva/BacklogDocumentView'
import { replyChips } from '../task/reply-chips'
import { finalText, flowPlan, gateOutcomes, gateResultRunId, planProgress } from './flow-plan'
import { MarkdownText } from '../../components/MarkdownText'
import { formatUsd, plural } from '../../lib/format'
import { RUN_STATUS } from './run-status'
import { PLAN_TRIGGER_ATTR } from '../task/task-phases'

const STEP_STATUS: Record<FlowStepStatus, string> = {
  running: 'rodando',
  waiting: 'esperando aprovação',
  ok: 'concluído',
  failed: 'falhou',
  cancelled: 'cancelado',
  skipped: 'pulado',
  interrupted: 'interrompido',
  approved: 'aprovado',
  rejected: 'recusado',
  revised: 'ajustes pedidos'
}

/** O que está trabalhando agora na tarefa (rodapé "Trabalhando há…" do painel). */
export interface TaskActivity {
  who: string
  what: string | null
  /** ISO 8601: quando o passo atual começou. */
  since: string
}

/** "passo 3 de 7": o passo atual entre os que contam (sem os que o fluxo não precisou). */
function progressText(run: FlowRunView): string {
  const plan = flowPlan(run)
  const counted = plan.filter((p) => p.state !== 'unreached')
  const index = counted.findIndex(
    (p) => p.state === 'current' || p.state === 'waiting' || p.state === 'failed'
  )
  const n = index === -1 ? planProgress(plan).done : index + 1
  return `passo ${Math.min(n, counted.length)} de ${counted.length}`
}

/** "4 passos · 3 ok · 1 falhou": resumo da linha do tempo quando ela está recolhida. */
function stepSummary(history: FlowRunView['history']): string {
  const counts = new Map<string, number>()
  for (const h of history)
    counts.set(STEP_STATUS[h.status], (counts.get(STEP_STATUS[h.status]) ?? 0) + 1)
  const total = history.length === 1 ? '1 passo' : `${history.length} passos`
  return [total, ...[...counts].map(([label, n]) => `${n} ${label}`)].join(' · ')
}

/**
 * Fluxo da tarefa (5A), no fim da sessão: estado, passos (recolhidos), gate (aprovar/recusar com
 * diff ou resumo), pausas (retomar/pular/cancelar) e a decisão quando a tarefa sai da etapa. A
 * conversa do passo atual (Claude Code) aparece logo acima, na sessão.
 */
const CI_LABEL = {
  success: { label: 'CI passou', color: 'green' },
  failure: { label: 'CI falhou', color: 'red' },
  pending: { label: 'CI rodando', color: 'yellow' }
} as const

export function TaskFlowSection({
  projectId,
  taskId,
  stageId,
  pr = null,
  onActivityChange,
  onWaitingChange,
  onOpenRun,
  onLiveChange,
  onRunsChange,
  onShowPlan
}: {
  projectId: string
  taskId: string
  stageId: string | null
  /** PR da tarefa (sinais da 2D): estado do CI e botão do fluxo de CI vermelho. */
  pr?: TaskPullRequest | null
  /** Passo rodando agora (ou null): o painel mostra "Trabalhando há…". */
  onActivityChange?: (activity: TaskActivity | null) => void
  /** 1 quando o fluxo espera uma decisão sua (gate, escolha, saída da etapa). */
  onWaitingChange?: (count: number) => void
  /** Abre a sessão (log) de uma execução do Claude Code desta tarefa. */
  onOpenRun?: (runId: string) => void
  /** O fluxo da tarefa está em andamento (o Claude Code manual fica bloqueado). */
  onLiveChange?: (live: boolean) => void
  /** Execuções do fluxo da tarefa (mais nova primeiro): a sessão mostra de que passo veio cada turno. */
  onRunsChange?: (runs: readonly FlowRunView[]) => void
  /** Abre o plano do piloto automático (popover da barra de fases, no topo da tela). */
  onShowPlan?: () => void
}): React.JSX.Element | null {
  // Passos recolhidos enquanto o fluxo roda ou espera você (a decisão vem primeiro); abertos no
  // fim. Clicar no resumo vale até a tarefa mudar.
  const [stepsOpen, setStepsOpen] = useState<boolean | null>(null)
  const [runs, setRuns] = useState<FlowRunView[] | null>(null)
  const [binding, setBinding] = useState<(StageFlow & { flowName: string }) | null>(null)
  const [pending, setPending] = useState<Record<string, string>>({})
  const [ciFlow, setCiFlow] = useState<{ id: string; name: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let active = true
    void window.orkio.taskFlows.runs(taskId).then((r) => {
      if (active) setRuns(r)
    })
    void window.orkio.taskFlows.getProject(projectId).then((r) => {
      if (!active || !r.ok) return
      const b = r.value.bindings.find((x) => x.stageId === stageId && x.enabled)
      const flow = b ? r.value.flows.find((f) => f.id === b.flowId) : null
      setBinding(b && flow ? { ...b, flowName: flow.name } : null)
      setPending(
        Object.fromEntries(r.value.actions.filter((a) => a.pending).map((a) => [a.id, a.pending!]))
      )
      const ci = r.value.flows.find((f) => f.id === ALVA_TEMPLATE_IDS.ci)
      setCiFlow(ci ? { id: ci.id, name: ci.name } : null)
    })
    return () => {
      active = false
    }
  }, [projectId, taskId, stageId, tick])

  useEffect(
    () =>
      window.orkio.taskFlows.onChanged((e) => {
        if (e.taskId === taskId) setTick((n) => n + 1)
      }),
    [taskId]
  )

  const act = useCallback(
    async (fn: () => Promise<{ ok: boolean; error?: { message: string } }>) => {
      setBusy(true)
      const r = await fn()
      setBusy(false)
      setError(r.ok ? null : (r.error?.message ?? 'Algo deu errado.'))
      setTick((n) => n + 1)
    },
    []
  )

  const run = runs?.[0] ?? null
  const currentStepView = run
    ? [...run.history].reverse().find((h) => h.stepId === run.currentStep && !h.endedAt)
    : undefined
  const activeWho = run?.status === 'running' ? (run.agent?.name ?? 'Fluxo') : null
  const activeWhat = run?.steps.find((s) => s.id === run.currentStep)?.name ?? null
  const activeSince = run ? (currentStepView?.startedAt ?? run.startedAt) : null
  const waitingYou =
    run &&
    (run.status === 'waiting_gate' ||
      run.status === 'awaiting_decision' ||
      (run.status === 'paused' && run.pauseReason === 'needs_choice'))
      ? 1
      : 0
  useEffect(() => {
    onActivityChange?.(
      activeWho && activeSince ? { who: activeWho, what: activeWhat, since: activeSince } : null
    )
  }, [activeWho, activeWhat, activeSince, onActivityChange])
  useEffect(() => {
    onWaitingChange?.(waitingYou)
  }, [waitingYou, onWaitingChange])
  useEffect(() => () => onActivityChange?.(null), [onActivityChange])
  // Fluxo em andamento (rodando, esperando ou pausado): o Claude Code roda pelos passos dele.
  const liveNow = !!run && run.status !== 'finished' && run.status !== 'cancelled'
  useEffect(() => {
    onLiveChange?.(liveNow)
  }, [liveNow, onLiveChange])
  useEffect(() => () => onLiveChange?.(false), [onLiveChange])
  useEffect(() => {
    if (runs) onRunsChange?.(runs)
  }, [runs, onRunsChange])

  const openPr = pr && (pr.state === 'open' || pr.state === 'draft') ? pr : null
  if (!run && !binding && !openPr?.checks) return null
  const live = run && run.status !== 'finished' && run.status !== 'cancelled'
  const stepName = (id: string | null): string =>
    run?.steps.find((s) => s.id === id)?.name ?? id ?? ''
  const current = run?.steps.find((s) => s.id === run.currentStep) ?? null
  const problem = run ? describeFlowProblem(run) : null

  return (
    <section
      role="region"
      aria-label="Fluxo da tarefa"
      className="flex flex-col gap-3 border-t border-border-soft pt-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              role="img"
              aria-label="Piloto automático"
              tabIndex={0}
              className="inline-flex rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              <AutomationIcon className="text-muted-foreground" />
            </span>
          </TooltipTrigger>
          <TooltipContent className="max-w-64">
            Piloto automático: o Orkio manda cada passo para o Claude Code e segue sozinho. Ele para
            quando precisar de você.
          </TooltipContent>
        </Tooltip>
        <h3 className="text-sm font-medium">
          {run ? `Fluxo: ${run.flowName}${run.agent ? ` · ${run.agent.name}` : ''}` : 'Fluxo'}
        </h3>
        {run && (
          <StatusToken
            tone={
              run.status === 'finished' && run.result === 'rejected'
                ? 'danger'
                : toneOf(RUN_STATUS[run.status].color)
            }
            label={
              run.status === 'finished' && run.result === 'rejected'
                ? 'Recusado'
                : RUN_STATUS[run.status].label
            }
            data-testid="flow-status"
          />
        )}
        {run && live && (
          <>
            <span
              className="tabular text-xs text-muted-foreground"
              data-testid="autopilot-progress"
            >
              {progressText(run)}
            </span>
            {onShowPlan && (
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-xs"
                {...{ [PLAN_TRIGGER_ATTR]: '' }}
                onClick={onShowPlan}
              >
                Ver plano
              </Button>
            )}
          </>
        )}
      </div>

      {!live && binding && (
        <div className="flex">
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void act(() => window.orkio.taskFlows.start(projectId, taskId))}
          >
            {busy ? <Spinner /> : <PlayIcon />}
            {run ? 'Rodar fluxo de novo' : `Rodar fluxo “${binding.flowName}”`}
          </Button>
        </div>
      )}

      {openPr?.checks && (
        <div className="flex flex-wrap items-center gap-2">
          <StatusToken
            tone={toneOf(CI_LABEL[openPr.checks].color)}
            label={`${CI_LABEL[openPr.checks].label} (PR #${openPr.number})`}
            data-testid="pr-ci"
          />
          {openPr.checks === 'failure' && ciFlow && !live && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() =>
                void act(() => window.orkio.taskFlows.startById(projectId, taskId, ciFlow.id))
              }
            >
              {busy ? <Spinner /> : <PlayIcon />}
              Rodar fluxo CI vermelho
            </Button>
          )}
        </div>
      )}

      {run && run.history.length > 0 && (
        <Collapsible
          open={stepsOpen ?? !(live && run.status !== 'paused')}
          onOpenChange={setStepsOpen}
          className="flex flex-col gap-1.5"
        >
          <CollapsibleTrigger className="group flex w-fit items-center gap-1.5 rounded-sm text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40">
            <ColumnExpandIcon className="size-3.5 transition-transform group-data-[state=open]:rotate-90" />
            <span data-testid="flow-steps-summary">
              Histórico do fluxo: {stepSummary(run.history)}
            </span>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ul
              aria-label="Linha do tempo do fluxo"
              className="overflow-hidden rounded-lg border border-border-soft bg-card"
            >
              {run.history.map((h) => (
                <li
                  key={h.seq}
                  className="flex flex-col gap-0.5 border-b border-border-soft px-3 py-2 last:border-b-0"
                >
                  <span className="text-sm">{stepName(h.stepId)}</span>
                  <span className="text-xs text-muted-foreground">
                    {[
                      STEP_STATUS[h.status],
                      duration(h.startedAt, h.endedAt),
                      h.costUsd !== null ? formatUsd(h.costUsd) : '',
                      h.message ?? ''
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </li>
              ))}
            </ul>
          </CollapsibleContent>
        </Collapsible>
      )}

      {run?.status === 'running' && current?.type === 'claude_command' && (
        <p className="text-xs text-muted-foreground" data-testid="flow-running-step">
          {isPromptStep(current)
            ? `Rodando “${current.name}”${current.readOnly ? ' (só leitura)' : ''}. A conversa deste passo está logo acima.`
            : /:pr$/.test(current.command) && !/--comments/.test(current.args)
              ? 'Aguardando CI do GitHub: o /pr acompanha os checks até terminar (pode levar vários minutos).'
              : `Rodando /${current.command}. A conversa deste passo está logo acima.`}
        </p>
      )}

      {run?.status === 'waiting_gate' && current?.type === 'orkio_action' && run.confirm && (
        <ConfirmCard
          // Uma confirmação nova (push → pedir review) começa do zero, com os padrões dela.
          key={`${run.id}:${run.currentStep}:${run.confirm.title}`}
          info={run.confirm}
          busy={busy}
          onApprove={(values) =>
            void act(() => window.orkio.taskFlows.approve(run.id, values ?? undefined))
          }
          onReject={() => void act(() => window.orkio.taskFlows.reject(run.id))}
        />
      )}

      {run?.status === 'waiting_gate' && current?.type === 'orkio_action' && !run.confirm && (
        <WaitCard label="Ação pendente do fluxo" title={current.name}>
          <p className="text-sm text-muted-foreground">
            {pending[current.action] ?? 'Esta ação ainda não existe no Orkio.'}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={busy}
              onClick={() => void act(() => window.orkio.taskFlows.approve(run.id))}
            >
              {busy && <Spinner />}
              Já fiz, seguir
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void act(() => window.orkio.taskFlows.reject(run.id))}
            >
              Encerrar o fluxo
            </Button>
          </div>
        </WaitCard>
      )}

      {run?.status === 'paused' && run.pauseReason === 'needs_choice' && run.choice && (
        <ChoiceCard
          prompt={run.choice.prompt}
          options={run.choice.options}
          busy={busy}
          onChoose={(v) => void act(() => window.orkio.taskFlows.choose(run.id, v))}
        />
      )}

      {run?.status === 'waiting_gate' && current?.type === 'gate' && (
        <GateCard
          key={`${run.id}:${run.history.length}`}
          projectId={projectId}
          taskId={taskId}
          message={current.message}
          show={current.show}
          resultRunId={current.show === 'result' ? gateResultRunId(run) : null}
          revise={run.revise}
          reviseStep={stepName(current.revise?.step ?? null) || null}
          outcomes={gateOutcomes(run)}
          busy={busy}
          onApprove={() => void act(() => window.orkio.taskFlows.approve(run.id))}
          onReject={() => void act(() => window.orkio.taskFlows.reject(run.id))}
          onRevise={(text) =>
            void act(() => window.orkio.taskFlows.reviseGate(projectId, taskId, text))
          }
        />
      )}

      {run?.status === 'paused' &&
        (run.pauseReason === 'waiting_slot' || run.pauseReason === 'waiting_agent') && (
          <div className="flex flex-col items-start gap-2">
            <Alert tone="warning" className="self-stretch">
              {run.pauseReason === 'waiting_agent'
                ? `Aguardando ${run.agent?.name ?? 'o agente'} terminar outra tarefa (limite de fluxos ao mesmo tempo). Começa sozinho.`
                : 'Aguardando outro fluxo Alva deste projeto terminar (Docker e portas). Começa sozinho.'}
            </Alert>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void act(() => window.orkio.taskFlows.cancel(run.id))}
            >
              Cancelar fluxo
            </Button>
          </div>
        )}

      {run && problem && (
        <FlowProblemCard
          projectId={projectId}
          taskId={taskId}
          problem={problem}
          busy={busy}
          onResume={() => void act(() => window.orkio.taskFlows.resume(run.id))}
          onRerun={(stepId) => void act(() => window.orkio.taskFlows.rerunFrom(run.id, stepId))}
          onReply={(text) => void act(() => window.orkio.taskFlows.resumeWithReply(run.id, text))}
          onSkip={() => void act(() => window.orkio.taskFlows.skip(run.id))}
          onCancel={() => void act(() => window.orkio.taskFlows.cancel(run.id))}
          {...(onOpenRun ? { onOpenRun } : {})}
        />
      )}

      {run?.status === 'awaiting_decision' && (
        <WaitCard label="Decisão do fluxo" title="A tarefa saiu da etapa deste fluxo">
          <p className="text-sm text-muted-foreground">
            O passo atual termina, mas o fluxo só segue com a sua escolha.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() => void act(() => window.orkio.taskFlows.decideLeft(run.id, 'continue'))}
            >
              Deixar terminar
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void act(() => window.orkio.taskFlows.decideLeft(run.id, 'cancel'))}
            >
              Cancelar fluxo
            </Button>
          </div>
        </WaitCard>
      )}

      {(run?.status === 'running' || run?.status === 'waiting_gate') && (
        <div className="flex">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void act(() => window.orkio.taskFlows.cancel(run.id))}
          >
            Cancelar fluxo
          </Button>
        </div>
      )}
      {error && <Alert tone="danger">{error}</Alert>}
    </section>
  )
}

/**
 * Cartão "esperando você" (gate, ação pendente, escolha, decisão): fundo amarelo discreto, título
 * com o ponto de estado e as ações embaixo (mockup `.gate`).
 */
function WaitCard({
  label,
  title,
  children
}: {
  label: string
  title: React.ReactNode
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex flex-col gap-2 rounded-[10px] border border-warn-tint-border bg-warn-tint p-3.5"
    >
      <p className="flex items-center gap-2 font-medium">
        <StatusDot tone="warning" />
        <span className="min-w-0">{title}</span>
      </p>
      {children}
    </div>
  )
}

/** Gate de uma ação do Orkio (5C): o que vai acontecer (destino, commits, diff, revisores). */
function ConfirmCard({
  info,
  busy,
  onApprove,
  onReject
}: {
  info: ActionConfirm
  busy: boolean
  onApprove(values: string[] | null): void
  onReject(): void
}): React.JSX.Element {
  const [chosen, setChosen] = useState<string[]>(info.input?.selected ?? [])
  const [other, setOther] = useState('')
  const extra = other
    .split(/[\s,]+/)
    .map((v) => v.trim().replace(/^@/, ''))
    .filter(Boolean)
  const values = info.input ? [...new Set([...chosen, ...extra])] : null
  const invalid = values?.some((v) => !isReviewer(v)) ?? false
  const none = values !== null && values.length === 0
  return (
    <WaitCard label={info.title} title={info.title}>
      <p className="text-sm text-muted-foreground">{info.message}</p>
      {info.warning && <Alert tone="warning">{info.warning}</Alert>}
      {info.details.length > 0 && (
        <ul
          aria-label="Detalhes da ação"
          className="flex flex-col gap-1 rounded-lg border border-border-soft bg-card px-3 py-2"
        >
          {info.details.map((d) => (
            <li key={d.label} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <span className="w-28 shrink-0 text-xs text-muted-foreground">{d.label}</span>
              <span className="min-w-0 font-mono text-xs break-all">{d.value}</span>
            </li>
          ))}
        </ul>
      )}
      {info.review && <ReviewPreview review={info.review} />}
      {info.commits && info.commits.length > 0 && (
        <ul
          aria-label="Commits que vão para o GitHub"
          className="flex flex-col gap-1 rounded-lg border border-border-soft bg-card px-3 py-2"
        >
          {info.commits.map((c) => (
            <li key={c.hash} className="flex items-baseline gap-2">
              <code className="shrink-0 font-mono text-xs text-subtle-foreground">{c.hash}</code>
              <span className="min-w-0 truncate text-sm">{c.subject}</span>
            </li>
          ))}
        </ul>
      )}
      {info.stat && (
        <pre
          className="overflow-x-auto rounded-lg border border-border-soft bg-surface px-3 py-2 font-mono text-xs whitespace-pre text-muted-foreground"
          data-testid="confirm-stat"
        >
          <code>{info.stat}</code>
        </pre>
      )}
      {info.input && (
        <div role="group" aria-label={info.input.label} className="flex flex-col gap-1.5">
          <p className="text-sm font-medium">{info.input.label}</p>
          {info.input.options.map((o) => (
            <CheckboxField
              key={o}
              label={o}
              checked={chosen.includes(o)}
              onChange={(on) => setChosen((all) => (on ? [...all, o] : all.filter((x) => x !== o)))}
            />
          ))}
          {info.input.allowOther && (
            <TextField
              label="Outros (logins separados por vírgula)"
              value={other}
              onChange={setOther}
              error={invalid ? 'Use logins do GitHub (ou team:slug).' : undefined}
            />
          )}
        </div>
      )}
      {info.link && (
        <div className="flex">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void window.orkio.openExternal(info.link!.url)}
          >
            <ExternalLinkIcon />
            {info.link.label}
          </Button>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={busy || invalid || none} onClick={() => onApprove(values)}>
          {busy && <Spinner />}
          {info.approveLabel}
        </Button>
        <Button size="sm" variant="ghost" onClick={onReject}>
          Recusar e encerrar
        </Button>
        {none && (
          <span className="text-xs text-muted-foreground">Escolha pelo menos um revisor.</span>
        )}
      </div>
    </WaitCard>
  )
}

/**
 * Revisão a publicar como orkio[bot]: tipo, resumo e comentários de linha (Task 18), como texto
 * simples, exatamente como vão para a PR.
 */
function ReviewPreview({ review }: { review: ConfirmReview }): React.JSX.Element {
  const inDiff = review.comments.filter((c) => c.inDiff)
  const outside = review.comments.filter((c) => !c.inDiff)
  return (
    <section aria-label="Revisão a publicar" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span
          data-testid="review-event"
          className={cn(
            'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium',
            review.event === 'REQUEST_CHANGES'
              ? 'border-danger-tint-border bg-danger-tint text-danger'
              : 'border-border bg-muted text-muted-foreground'
          )}
        >
          {review.event === 'REQUEST_CHANGES' ? 'Pedir alterações' : 'Comentar'}
        </span>
        <span className="text-xs text-muted-foreground">como orkio[bot]</span>
      </div>
      {/* Texto exato que vai para a PR (sem renderizar markdown: links e tudo mais à vista). */}
      <pre
        role="region"
        aria-label="Resumo da revisão"
        className="max-h-80 overflow-y-auto rounded-lg border border-border-soft bg-card px-3 py-2 font-sans text-sm break-words whitespace-pre-wrap text-foreground"
      >
        {review.summary}
      </pre>
      {inDiff.length > 0 && (
        <ul
          aria-label="Comentários de linha"
          className="flex flex-col rounded-lg border border-border-soft bg-card"
        >
          {inDiff.map((c, i) => (
            <li
              key={`${c.path}:${c.line}:${i}`}
              className="flex flex-col gap-0.5 border-b border-border-soft px-3 py-2 last:border-b-0"
            >
              <code className="font-mono text-xs break-all text-subtle-foreground">
                {c.path}:{c.line}
              </code>
              <span className="text-sm break-words whitespace-pre-wrap">{c.body}</span>
            </li>
          ))}
        </ul>
      )}
      {outside.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <Alert tone="warning">
            {outside.length === 1
              ? '1 comentário está fora do diff da PR e não será publicado.'
              : `${outside.length} comentários estão fora do diff da PR e não serão publicados.`}
          </Alert>
          <ul
            aria-label="Comentários fora do diff"
            className="flex flex-col rounded-lg border border-border-soft bg-surface"
          >
            {outside.map((c, i) => (
              <li
                key={`${c.path}:${c.line}:${i}`}
                className="flex flex-col gap-0.5 border-b border-border-soft px-3 py-2 text-muted-foreground last:border-b-0"
              >
                <code className="font-mono text-xs break-all">
                  {c.path}:{c.line} · fora do diff, não será publicado
                </code>
                <span className="text-sm break-words whitespace-pre-wrap">{c.body}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

function ChoiceCard({
  prompt,
  options,
  busy,
  onChoose
}: {
  prompt: string
  options: { value: string; label: string }[]
  busy: boolean
  onChoose(value: string): void
}): React.JSX.Element {
  const [value, setValue] = useState('')
  return (
    <div
      role="group"
      aria-label="Escolha do fluxo"
      className="flex flex-col gap-2 rounded-[10px] border border-warn-tint-border bg-warn-tint p-3.5"
    >
      <RadioListField label={prompt} options={options} value={value} onChange={setValue} />
      <div className="flex gap-2">
        <Button size="sm" disabled={!value || busy} onClick={() => onChoose(value)}>
          {busy && <Spinner />}
          Confirmar
        </Button>
      </div>
    </div>
  )
}

function GateCard({
  projectId,
  taskId,
  message,
  show,
  resultRunId,
  revise,
  reviseStep,
  outcomes,
  busy,
  onApprove,
  onReject,
  onRevise
}: {
  projectId: string
  taskId: string
  message: string
  show: GateShow
  /** `show: 'result'`: a execução do Claude Code cujo texto final o gate mostra. */
  resultRunId: string | null
  /** "Pedir ajustes": voltas usadas e o limite (`null` = o gate não aceita ajustes). */
  revise: { used: number; max: number } | null
  /** Nome do passo que recebe o ajuste. */
  reviseStep: string | null
  /** O que acontece ao aprovar e ao recusar (frase curta, junto dos botões). */
  outcomes: { approve: string; reject: string } | null
  busy: boolean
  onApprove(): void
  onReject(): void
  onRevise(text: string): void
}): React.JSX.Element {
  const [detail, setDetail] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const [revising, setRevising] = useState(false)
  const [adjust, setAdjust] = useState('')
  const limitReached = revise !== null && revise.used >= revise.max
  const [diffData, setDiffData] = useState<
    | { diff: string; truncated: boolean; untracked: string[]; secrets: string[] }
    | { error: string }
    | null
  >(null)

  useEffect(() => {
    let active = true
    if (show === 'diff') {
      void window.orkio.claude.diff(projectId, taskId).then((r) => {
        if (active) setDiffData(r.ok ? r.value : { error: r.error.message })
      })
    } else if (show === 'summary') {
      void window.orkio.claude.state(projectId, taskId).then((r) => {
        if (!active) return
        const summary = r.ok ? r.value.runs.find((x) => x.summary)?.summary : null
        setDetail(summary ? describeSummary(summary) : 'Sem resumo de execução.')
      })
    } else if (show === 'result') {
      void (resultRunId ? window.orkio.claude.readLog(resultRunId) : Promise.resolve([])).then(
        (events) => {
          if (active) setResult(finalText(events) ?? '')
        }
      )
    }
    return () => {
      active = false
    }
  }, [projectId, taskId, show, resultRunId])

  return (
    <WaitCard label="Aprovação do fluxo" title={message}>
      {show === 'backlog' && <BacklogDocumentView projectId={projectId} taskId={taskId} />}
      {show === 'diff' &&
        diffData &&
        ('error' in diffData ? (
          <Alert tone="danger">{diffData.error}</Alert>
        ) : (
          <>
            {diffData.secrets.length > 0 && (
              <Alert tone="danger">
                {`Parece haver um segredo (token, chave ou senha) em ${diffData.secrets.join(', ')}. O valor está escondido abaixo, mas aprovar segue com ele no código. Recuse e peça para remover, se não for de propósito.`}
              </Alert>
            )}
            <DiffView
              label="Diff para aprovar"
              diff={diffData.diff}
              truncated={diffData.truncated}
              untracked={diffData.untracked}
            />
          </>
        ))}
      {show === 'result' && result !== null && (
        <section
          role="region"
          aria-label="Resultado para aprovar"
          className="max-h-96 overflow-y-auto rounded-lg border border-border-soft bg-card px-3 py-2 text-[13px]"
        >
          {result.trim() ? (
            <MarkdownText text={result} />
          ) : (
            <p className="text-muted-foreground">O Claude Code não deixou texto nesta execução.</p>
          )}
        </section>
      )}
      {show === 'summary' && detail !== null && (
        <Field label="Resumo para aprovar">
          {({ id, describedBy }) => (
            <Textarea
              id={id}
              aria-describedby={describedBy}
              value={detail}
              readOnly
              rows={5}
              className="font-mono text-xs"
            />
          )}
        </Field>
      )}
      {revising && revise && (
        <form
          aria-label="Pedir ajustes"
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (adjust.trim()) onRevise(adjust)
          }}
        >
          <TextAreaField
            label="O que ajustar"
            description={`${reviseStep ? `“${reviseStep}” roda de novo na mesma conversa com o seu pedido` : 'O passo roda de novo na mesma conversa com o seu pedido'}; depois esta aprovação volta. Ajuste ${revise.used + 1} de ${revise.max}.`}
            value={adjust}
            rows={3}
            onChange={(v) => setAdjust(v.slice(0, MAX_PROMPT_CHARS))}
          />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={busy || !adjust.trim()}>
              {busy && <Spinner />}
              Enviar
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setRevising(false)}>
              Cancelar
            </Button>
          </div>
        </form>
      )}
      {!revising && (
        <div className="flex flex-wrap gap-2">
          {replyChips('gate').map((chip) =>
            chip.action === 'approve' ? (
              <Button key={chip.label} size="sm" disabled={busy} onClick={onApprove}>
                {busy && <Spinner />}
                {chip.label}
              </Button>
            ) : revise ? (
              <Button
                key={chip.label}
                size="sm"
                variant="outline"
                disabled={busy || limitReached}
                onClick={() => setRevising(true)}
              >
                {limitReached ? `Limite de ajustes atingido (${revise.max})` : 'Pedir ajustes…'}
              </Button>
            ) : (
              <Button key={chip.label} size="sm" variant="outline" onClick={focusComposer}>
                {chip.label}
              </Button>
            )
          )}
          <Button size="sm" variant="ghost" onClick={onReject}>
            Recusar
          </Button>
        </div>
      )}
      {outcomes && (
        <p className="text-xs text-muted-foreground" data-testid="gate-outcomes">
          {outcomes.approve} {outcomes.reject}
        </p>
      )}
    </WaitCard>
  )
}

function describeSummary(s: RunSummary): string {
  return [
    `${plural(s.files.length, 'arquivo', 'arquivos')}, ${plural(s.commits.length, 'commit', 'commits')}`,
    s.diffStat,
    ...s.commits.map((c) => `${c.hash} ${c.subject}`),
    s.tests.length ? `Testes: ${s.tests.join('; ')}` : 'Nenhum teste rodado'
  ]
    .filter(Boolean)
    .join('\n')
}

function duration(start: string, end: string | null): string {
  if (!end) return ''
  const ms = Date.parse(end) - Date.parse(start)
  if (!Number.isFinite(ms) || ms < 0) return ''
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))} s`
  return `${Math.round(ms / 60_000)} min`
}

/** "Pedir ajuste…": leva ao campo de mensagem da sessão (o texto vai para o Claude). */
function focusComposer(): void {
  const field = document.querySelector<HTMLTextAreaElement>(
    '[aria-label="Mensagem para a sessão"] textarea'
  )
  field?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  field?.focus()
}
