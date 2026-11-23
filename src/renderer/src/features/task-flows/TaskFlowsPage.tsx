import { useEffect, useMemo, useState } from 'react'
import { useProjectActivity } from '../../components/SentenceDetail'
import { FlowDetail } from './FlowDetail'
import { Button } from '@astryxdesign/core/Button'
import { Card } from '@astryxdesign/core/Card'
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput'
import { DropdownMenu } from '@astryxdesign/core/DropdownMenu'
import { Heading } from '@astryxdesign/core/Heading'
import { HStack } from '@astryxdesign/core/HStack'
import { Icon } from '@astryxdesign/core/Icon'
import { IconButton } from '@astryxdesign/core/IconButton'
import { Item } from '@astryxdesign/core/Item'
import { List } from '@astryxdesign/core/List'
import { Selector, type SelectorOptionType } from '@astryxdesign/core/Selector'
import { Skeleton } from '@astryxdesign/core/Skeleton'
import { StackItem } from '@astryxdesign/core/Stack'
import { Text } from '@astryxdesign/core/Text'
import { TextArea } from '@astryxdesign/core/TextArea'
import { TextInput } from '@astryxdesign/core/TextInput'
import { Token } from '@astryxdesign/core/Token'
import { VStack } from '@astryxdesign/core/VStack'
import type { CatalogGroup } from '../../../../shared/agent-run'
import type { TaskFlowsProject } from '../../../../shared/ipc-contract'
import {
  STEP_TYPE_LABEL,
  newStepId,
  validateTaskFlow,
  type Condition,
  type Flow,
  type Step,
  type StepType
} from '../../../../shared/task-flow'
import { Alert } from '../../components/Alert'
import { PageState } from '../../components/PageState'
import { SaveBar } from '../../components/SaveBar'
import { plural } from '../../lib/format'
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, TrashIcon } from '../../components/icons'

const newFlowId = (): string =>
  `flow-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`

function emptyStep(flow: Flow, type: StepType): Step {
  const name = STEP_TYPE_LABEL[type]
  const id = newStepId(
    flow,
    type === 'claude_command'
      ? 'comando'
      : type === 'gate'
        ? 'aprovar'
        : type === 'branch'
          ? 'salto'
          : 'acao'
  )
  switch (type) {
    case 'claude_command':
      return { id, name, type, command: '', args: '{{briefing_path}}', timeoutMin: 30 }
    case 'gate':
      return {
        id,
        name,
        type,
        message: 'Pode seguir?',
        show: 'diff',
        onReject: 'stop',
        timeoutMin: null
      }
    case 'orkio_action':
      return { id, name, type, action: 'noop' }
    case 'branch':
      return {
        id,
        name,
        type,
        when: { type: 'step', step: flow.steps[0]?.id ?? id, is: 'ok' },
        then: flow.steps[0]?.id ?? id
      }
  }
}

/**
 * Editor dos fluxos de tarefa (5A): lista de fluxos do projeto; para cada um, passos ordenados
 * com formulário por tipo. Comandos vêm do catálogo da 4B. A validação é a mesma do main.
 */
export function TaskFlowsPage({ projectId }: { projectId: string }): React.JSX.Element {
  const [project, setProject] = useState<TaskFlowsProject | null>(null)
  const [flows, setFlows] = useState<Flow[]>([])
  // Última versão salva: base do contador de alterações e do "Descartar".
  const [saved, setSaved] = useState<Flow[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [catalog, setCatalog] = useState<CatalogGroup[] | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  // Fluxo aberto no editor (os outros aparecem em frase, fase 6). Novo fluxo já abre editando.
  const [editingId, setEditingId] = useState<string | null>(null)
  const [stageNames, setStageNames] = useState<Record<string, string>>({})
  const flowActivity = useProjectActivity(projectId, 'flow')

  useEffect(() => {
    let active = true
    void window.orkio.taskFlows.getProject(projectId).then((r) => {
      if (!active) return
      if (r.ok) {
        setProject(r.value)
        setFlows(r.value.flows)
        setSaved(r.value.flows)
        setSelected(r.value.flows[0]?.id ?? null)
      } else setMessage({ tone: 'error', text: r.error.message })
    })
    // Nomes das colunas para a frase "Quando a tarefa entra em…".
    void window.orkio.board
      .get(projectId)
      .then((r) => {
        if (active && r.ok)
          setStageNames(
            Object.fromEntries((r.value.config?.stages ?? []).map((st) => [st.id, st.name]))
          )
      })
      .catch(() => undefined)
    void window.orkio.claude.catalog(projectId, 'projeto').then((r) => {
      if (active) setCatalog(r.ok ? r.value : [])
    })
    return () => {
      active = false
    }
  }, [projectId])

  const commands = useMemo(
    () => (catalog ? new Set(catalog.flatMap((g) => g.commands.map((c) => c.name))) : null),
    [catalog]
  )
  const ctx = useMemo(
    () => ({
      commands,
      extractors: project?.extractors.map((e) => e.id) ?? [],
      actions: project?.actions.map((a) => a.id) ?? []
    }),
    [commands, project]
  )
  const issuesByFlow = useMemo(
    () => new Map(flows.map((f) => [f.id, validateTaskFlow(f, ctx)])),
    [flows, ctx]
  )

  if (!project) return <Skeleton height={240} aria-label="Carregando fluxos" />

  const flow = flows.find((f) => f.id === selected) ?? null
  const hasErrors = [...issuesByFlow.values()].some((l) => l.some((i) => i.level === 'error'))
  const updateFlow = (next: Flow): void => {
    setFlows((all) => all.map((f) => (f.id === next.id ? next : f)))
    setMessage(null)
  }

  const save = async (): Promise<void> => {
    setSaving(true)
    const r = await window.orkio.taskFlows.saveFlows(projectId, flows)
    setSaving(false)
    if (r.ok) setSaved(flows)
    setMessage(
      r.ok ? { tone: 'ok', text: 'Fluxos salvos.' } : { tone: 'error', text: r.error.message }
    )
  }
  const changes = countFlowChanges(saved, flows)
  const createFlow = (): void => {
    const f: Flow = { id: newFlowId(), name: 'Novo fluxo', steps: [] }
    setFlows((all) => [...all, f])
    setSelected(f.id)
    setEditingId(f.id)
  }
  const discard = (): void => {
    setFlows(saved)
    setSelected((id) => (saved.some((f) => f.id === id) ? id : (saved[0]?.id ?? null)))
    setEditingId(null)
    setMessage(null)
  }

  return (
    <VStack gap={5} role="region" aria-label="Fluxos do projeto">
      <HStack gap={2} vAlign="center" wrap="wrap">
        <Text color="secondary">
          Ligue um fluxo a uma coluna em Etapas e automações (“Fluxo desta coluna”). O ajuste de
          push fica lá também, em Entrega.
        </Text>
      </HStack>

      {flows.length === 0 ? (
        <PageState
          kind="empty"
          title="Nenhum fluxo ainda"
          description="Um fluxo roda sozinho numa tarefa: comandos do Claude Code, suas aprovações e ações do Orkio, em ordem. Comece do zero ou use um modelo na aba Modelos do alva-flow."
          action={{ label: 'Novo fluxo', onClick: createFlow }}
        />
      ) : (
        <HStack gap={5} vAlign="start">
          <VStack gap={2} width="calc(var(--spacing-12) * 5)" style={{ flexShrink: 0 }}>
            <List hasDividers density="compact" aria-label="Fluxos do projeto">
              {flows.map((f) => {
                const errors =
                  issuesByFlow.get(f.id)?.filter((i) => i.level === 'error').length ?? 0
                return (
                  <Item
                    as="li"
                    key={f.id}
                    label={f.name || 'Sem nome'}
                    description={plural(f.steps.length, 'passo', 'passos')}
                    isSelected={f.id === selected}
                    onClick={() => {
                      setSelected(f.id)
                      setEditingId(null)
                    }}
                    {...(errors > 0
                      ? {
                          endContent: (
                            <Token size="sm" color="red" label={plural(errors, 'erro', 'erros')} />
                          )
                        }
                      : {})}
                  />
                )
              })}
            </List>
            <Button
              variant="secondary"
              label="Novo fluxo"
              icon={<Icon icon={PlusIcon} />}
              onClick={createFlow}
            />
          </VStack>

          <StackItem size="fill">
            {flow && editingId !== flow.id ? (
              <FlowDetail
                flow={flow}
                bindings={project.bindings.filter((b) => b.flowId === flow.id && b.enabled)}
                stageName={(id) => stageNames[id] ?? 'coluna removida'}
                actionLabel={(id) => project.actions.find((a) => a.id === id)?.label ?? id}
                activity={flowActivity}
                onEdit={() => setEditingId(flow.id)}
              />
            ) : flow ? (
              <FlowEditor
                flow={flow}
                catalog={catalog}
                project={project}
                issues={issuesByFlow.get(flow.id) ?? []}
                onChange={updateFlow}
                onRemove={() => {
                  setFlows((all) => all.filter((f) => f.id !== flow.id))
                  setSelected(null)
                }}
                onDone={() => setEditingId(null)}
              />
            ) : (
              <Text type="supporting">Crie ou escolha um fluxo.</Text>
            )}
          </StackItem>
        </HStack>
      )}

      {(changes > 0 || message) && (
        <SaveBar
          label="Salvar fluxos de tarefa"
          changes={changes}
          saveLabel="Salvar fluxos"
          isSaving={saving}
          isDisabled={hasErrors || changes === 0}
          onSave={() => void save()}
          onDiscard={discard}
        >
          {hasErrors && <Alert tone="danger">Corrija os erros antes de salvar.</Alert>}
          {message &&
            (message.tone === 'error' ? (
              <Alert tone="danger">{message.text}</Alert>
            ) : (
              <Text role="status">{message.text}</Text>
            ))}
        </SaveBar>
      )}
    </VStack>
  )
}

/** Quantos fluxos mudaram desde o último salvar (novos, removidos ou editados). */
function countFlowChanges(saved: readonly Flow[], current: readonly Flow[]): number {
  const before = new Map(saved.map((f) => [f.id, JSON.stringify(f)]))
  const now = new Set(current.map((f) => f.id))
  let n = 0
  for (const f of current) if (before.get(f.id) !== JSON.stringify(f)) n++
  for (const id of before.keys()) if (!now.has(id)) n++
  return n
}

/** Uma linha que resume o passo (lista de passos). */
function stepSummary(step: Step): string {
  switch (step.type) {
    case 'claude_command':
      return [
        `/${step.command || '…'} ${step.args}`.trim(),
        `${step.timeoutMin} min`,
        ...(step.delivery ? ['modo entrega'] : [])
      ].join(' · ')
    case 'gate':
      return [
        `“${step.message}”`,
        step.show === 'diff'
          ? 'mostra o diff'
          : step.show === 'summary'
            ? 'mostra o resumo'
            : step.show === 'backlog'
              ? 'mostra a spec e o plano'
              : null,
        `recusar → ${step.onReject === 'stop' ? 'encerra' : step.onReject}`
      ]
        .filter(Boolean)
        .join(' · ')
    case 'orkio_action':
      return step.action
    case 'branch':
      return `ir para ${step.then}${step.else ? ` · senão ${step.else}` : ' · senão segue'}`
  }
}

function FlowEditor({
  flow,
  catalog,
  project,
  issues,
  onChange,
  onRemove,
  onDone
}: {
  flow: Flow
  catalog: CatalogGroup[] | null
  project: TaskFlowsProject
  issues: ReturnType<typeof validateTaskFlow>
  onChange(flow: Flow): void
  onRemove(): void
  /** Volta para o fluxo em frase (o rascunho continua até "Salvar fluxos"). */
  onDone(): void
}): React.JSX.Element {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const index = Math.min(selectedIndex, flow.steps.length - 1)
  const step = index >= 0 ? flow.steps[index] : undefined
  const setStep = (i: number, next: Step): void =>
    onChange({ ...flow, steps: flow.steps.map((s, j) => (j === i ? next : s)) })
  const move = (i: number, delta: number): void => {
    const steps = [...flow.steps]
    const [s] = steps.splice(i, 1)
    steps.splice(i + delta, 0, s!)
    onChange({ ...flow, steps })
    setSelectedIndex(i + delta)
  }
  // Novo passo entra depois do selecionado (ou no fim) e já fica aberto.
  const add = (type: StepType): void => {
    const at = flow.steps.length === 0 ? 0 : index + 1
    const steps = [...flow.steps]
    steps.splice(at, 0, emptyStep(flow, type))
    onChange({ ...flow, steps })
    setSelectedIndex(at)
  }
  const stepOptions = flow.steps.map((s) => ({ value: s.id, label: `${s.name} (${s.id})` }))
  const problemsOf = (id: string): number =>
    issues.filter((i) => i.stepId === id && i.level === 'error').length

  return (
    <VStack gap={4}>
      <HStack gap={2} vAlign="end">
        <StackItem size="fill">
          <TextInput
            label="Nome do fluxo"
            value={flow.name}
            onChange={(name) => onChange({ ...flow, name })}
          />
        </StackItem>
        <Button variant="secondary" label="Ver em frase" onClick={onDone} />
        <Button
          variant="ghost"
          label="Remover fluxo"
          icon={<Icon icon={TrashIcon} />}
          onClick={onRemove}
        />
      </HStack>

      {issues.length > 0 && (
        <VStack gap={1} role="list" aria-label="Problemas do fluxo">
          {issues.map((i, n) => (
            <Alert key={n} tone={i.level === 'error' ? 'danger' : 'warning'}>
              {i.message}
            </Alert>
          ))}
        </VStack>
      )}

      <VStack gap={2}>
        <HStack gap={2} vAlign="center">
          <Heading level={3}>Passos</Heading>
          <StackItem size="fill" />
          <DropdownMenu
            button={{ label: 'Adicionar passo', size: 'sm', variant: 'secondary' }}
            items={(Object.keys(STEP_TYPE_LABEL) as StepType[]).map((t) => ({
              label: STEP_TYPE_LABEL[t],
              onClick: () => add(t)
            }))}
          />
        </HStack>
        {flow.steps.length === 0 ? (
          <Text type="supporting">Nenhum passo ainda. Use “Adicionar passo”.</Text>
        ) : (
          <List hasDividers density="compact" aria-label="Passos do fluxo">
            {flow.steps.map((s, i) => {
              const problems = problemsOf(s.id)
              return (
                <Item
                  as="li"
                  key={`${i}:${s.type}`}
                  aria-label={`Passo ${i + 1}: ${s.name}`}
                  label={`${i + 1}. ${s.name}`}
                  description={stepSummary(s)}
                  isSelected={i === index}
                  onClick={() => setSelectedIndex(i)}
                  endContent={
                    <HStack gap={1} vAlign="center">
                      {problems > 0 && (
                        <Token size="sm" color="red" label={plural(problems, 'erro', 'erros')} />
                      )}
                      <Token size="sm" label={STEP_TYPE_LABEL[s.type]} />
                    </HStack>
                  }
                />
              )
            })}
          </List>
        )}
      </VStack>

      {step && (
        <Card role="region" aria-label={`Editar passo ${index + 1}`} variant="muted" padding={4}>
          <VStack gap={3}>
            <HStack gap={2} vAlign="center" wrap="wrap">
              <Heading level={3}>{`Passo ${index + 1}`}</Heading>
              <Token size="sm" label={STEP_TYPE_LABEL[step.type]} />
              <StackItem size="fill" />
              <IconButton
                size="sm"
                variant="ghost"
                label="Subir passo"
                icon={<Icon icon={ArrowUpIcon} />}
                isDisabled={index === 0}
                onClick={() => index > 0 && move(index, -1)}
              />
              <IconButton
                size="sm"
                variant="ghost"
                label="Descer passo"
                icon={<Icon icon={ArrowDownIcon} />}
                isDisabled={index === flow.steps.length - 1}
                onClick={() => index < flow.steps.length - 1 && move(index, 1)}
              />
              <IconButton
                size="sm"
                variant="ghost"
                label="Remover passo"
                icon={<Icon icon={TrashIcon} />}
                onClick={() => {
                  onChange({ ...flow, steps: flow.steps.filter((_, i) => i !== index) })
                  setSelectedIndex(Math.max(0, index - 1))
                }}
              />
            </HStack>
            <HStack gap={2} wrap="wrap">
              <TextInput
                label="Nome"
                value={step.name}
                onChange={(name) => setStep(index, { ...step, name })}
              />
              <TextInput
                label="Chave"
                description="Usada em saltos e condições."
                value={step.id}
                onChange={(id) => setStep(index, { ...step, id: id.toLowerCase() })}
              />
            </HStack>
            <StepForm
              key={index}
              step={step}
              catalog={catalog}
              project={project}
              stepOptions={stepOptions}
              onChange={(s) => setStep(index, s)}
            />
          </VStack>
        </Card>
      )}
    </VStack>
  )
}

function StepForm({
  step,
  catalog,
  project,
  stepOptions,
  onChange
}: {
  step: Step
  catalog: CatalogGroup[] | null
  project: TaskFlowsProject
  stepOptions: { value: string; label: string }[]
  onChange(step: Step): void
}): React.JSX.Element {
  switch (step.type) {
    case 'claude_command': {
      const options: SelectorOptionType[] =
        catalog && catalog.length > 0
          ? catalog.map((g) => ({
              type: 'section' as const,
              title: g.title,
              options: g.commands.map((c) => ({
                value: c.name,
                label: `/${c.name}`,
                ...(c.description ? { description: c.description } : {})
              }))
            }))
          : []
      return (
        <VStack gap={2}>
          {options.length > 0 ? (
            <Selector
              label="Comando"
              hasSearch
              searchPlaceholder="Buscar comando…"
              isLoading={catalog === null}
              options={options}
              {...(step.command ? { value: step.command } : {})}
              onChange={(command: string) => onChange({ ...step, command })}
            />
          ) : (
            <TextInput
              label="Comando"
              description="Nenhum comando no catálogo; digite o nome."
              value={step.command}
              onChange={(command) => onChange({ ...step, command: command.replace(/^\//, '') })}
            />
          )}
          <TextInput
            label="Argumentos"
            description="Variáveis: {{briefing_path}}, {{task_id}}, {{notion_url}}, {{flow.<chave>}}"
            value={step.args}
            onChange={(args) => onChange({ ...step, args })}
          />
          <CheckboxInput
            label="Modo entrega"
            description="Só neste passo: o Claude Code pode criar/atualizar a PR (gh) e fazer push da branch da tarefa, com sua aprovação na primeira vez. Merge, força e outras branches continuam bloqueados."
            value={step.delivery === true}
            onChange={(on) => {
              const rest = { ...step }
              delete rest.delivery
              onChange(on ? { ...rest, delivery: true } : rest)
            }}
          />
          <HStack gap={2} wrap="wrap">
            <TextInput
              label="Tempo limite em minutos"
              value={String(step.timeoutMin)}
              onChange={(v) => onChange({ ...step, timeoutMin: Number(v) || 0 })}
            />
            <Selector
              label="Gravar variáveis"
              options={[
                { value: '', label: 'Não gravar' },
                ...project.extractors.map((e) => ({ value: e.id, label: e.label }))
              ]}
              value={step.extract?.extractor ?? ''}
              onChange={(v: string) => {
                const rest = { ...step }
                delete rest.extract
                onChange(v ? { ...rest, extract: { extractor: v } } : rest)
              }}
            />
          </HStack>
        </VStack>
      )
    }
    case 'gate':
      return (
        <VStack gap={2}>
          <TextArea
            label="Mensagem do gate"
            value={step.message}
            rows={2}
            onChange={(message) => onChange({ ...step, message })}
          />
          <HStack gap={2} wrap="wrap">
            <Selector
              label="Mostrar ao aprovar"
              options={[
                { value: 'diff', label: 'Diff da pasta de trabalho' },
                { value: 'summary', label: 'Resumo da última execução' },
                { value: 'backlog', label: 'Spec e plano (task do Backlog)' },
                { value: 'none', label: 'Nada' }
              ]}
              value={step.show}
              onChange={(v: string) => onChange({ ...step, show: v as typeof step.show })}
            />
            <Selector
              label="Ao recusar"
              options={[
                { value: 'stop', label: 'Encerrar o fluxo' },
                ...stepOptions.map((o) => ({ ...o, label: `Ir para ${o.label}` }))
              ]}
              value={step.onReject}
              onChange={(v: string) => onChange({ ...step, onReject: v })}
            />
            <TextInput
              label="Expira em minutos"
              description="Vazio = espera sem limite."
              value={step.timeoutMin === null ? '' : String(step.timeoutMin)}
              onChange={(v) => onChange({ ...step, timeoutMin: v.trim() ? Number(v) || 0 : null })}
            />
          </HStack>
        </VStack>
      )
    case 'orkio_action':
      return (
        <Selector
          label="Ação do Orkio"
          options={project.actions.map((a) => ({ value: a.id, label: a.label }))}
          value={step.action}
          onChange={(action: string) => onChange({ ...step, action })}
        />
      )
    case 'branch':
      return <BranchForm step={step} stepOptions={stepOptions} onChange={onChange} />
  }
}

type Row =
  | { type: 'step'; step: string; is: 'ok' | 'failed' | 'cancelled' }
  | { type: 'var'; key: string; op: 'eq' | 'neq' | 'exists'; value: string }
  | { type: 'visits'; step: string; lt: number }

function toRows(c: Condition): { join: 'all' | 'any'; rows: Row[] } {
  const one = (x: Condition): Row | null =>
    x.type === 'step'
      ? { type: 'step', step: x.step, is: x.is }
      : x.type === 'var'
        ? { type: 'var', key: x.key, op: x.op, value: x.value ?? '' }
        : x.type === 'visits'
          ? { type: 'visits', step: x.step, lt: x.lt }
          : null
  if (c.type === 'all' || c.type === 'any') {
    return { join: c.type, rows: c.of.map(one).filter((r): r is Row => r !== null) }
  }
  const r = one(c)
  return { join: 'all', rows: r ? [r] : [] }
}

function fromRows(join: 'all' | 'any', rows: Row[]): Condition {
  const one = (r: Row): Condition =>
    r.type === 'var'
      ? { type: 'var', key: r.key, op: r.op, ...(r.op === 'exists' ? {} : { value: r.value }) }
      : r
  // Uma condição de voltas sozinha ainda vai dentro de "todas" (é o que limita loops).
  return rows.length === 1 && rows[0]!.type !== 'visits'
    ? one(rows[0]!)
    : { type: join, of: rows.map(one) }
}

function BranchForm({
  step,
  stepOptions,
  onChange
}: {
  step: Extract<Step, { type: 'branch' }>
  stepOptions: { value: string; label: string }[]
  onChange(step: Step): void
}): React.JSX.Element {
  const { join, rows } = toRows(step.when)
  const setRows = (next: Row[], j = join): void => {
    if (next.length > 0) onChange({ ...step, when: fromRows(j, next) })
  }
  const firstStep = stepOptions[0]?.value ?? ''
  return (
    <VStack gap={2}>
      <HStack gap={2} vAlign="center">
        <Text>Se</Text>
        <Selector
          label="Combinar condições"
          isLabelHidden
          options={[
            { value: 'all', label: 'todas as condições' },
            { value: 'any', label: 'qualquer condição' }
          ]}
          value={join}
          onChange={(v: string) => setRows(rows, v as 'all' | 'any')}
        />
      </HStack>
      {rows.map((row, i) => (
        <HStack
          key={i}
          gap={2}
          vAlign="end"
          wrap="wrap"
          role="group"
          aria-label={`Condição ${i + 1}`}
        >
          <Selector
            label={`Tipo da condição ${i + 1}`}
            options={[
              { value: 'step', label: 'Resultado de um passo' },
              { value: 'var', label: 'Variável do fluxo' },
              { value: 'visits', label: 'Voltas de um passo' }
            ]}
            value={row.type}
            onChange={(t: string) =>
              setRows(
                rows.map((r, k) =>
                  k !== i
                    ? r
                    : t === 'step'
                      ? { type: 'step', step: firstStep, is: 'ok' }
                      : t === 'var'
                        ? { type: 'var', key: '', op: 'eq', value: '' }
                        : { type: 'visits', step: firstStep, lt: 2 }
                )
              )
            }
          />
          {row.type === 'var' ? (
            <>
              <TextInput
                label={`Variável (condição ${i + 1})`}
                value={row.key}
                onChange={(key) => setRows(rows.map((r, k) => (k === i ? { ...row, key } : r)))}
              />
              <Selector
                label={`Comparação (condição ${i + 1})`}
                options={[
                  { value: 'eq', label: 'é igual a' },
                  { value: 'neq', label: 'é diferente de' },
                  { value: 'exists', label: 'está preenchida' }
                ]}
                value={row.op}
                onChange={(op: string) =>
                  setRows(rows.map((r, k) => (k === i ? { ...row, op: op as typeof row.op } : r)))
                }
              />
              {row.op !== 'exists' && (
                <TextInput
                  label={`Valor (condição ${i + 1})`}
                  value={row.value}
                  onChange={(value) =>
                    setRows(rows.map((r, k) => (k === i ? { ...row, value } : r)))
                  }
                />
              )}
            </>
          ) : (
            <>
              <Selector
                label={`Passo (condição ${i + 1})`}
                options={stepOptions}
                {...(row.step ? { value: row.step } : {})}
                onChange={(s: string) =>
                  setRows(rows.map((r, k) => (k === i ? { ...row, step: s } : r)))
                }
              />
              {row.type === 'step' ? (
                <Selector
                  label={`Resultado (condição ${i + 1})`}
                  options={[
                    { value: 'ok', label: 'deu certo' },
                    { value: 'failed', label: 'falhou' },
                    { value: 'cancelled', label: 'foi cancelado' }
                  ]}
                  value={row.is}
                  onChange={(is: string) =>
                    setRows(rows.map((r, k) => (k === i ? { ...row, is: is as typeof row.is } : r)))
                  }
                />
              ) : (
                <TextInput
                  label={`Menos de quantas voltas (condição ${i + 1})`}
                  value={String(row.lt)}
                  onChange={(v) =>
                    setRows(
                      rows.map((r, k) =>
                        k === i ? { ...row, lt: Math.max(1, Number(v) || 1) } : r
                      )
                    )
                  }
                />
              )}
            </>
          )}
          {rows.length > 1 && (
            <IconButton
              size="sm"
              variant="ghost"
              label={`Remover condição ${i + 1}`}
              icon={<Icon icon={TrashIcon} />}
              onClick={() => setRows(rows.filter((_, k) => k !== i))}
            />
          )}
        </HStack>
      ))}
      <HStack gap={2} wrap="wrap" vAlign="end">
        <Button
          size="sm"
          variant="ghost"
          label="Adicionar condição"
          icon={<Icon icon={PlusIcon} />}
          onClick={() => setRows([...rows, { type: 'visits', step: firstStep, lt: 2 }])}
        />
        <Selector
          label="Então ir para"
          options={stepOptions}
          {...(step.then ? { value: step.then } : {})}
          onChange={(then: string) => onChange({ ...step, then })}
        />
        <Selector
          label="Senão"
          options={[{ value: '', label: 'Seguir para o próximo' }, ...stepOptions]}
          value={step.else ?? ''}
          onChange={(v: string) => {
            const rest = { ...step }
            delete rest.else
            onChange(v ? { ...rest, else: v } : rest)
          }}
        />
      </HStack>
    </VStack>
  )
}
