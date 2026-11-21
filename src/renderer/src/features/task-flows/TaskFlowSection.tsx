import { useCallback, useEffect, useState } from 'react'
import { Button } from '@astryxdesign/core/Button'
import { Card } from '@astryxdesign/core/Card'
import { HStack } from '@astryxdesign/core/HStack'
import { Heading } from '@astryxdesign/core/Heading'
import { Icon } from '@astryxdesign/core/Icon'
import { Item } from '@astryxdesign/core/Item'
import { List } from '@astryxdesign/core/List'
import { Text } from '@astryxdesign/core/Text'
import { TextArea } from '@astryxdesign/core/TextArea'
import { Token } from '@astryxdesign/core/Token'
import { VStack } from '@astryxdesign/core/VStack'
import type { RunSummary } from '../../../../shared/agent-run'
import type { BacklogTaskInfo } from '../../../../shared/alva'
import { RadioList, RadioListItem } from '@astryxdesign/core/RadioList'
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput'
import { Code } from '@astryxdesign/core/Code'
import { TextInput } from '@astryxdesign/core/TextInput'
import { ALVA_TEMPLATE_IDS } from '../../../../shared/alva-templates'
import type { TaskPullRequest } from '../../../../shared/task-signals'
import {
  FLOW_PAUSE_LABEL,
  type ActionConfirm,
  type FlowRunStatus,
  type FlowRunView,
  type FlowStepStatus,
  type StageFlow
} from '../../../../shared/task-flow'
import { Alert } from '../../components/Alert'
import { AutomationIcon, ExternalLinkIcon, PlayIcon } from '../../components/icons'

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
  ok: 'ok',
  failed: 'falhou',
  cancelled: 'cancelado',
  skipped: 'pulado',
  interrupted: 'interrompido',
  approved: 'aprovado',
  rejected: 'recusado'
}

/**
 * Seção "Fluxo" do painel da tarefa (5A): linha do tempo, gate (aprovar/recusar com diff ou
 * resumo), pausas (retomar/pular/cancelar) e a decisão quando a tarefa sai da etapa. O log ao vivo
 * do passo atual é o da seção Claude Code, logo abaixo.
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
  pr = null
}: {
  projectId: string
  taskId: string
  stageId: string | null
  /** PR da tarefa (sinais da 2D): estado do CI e botão do fluxo de CI vermelho. */
  pr?: TaskPullRequest | null
}): React.JSX.Element | null {
  const [runs, setRuns] = useState<FlowRunView[] | null>(null)
  const [binding, setBinding] = useState<(StageFlow & { flowName: string }) | null>(null)
  const [pending, setPending] = useState<Record<string, string>>({})
  const [ciFlow, setCiFlow] = useState<{ id: string; name: string } | null>(null)
  const [backlog, setBacklog] = useState<{ linked: string | null; task: BacklogTaskInfo | null }>({
    linked: null,
    task: null
  })
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
    // alva-flow (5B): task do Backlog.md vinculada (lida do arquivo, nada guardado).
    void window.orkio.alva.taskSummary(projectId, taskId).then((r) => {
      if (active && r.ok) setBacklog(r.value)
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
  const openPr = pr && (pr.state === 'open' || pr.state === 'draft') ? pr : null
  if (!run && !binding && !backlog.linked && !openPr?.checks) return null
  const live = run && run.status !== 'finished' && run.status !== 'cancelled'
  const stepName = (id: string | null): string =>
    run?.steps.find((s) => s.id === id)?.name ?? id ?? ''
  const current = run?.steps.find((s) => s.id === run.currentStep) ?? null

  return (
    <VStack gap={3} role="region" aria-label="Fluxo da tarefa">
      <HStack gap={2} vAlign="center" wrap="wrap">
        <Icon icon={AutomationIcon} />
        <Heading level={3}>
          {run ? `Fluxo: ${run.flowName}${run.agent ? ` · ${run.agent.name}` : ''}` : 'Fluxo'}
        </Heading>
        {run && (
          <Token
            size="sm"
            color={RUN_STATUS[run.status].color}
            label={
              run.status === 'finished' && run.result === 'rejected'
                ? 'Recusado'
                : RUN_STATUS[run.status].label
            }
            data-testid="flow-status"
          />
        )}
      </HStack>

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
          <Token
            size="sm"
            color={CI_LABEL[openPr.checks].color}
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
        <List hasDividers density="compact" aria-label="Linha do tempo do fluxo">
          {run.history.map((h) => (
            <Item
              as="li"
              key={h.seq}
              label={stepName(h.stepId)}
              description={[
                STEP_STATUS[h.status],
                duration(h.startedAt, h.endedAt),
                h.costUsd !== null ? `US$ ${h.costUsd.toFixed(2)}` : '',
                h.message ?? ''
              ]
                .filter(Boolean)
                .join(' · ')}
            />
          ))}
        </List>
      )}

      {backlog.linked && (
        <Text type="supporting" data-testid="alva-task">
          {backlog.task
            ? `Backlog: ${backlog.task.id} · ${backlog.task.status} · critérios ${backlog.task.criteria.done}/${backlog.task.criteria.total}${backlog.task.openQuestions > 0 ? ` · ${backlog.task.openQuestions} pergunta(s) em aberto` : ''}`
            : `Backlog: ${backlog.linked} (arquivo não encontrado no ambiente)`}
        </Text>
      )}

      {run?.status === 'running' && current?.type === 'claude_command' && (
        <Text type="supporting" data-testid="flow-running-step">
          {/:pr$/.test(current.command) && !/--comments/.test(current.args)
            ? 'Aguardando CI do GitHub: o /pr acompanha os checks até terminar (pode levar vários minutos).'
            : `Rodando /${current.command}. O log ao vivo está em Claude Code, logo abaixo.`}
        </Text>
      )}

      {run?.status === 'waiting_gate' && current?.type === 'orkio_action' && run.confirm && (
        <ConfirmCard
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

      {run?.status === 'paused' &&
        run.pauseReason !== 'waiting_slot' &&
        run.pauseReason !== 'waiting_agent' &&
        run.pauseReason !== 'needs_choice' && (
          <VStack gap={2}>
            <Alert tone="warning">
              {run.pauseReason ? FLOW_PAUSE_LABEL[run.pauseReason] : 'Fluxo pausado'}
              {current ? ` — ${current.name}` : ''}.
            </Alert>
            <HStack gap={2} wrap="wrap">
              <Button
                size="sm"
                variant="primary"
                label="Retomar deste passo"
                isLoading={busy}
                onClick={() => void act(() => window.orkio.taskFlows.resume(run.id))}
              />
              <Button
                size="sm"
                variant="secondary"
                label="Pular"
                onClick={() => void act(() => window.orkio.taskFlows.skip(run.id))}
              />
              <Button
                size="sm"
                variant="ghost"
                label="Cancelar fluxo"
                onClick={() => void act(() => window.orkio.taskFlows.cancel(run.id))}
              />
            </HStack>
          </VStack>
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
  busy,
  onApprove,
  onReject
}: {
  projectId: string
  taskId: string
  message: string
  show: 'diff' | 'summary' | 'none'
  busy: boolean
  onApprove(): void
  onReject(): void
}): React.JSX.Element {
  const [detail, setDetail] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    if (show === 'diff') {
      void window.orkio.claude.diff(projectId, taskId).then((r) => {
        if (!active) return
        if (!r.ok) {
          setDetail(r.error.message)
          return
        }
        const extra = r.value.untracked.length
          ? `\n\nArquivos novos fora do git: ${r.value.untracked.join(', ')}`
          : ''
        setDetail((r.value.diff || 'Sem diferenças em relação à base.') + extra)
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
        {show !== 'none' && detail !== null && (
          <TextArea
            label={show === 'diff' ? 'Diff para aprovar' : 'Resumo para aprovar'}
            value={detail}
            isReadOnly
            rows={show === 'diff' ? 12 : 5}
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
          <Button size="sm" variant="destructive" label="Recusar" onClick={onReject} />
        </HStack>
      </VStack>
    </Card>
  )
}

function describeSummary(s: RunSummary): string {
  return [
    `${s.files.length} arquivo(s), ${s.commits.length} commit(s)`,
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
