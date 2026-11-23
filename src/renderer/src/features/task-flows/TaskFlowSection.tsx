import { useCallback, useEffect, useState } from 'react'
import { Button } from '@astryxdesign/core/Button'
import { Card } from '@astryxdesign/core/Card'
import { Collapsible } from '@astryxdesign/core/Collapsible'
import { HStack } from '@astryxdesign/core/HStack'
import { Heading } from '@astryxdesign/core/Heading'
import { Icon } from '@astryxdesign/core/Icon'
import { Item } from '@astryxdesign/core/Item'
import { List } from '@astryxdesign/core/List'
import { Text } from '@astryxdesign/core/Text'
import { TextArea } from '@astryxdesign/core/TextArea'
import { StatusToken, toneOf } from '../../components/StatusToken'
import { VStack } from '@astryxdesign/core/VStack'
import type { RunSummary } from '../../../../shared/agent-run'
import { RadioList, RadioListItem } from '@astryxdesign/core/RadioList'
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput'
import { Code } from '@astryxdesign/core/Code'
import { TextInput } from '@astryxdesign/core/TextInput'
import { ALVA_TEMPLATE_IDS } from '../../../../shared/alva-templates'
import type { TaskPullRequest } from '../../../../shared/task-signals'
import {
  type ActionConfirm,
  type FlowRunStatus,
  type FlowRunView,
  type FlowStepStatus,
  type StageFlow
} from '../../../../shared/task-flow'
import { Alert } from '../../components/Alert'
import { AutomationIcon, ExternalLinkIcon, PlayIcon } from '../../components/icons'
import { DiffView } from '../../components/DiffView'
import { describeFlowProblem } from '../../../../shared/flow-problem'
import { FlowProblemCard } from './FlowProblemCard'
import { BacklogDocumentView } from '../alva/BacklogDocumentView'
import { AutopilotPlan } from './AutopilotPlan'
import { gateOutcomes } from './flow-plan'
import { formatUsd, plural } from '../../lib/format'

type TokenColor = 'gray' | 'green' | 'red' | 'yellow' | 'orange' | 'blue'

const RUN_STATUS: Record<FlowRunStatus, { label: string; color: TokenColor }> = {
  running: { label: 'Rodando', color: 'orange' },
  waiting_gate: { label: 'Esperando aprovação', color: 'yellow' },
  paused: { label: 'Pausado', color: 'red' },
  awaiting_decision: { label: 'Esperando sua decisão', color: 'yellow' },
  finished: { label: 'Concluído', color: 'green' },
  cancelled: { label: 'Cancelado', color: 'gray' }
}

const STEP_STATUS: Record<FlowStepStatus, string> = {
  running: 'rodando',
  waiting: 'esperando aprovação',
  ok: 'concluído',
  failed: 'falhou',
  cancelled: 'cancelado',
  skipped: 'pulado',
  interrupted: 'interrompido',
  approved: 'aprovado',
  rejected: 'recusado'
}

/** O que está trabalhando agora na tarefa (rodapé "Trabalhando há…" do painel). */
export interface TaskActivity {
  who: string
  what: string | null
  /** ISO 8601: quando o passo atual começou. */
  since: string
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
  onRunsChange
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
    <VStack gap={3} role="region" aria-label="Fluxo da tarefa">
      <HStack gap={2} vAlign="center" wrap="wrap">
        <Icon icon={AutomationIcon} />
        <Heading level={3}>
          {run ? `Fluxo: ${run.flowName}${run.agent ? ` · ${run.agent.name}` : ''}` : 'Fluxo'}
        </Heading>
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
      </HStack>

      {run?.status === 'running' && (
        <Text type="supporting" color="secondary" data-testid="autopilot-hint">
          Piloto automático: o Orkio manda cada passo para o Claude Code e segue sozinho. Ele para
          quando precisar de você.
        </Text>
      )}

      {/* Encerrado, o histórico abaixo já conta o que rodou: o plano só vale enquanto há caminho. */}
      {run && live && <AutopilotPlan run={run} />}

      {!live && binding && (
        <Button
          variant="secondary"
          label={run ? 'Rodar fluxo de novo' : `Rodar fluxo “${binding.flowName}”`}
          icon={<Icon icon={PlayIcon} />}
          isLoading={busy}
          onClick={() => void act(() => window.orkio.taskFlows.start(projectId, taskId))}
        />
      )}

      {openPr?.checks && (
        <HStack gap={2} vAlign="center" wrap="wrap">
          <StatusToken
            tone={toneOf(CI_LABEL[openPr.checks].color)}
            label={`${CI_LABEL[openPr.checks].label} (PR #${openPr.number})`}
            data-testid="pr-ci"
          />
          {openPr.checks === 'failure' && ciFlow && !live && (
            <Button
              size="sm"
              variant="secondary"
              label="Rodar fluxo CI vermelho"
              icon={<Icon icon={PlayIcon} />}
              isLoading={busy}
              onClick={() =>
                void act(() => window.orkio.taskFlows.startById(projectId, taskId, ciFlow.id))
              }
            />
          )}
        </HStack>
      )}

      {run && run.history.length > 0 && (
        <Collapsible
          trigger={
            <Text type="supporting" color="secondary" data-testid="flow-steps-summary">
              Histórico do fluxo: {stepSummary(run.history)}
            </Text>
          }
          isOpen={stepsOpen ?? !(live && run.status !== 'paused')}
          onOpenChange={setStepsOpen}
        >
          <List hasDividers density="compact" aria-label="Linha do tempo do fluxo">
            {run.history.map((h) => (
              <Item
                as="li"
                key={h.seq}
                label={stepName(h.stepId)}
                description={[
                  STEP_STATUS[h.status],
                  duration(h.startedAt, h.endedAt),
                  h.costUsd !== null ? formatUsd(h.costUsd) : '',
                  h.message ?? ''
                ]
                  .filter(Boolean)
                  .join(' · ')}
              />
            ))}
          </List>
        </Collapsible>
      )}

      {run?.status === 'running' && current?.type === 'claude_command' && (
        <Text type="supporting" data-testid="flow-running-step">
          {/:pr$/.test(current.command) && !/--comments/.test(current.args)
            ? 'Aguardando CI do GitHub: o /pr acompanha os checks até terminar (pode levar vários minutos).'
            : `Rodando /${current.command}. A conversa deste passo está logo acima.`}
        </Text>
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
        <Card role="group" aria-label="Ação pendente do fluxo">
          <VStack gap={2}>
            <Text weight="semibold">{current.name}</Text>
            <Text>{pending[current.action] ?? 'Esta ação ainda não existe no Orkio.'}</Text>
            <HStack gap={2}>
              <Button
                size="sm"
                variant="primary"
                label="Já fiz, seguir"
                isLoading={busy}
                onClick={() => void act(() => window.orkio.taskFlows.approve(run.id))}
              />
              <Button
                size="sm"
                variant="ghost"
                label="Encerrar o fluxo"
                onClick={() => void act(() => window.orkio.taskFlows.reject(run.id))}
              />
            </HStack>
          </VStack>
        </Card>
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
          projectId={projectId}
          taskId={taskId}
          message={current.message}
          show={current.show}
          outcomes={gateOutcomes(run)}
          busy={busy}
          onApprove={() => void act(() => window.orkio.taskFlows.approve(run.id))}
          onReject={() => void act(() => window.orkio.taskFlows.reject(run.id))}
        />
      )}

      {run?.status === 'paused' &&
        (run.pauseReason === 'waiting_slot' || run.pauseReason === 'waiting_agent') && (
          <VStack gap={2}>
            <Alert tone="warning">
              {run.pauseReason === 'waiting_agent'
                ? `Aguardando ${run.agent?.name ?? 'o agente'} terminar outra tarefa (limite de fluxos ao mesmo tempo). Começa sozinho.`
                : 'Aguardando outro fluxo Alva deste projeto terminar (Docker e portas). Começa sozinho.'}
            </Alert>
            <Button
              size="sm"
              variant="ghost"
              label="Cancelar fluxo"
              onClick={() => void act(() => window.orkio.taskFlows.cancel(run.id))}
            />
          </VStack>
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
        <VStack gap={2}>
          <Alert tone="warning">
            A tarefa saiu da etapa deste fluxo. O passo atual termina, mas o fluxo só segue com a
            sua escolha.
          </Alert>
          <HStack gap={2}>
            <Button
              size="sm"
              variant="secondary"
              label="Deixar terminar"
              onClick={() => void act(() => window.orkio.taskFlows.decideLeft(run.id, 'continue'))}
            />
            <Button
              size="sm"
              variant="ghost"
              label="Cancelar fluxo"
              onClick={() => void act(() => window.orkio.taskFlows.decideLeft(run.id, 'cancel'))}
            />
          </HStack>
        </VStack>
      )}

      {(run?.status === 'running' || run?.status === 'waiting_gate') && (
        <Button
          size="sm"
          variant="ghost"
          label="Cancelar fluxo"
          onClick={() => void act(() => window.orkio.taskFlows.cancel(run.id))}
        />
      )}
      {error && <Alert tone="danger">{error}</Alert>}
    </VStack>
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
  const invalid = values?.some((v) => !/^(team:)?[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(v)) ?? false
  return (
    <Card role="group" aria-label={info.title}>
      <VStack gap={2}>
        <Text weight="semibold">{info.title}</Text>
        <Text>{info.message}</Text>
        {info.details.length > 0 && (
          <List density="compact" aria-label="Detalhes da ação">
            {info.details.map((d) => (
              <Item as="li" key={d.label} label={d.label} description={d.value} />
            ))}
          </List>
        )}
        {info.commits && info.commits.length > 0 && (
          <List density="compact" aria-label="Commits que vão para o GitHub">
            {info.commits.map((c) => (
              <Item as="li" key={c.hash} label={c.subject} startContent={<Code>{c.hash}</Code>} />
            ))}
          </List>
        )}
        {info.stat && (
          <Text type="supporting" data-testid="confirm-stat">
            <Code>{info.stat}</Code>
          </Text>
        )}
        {info.input && (
          <VStack gap={1} role="group" aria-label={info.input.label}>
            <Text weight="semibold">{info.input.label}</Text>
            {info.input.options.map((o) => (
              <CheckboxInput
                key={o}
                label={o}
                value={chosen.includes(o)}
                onChange={(on) =>
                  setChosen((all) => (on ? [...all, o] : all.filter((x) => x !== o)))
                }
              />
            ))}
            {info.input.allowOther && (
              <TextInput
                label="Outros (logins separados por vírgula)"
                value={other}
                onChange={setOther}
                {...(invalid ? { error: 'Use logins do GitHub (ou team:slug).' } : {})}
              />
            )}
          </VStack>
        )}
        {info.link && (
          <Button
            size="sm"
            variant="ghost"
            label={info.link.label}
            icon={<Icon icon={ExternalLinkIcon} />}
            onClick={() => void window.orkio.openExternal(info.link!.url)}
          />
        )}
        <HStack gap={2}>
          <Button
            size="sm"
            variant="primary"
            label={info.approveLabel}
            isLoading={busy}
            isDisabled={invalid || (values !== null && values.length === 0)}
            {...(values !== null && values.length === 0
              ? { disabledMessage: 'Escolha pelo menos um revisor.' }
              : {})}
            onClick={() => onApprove(values)}
          />
          <Button size="sm" variant="ghost" label="Recusar e encerrar" onClick={onReject} />
        </HStack>
      </VStack>
    </Card>
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
    <Card role="group" aria-label="Escolha do fluxo">
      <VStack gap={2}>
        <RadioList label={prompt} value={value} onChange={setValue}>
          {options.map((o) => (
            <RadioListItem key={o.value} value={o.value} label={o.label} />
          ))}
        </RadioList>
        <HStack gap={2}>
          <Button
            size="sm"
            variant="primary"
            label="Confirmar"
            isDisabled={!value}
            isLoading={busy}
            onClick={() => onChoose(value)}
          />
        </HStack>
      </VStack>
    </Card>
  )
}

function GateCard({
  projectId,
  taskId,
  message,
  show,
  outcomes,
  busy,
  onApprove,
  onReject
}: {
  projectId: string
  taskId: string
  message: string
  show: 'diff' | 'summary' | 'backlog' | 'none'
  /** O que acontece ao aprovar e ao recusar (frase curta, junto dos botões). */
  outcomes: { approve: string; reject: string } | null
  busy: boolean
  onApprove(): void
  onReject(): void
}): React.JSX.Element {
  const [detail, setDetail] = useState<string | null>(null)
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
    }
    return () => {
      active = false
    }
  }, [projectId, taskId, show])

  return (
    <Card role="group" aria-label="Aprovação do fluxo">
      <VStack gap={2}>
        <Text weight="semibold">{message}</Text>
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
        {show === 'summary' && detail !== null && (
          <TextArea
            label="Resumo para aprovar"
            value={detail}
            isReadOnly
            rows={5}
            controlClassName="orkio-mono-input"
          />
        )}
        <HStack gap={2}>
          <Button
            size="sm"
            variant="primary"
            label="Aprovar"
            isLoading={busy}
            onClick={onApprove}
          />
          <Button size="sm" variant="secondary" label="Recusar" onClick={onReject} />
        </HStack>
        {outcomes && (
          <Text type="supporting" color="secondary" data-testid="gate-outcomes">
            {outcomes.approve} {outcomes.reject}
          </Text>
        )}
      </VStack>
    </Card>
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
