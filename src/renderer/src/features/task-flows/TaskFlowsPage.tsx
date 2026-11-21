import { useEffect, useMemo, useState } from 'react'
import { Button } from '@astryxdesign/core/Button'
import { Card } from '@astryxdesign/core/Card'
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput'
import { Code } from '@astryxdesign/core/Code'
import { HStack } from '@astryxdesign/core/HStack'
import { Heading } from '@astryxdesign/core/Heading'
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
  const [selected, setSelected] = useState<string | null>(null)
  const [catalog, setCatalog] = useState<CatalogGroup[] | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  useEffect(() => {
    let active = true
    void window.orkio.taskFlows.getProject(projectId).then((r) => {
      if (!active) return
      if (r.ok) {
        setProject(r.value)
        setFlows(r.value.flows)
        setSelected(r.value.flows[0]?.id ?? null)
      } else setMessage({ tone: 'error', text: r.error.message })
    })
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
    setMessage(
      r.ok ? { tone: 'ok', text: 'Fluxos salvos.' } : { tone: 'error', text: r.error.message }
    )
  }

  return (
    <VStack gap={5} role="region" aria-label="Fluxos do projeto">
      <HStack gap={2} vAlign="center" wrap="wrap">
        <Text color="secondary">
          Ligue um fluxo a uma coluna em Etapas e automações (“Fluxo desta coluna”).
        </Text>
        <StackItem size="fill" />
        <Button
          variant="primary"
          label="Salvar fluxos"
          isLoading={saving}
          isDisabled={hasErrors}
          {...(hasErrors ? { disabledMessage: 'Corrija os erros antes de salvar.' } : {})}
          onClick={() => void save()}
        />
      </HStack>
      {message &&
        (message.tone === 'error' ? (
          <Alert tone="danger">{message.text}</Alert>
        ) : (
          <Text role="status">{message.text}</Text>
        ))}

      <Card role="region" aria-label="Entrega">
        <VStack gap={2}>
          <Heading level={3}>Entrega</Heading>
          <CheckboxInput
            label="Exigir minha aprovação para push"
            description="Antes de cada push da branch da tarefa (pelo Orkio ou pelo Claude Code em modo entrega), o fluxo mostra commits, diff e destino e espera você. A branch padrão (main/master, develop, production, release) nunca recebe push, com ou sem este ajuste."
            value={project.delivery.requirePushApproval}
            onChange={(on) =>
              void window.orkio.taskFlows
                .setDelivery(projectId, { requirePushApproval: on })
                .then((r) => {
                  if (r.ok) setProject(r.value)
                  else setMessage({ tone: 'error', text: r.error.message })
                })
            }
          />
        </VStack>
      </Card>

      <HStack gap={5} vAlign="start">
        <VStack gap={2} width="calc(var(--spacing-12) * 5)" style={{ flexShrink: 0 }}>
          <List hasDividers density="compact" aria-label="Fluxos do projeto">
            {flows.map((f) => {
              const errors = issuesByFlow.get(f.id)?.filter((i) => i.level === 'error').length ?? 0
              return (
                <Item
                  as="li"
                  key={f.id}
                  label={f.name || 'Sem nome'}
                  description={`${f.steps.length} passo(s)`}
                  isSelected={f.id === selected}
                  onClick={() => setSelected(f.id)}
                  {...(errors > 0
                    ? { endContent: <Token size="sm" color="red" label={`${errors} erro(s)`} /> }
                    : {})}
                />
              )
            })}
          </List>
          <Button
            variant="secondary"
            label="Novo fluxo"
            icon={<Icon icon={PlusIcon} />}
            onClick={() => {
              const f: Flow = { id: newFlowId(), name: 'Novo fluxo', steps: [] }
              setFlows((all) => [...all, f])
              setSelected(f.id)
            }}
          />
        </VStack>

        <StackItem size="fill">
          {flow ? (
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
            />
          ) : (
            <Text type="supporting">Crie ou escolha um fluxo.</Text>
          )}
        </StackItem>
      </HStack>
    </VStack>
  )
}

function FlowEditor({
  flow,
  catalog,
  project,
  issues,
  onChange,
  onRemove
}: {
  flow: Flow
  catalog: CatalogGroup[] | null
  project: TaskFlowsProject
  issues: ReturnType<typeof validateTaskFlow>
  onChange(flow: Flow): void
  onRemove(): void
}): React.JSX.Element {
  const [addType, setAddType] = useState<StepType>('claude_command')
  const setStep = (index: number, step: Step): void =>
    onChange({ ...flow, steps: flow.steps.map((s, i) => (i === index ? step : s)) })
  const move = (index: number, delta: number): void => {
    const steps = [...flow.steps]
    const [s] = steps.splice(index, 1)
    steps.splice(index + delta, 0, s!)
    onChange({ ...flow, steps })
  }
  const stepOptions = flow.steps.map((s) => ({ value: s.id, label: `${s.name} (${s.id})` }))

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

      <VStack gap={3} role="list" aria-label="Passos do fluxo">
        {flow.steps.map((step, index) => (
          <Card
            key={`${index}:${step.type}`}
            role="listitem"
            aria-label={`Passo ${index + 1}: ${step.name}`}
            variant="muted"
            padding={3}
          >
            <VStack gap={3}>
              <HStack gap={2} vAlign="center" wrap="wrap">
                <Text type="supporting">{index + 1}.</Text>
                <Token size="sm" label={STEP_TYPE_LABEL[step.type]} />
                <Code>{step.id}</Code>
                <StackItem size="fill" />
                <IconButton
                  size="sm"
                  variant="ghost"
                  label={`Subir passo ${index + 1}`}
                  icon={<Icon icon={ArrowUpIcon} />}
                  isDisabled={index === 0}
                  onClick={() => index > 0 && move(index, -1)}
                />
                <IconButton
                  size="sm"
                  variant="ghost"
                  label={`Descer passo ${index + 1}`}
                  icon={<Icon icon={ArrowDownIcon} />}
                  isDisabled={index === flow.steps.length - 1}
                  onClick={() => index < flow.steps.length - 1 && move(index, 1)}
                />
                <IconButton
                  size="sm"
                  variant="ghost"
                  label={`Remover passo ${index + 1}`}
                  icon={<Icon icon={TrashIcon} />}
                  onClick={() =>
                    onChange({ ...flow, steps: flow.steps.filter((_, i) => i !== index) })
                  }
                />
              </HStack>
              <HStack gap={2} wrap="wrap">
                <TextInput
                  label={`Nome do passo ${index + 1}`}
                  value={step.name}
                  onChange={(name) => setStep(index, { ...step, name })}
                />
                <TextInput
                  label={`Chave do passo ${index + 1}`}
                  description="Usada em saltos e condições."
                  value={step.id}
                  onChange={(id) => setStep(index, { ...step, id: id.toLowerCase() })}
                />
              </HStack>
              <StepForm
                index={index}
                step={step}
                catalog={catalog}
                project={project}
                stepOptions={stepOptions}
                onChange={(s) => setStep(index, s)}
              />
            </VStack>
          </Card>
        ))}
      </VStack>

      <HStack gap={2} vAlign="end">
        <Selector
          label="Tipo do novo passo"
          options={(Object.keys(STEP_TYPE_LABEL) as StepType[]).map((t) => ({
            value: t,
            label: STEP_TYPE_LABEL[t]
          }))}
          value={addType}
          onChange={(v: string) => setAddType(v as StepType)}
        />
        <Button
          variant="secondary"
          label="Adicionar passo"
          icon={<Icon icon={PlusIcon} />}
          onClick={() => onChange({ ...flow, steps: [...flow.steps, emptyStep(flow, addType)] })}
        />
      </HStack>
    </VStack>
  )
}

function StepForm({
  index,
  step,
  catalog,
  project,
  stepOptions,
  onChange
}: {
  index: number
  step: Step
  catalog: CatalogGroup[] | null
  project: TaskFlowsProject
  stepOptions: { value: string; label: string }[]
  onChange(step: Step): void
}): React.JSX.Element {
  const n = index + 1
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
              label={`Comando do passo ${n}`}
              hasSearch
              searchPlaceholder="Buscar comando…"
              isLoading={catalog === null}
              options={options}
              {...(step.command ? { value: step.command } : {})}
              onChange={(command: string) => onChange({ ...step, command })}
            />
          ) : (
            <TextInput
              label={`Comando do passo ${n}`}
              description="Nenhum comando no catálogo; digite o nome."
              value={step.command}
              onChange={(command) => onChange({ ...step, command: command.replace(/^\//, '') })}
            />
          )}
          <TextInput
            label={`Argumentos do passo ${n}`}
            description="Variáveis: {{briefing_path}}, {{task_id}}, {{notion_url}}, {{flow.<chave>}}"
            value={step.args}
            onChange={(args) => onChange({ ...step, args })}
          />
          <CheckboxInput
            label={`Modo entrega (passo ${n})`}
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
              label={`Tempo limite em minutos (passo ${n})`}
              value={String(step.timeoutMin)}
              onChange={(v) => onChange({ ...step, timeoutMin: Number(v) || 0 })}
            />
            <Selector
              label={`Gravar variáveis (passo ${n})`}
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
            label={`Mensagem do gate (passo ${n})`}
            value={step.message}
            rows={2}
            onChange={(message) => onChange({ ...step, message })}
          />
          <HStack gap={2} wrap="wrap">
            <Selector
              label={`Mostrar ao aprovar (passo ${n})`}
              options={[
                { value: 'diff', label: 'Diff do ambiente' },
                { value: 'summary', label: 'Resumo da última execução' },
                { value: 'none', label: 'Nada' }
              ]}
              value={step.show}
              onChange={(v: string) => onChange({ ...step, show: v as typeof step.show })}
            />
            <Selector
              label={`Ao recusar (passo ${n})`}
              options={[
                { value: 'stop', label: 'Encerrar o fluxo' },
                ...stepOptions.map((o) => ({ ...o, label: `Ir para ${o.label}` }))
              ]}
              value={step.onReject}
              onChange={(v: string) => onChange({ ...step, onReject: v })}
            />
            <TextInput
              label={`Expira em minutos (passo ${n})`}
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
          label={`Ação do Orkio (passo ${n})`}
          options={project.actions.map((a) => ({ value: a.id, label: a.label }))}
          value={step.action}
          onChange={(action: string) => onChange({ ...step, action })}
        />
      )
    case 'branch':
      return <BranchForm n={n} step={step} stepOptions={stepOptions} onChange={onChange} />
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
  n,
  step,
  stepOptions,
  onChange
}: {
  n: number
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
          label={`Combinar condições (passo ${n})`}
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
          aria-label={`Condição ${i + 1} do passo ${n}`}
        >
          <Selector
            label={`Tipo da condição ${i + 1} (passo ${n})`}
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
                label={`Variável (condição ${i + 1}, passo ${n})`}
                value={row.key}
                onChange={(key) => setRows(rows.map((r, k) => (k === i ? { ...row, key } : r)))}
              />
              <Selector
                label={`Comparação (condição ${i + 1}, passo ${n})`}
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
                  label={`Valor (condição ${i + 1}, passo ${n})`}
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
                label={`Passo (condição ${i + 1}, passo ${n})`}
                options={stepOptions}
                {...(row.step ? { value: row.step } : {})}
                onChange={(s: string) =>
                  setRows(rows.map((r, k) => (k === i ? { ...row, step: s } : r)))
                }
              />
              {row.type === 'step' ? (
                <Selector
                  label={`Resultado (condição ${i + 1}, passo ${n})`}
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
                  label={`Menos de quantas voltas (condição ${i + 1}, passo ${n})`}
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
              label={`Remover condição ${i + 1} do passo ${n}`}
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
          label={`Então ir para (passo ${n})`}
          options={stepOptions}
          {...(step.then ? { value: step.then } : {})}
          onChange={(then: string) => onChange({ ...step, then })}
        />
        <Selector
          label={`Senão (passo ${n})`}
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
