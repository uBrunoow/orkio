import { useEffect, useId, useMemo, useState } from 'react'
import { useProjectActivity } from '../../components/SentenceDetail'
import { FlowDetail } from './FlowDetail'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Select, type SelectOption } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import {
  CheckboxField,
  SegmentedControl,
  SelectField,
  TextAreaField,
  TextField
} from '@/components/form'
import { cn } from '@/lib/utils'
import type { CatalogGroup } from '../../../../shared/agent-run'
import type { TaskFlowsProject } from '../../../../shared/ipc-contract'
import {
  MAX_REVISE,
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
import { RuntimePicker, useSupportsEffort } from '../claude/RuntimePicker'
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, TrashIcon } from '../../components/icons'

/** Chip mono (categoria do passo, contagem de erros). */
function Chip({
  tone = 'neutral',
  children
}: {
  tone?: 'neutral' | 'danger'
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 font-mono text-2xs whitespace-nowrap',
        tone === 'danger'
          ? 'border-danger-tint-border bg-danger-tint text-danger'
          : 'border-border-soft text-muted-foreground'
      )}
    >
      {children}
    </span>
  )
}

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

  if (!project) return <Skeleton className="h-60" aria-label="Carregando fluxos" />

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
    <section role="region" aria-label="Fluxos do projeto" className="flex flex-col gap-[18px]">
      <p className="text-xs text-muted-foreground">
        Ligue um fluxo a uma coluna em Etapas e automações (“Fluxo desta coluna”). O ajuste de push
        fica lá também, em Entrega.
      </p>

      {flows.length === 0 ? (
        <PageState
          kind="empty"
          title="Nenhum fluxo ainda"
          description="Um fluxo roda sozinho numa tarefa: comandos do Claude Code, suas aprovações e ações do Orkio, em ordem. Comece do zero ou use um dos Modelos do alva-flow, mais abaixo."
          action={{ label: 'Novo fluxo', onClick: createFlow }}
        />
      ) : (
        <div className="flex items-start gap-5">
          <div className="flex w-60 shrink-0 flex-col gap-2">
            <ul
              aria-label="Fluxos do projeto"
              className="overflow-hidden rounded-xl border border-border-soft bg-card"
            >
              {flows.map((f) => {
                const errors =
                  issuesByFlow.get(f.id)?.filter((i) => i.level === 'error').length ?? 0
                const isSelected = f.id === selected
                return (
                  <li key={f.id} className="border-b border-border-soft last:border-b-0">
                    <button
                      type="button"
                      aria-current={isSelected ? 'true' : undefined}
                      onClick={() => {
                        setSelected(f.id)
                        setEditingId(null)
                      }}
                      className={cn(
                        'flex w-full items-center gap-2 px-3 py-2.5 text-left outline-none hover:bg-muted focus-visible:bg-muted',
                        isSelected && 'bg-muted'
                      )}
                    >
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className={cn('truncate text-sm', isSelected && 'font-medium')}>
                          {f.name || 'Sem nome'}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {plural(f.steps.length, 'passo', 'passos')}
                        </span>
                      </span>
                      {errors > 0 && <Chip tone="danger">{plural(errors, 'erro', 'erros')}</Chip>}
                    </button>
                  </li>
                )
              })}
            </ul>
            <Button variant="outline" onClick={createFlow}>
              <PlusIcon />
              Novo fluxo
            </Button>
          </div>

          <div className="min-w-0 flex-1">
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
              <p className="text-xs text-muted-foreground">Crie ou escolha um fluxo.</p>
            )}
          </div>
        </div>
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
              <p role="status" className="text-sm text-ok">
                {message.text}
              </p>
            ))}
        </SaveBar>
      )}
    </section>
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
        step.prompt !== undefined
          ? `pedido: “${step.prompt.trim() || '…'}”`
          : `/${step.command || '…'} ${step.args}`.trim(),
        `${step.timeoutMin} min`,
        ...(step.readOnly ? ['só leitura'] : []),
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
              : step.show === 'result'
                ? 'mostra o resultado'
                : null,
        `recusar → ${step.onReject === 'stop' ? 'encerra' : step.onReject}`,
        step.revise ? `ajustes → ${step.revise.step} (até ${step.revise.max})` : null
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
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-2">
        <TextField
          label="Nome do fluxo"
          value={flow.name}
          onChange={(name) => onChange({ ...flow, name })}
          className="min-w-48 flex-1"
        />
        <Button variant="outline" onClick={onDone}>
          Ver em frase
        </Button>
        <Button variant="ghost" onClick={onRemove}>
          <TrashIcon />
          Remover fluxo
        </Button>
      </div>

      {issues.length > 0 && (
        <ul aria-label="Problemas do fluxo" className="flex flex-col gap-1">
          {issues.map((i, n) => (
            <li key={n}>
              <Alert tone={i.level === 'error' ? 'danger' : 'warning'}>{i.message}</Alert>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <h3 className="flex-1 text-sm font-medium">Passos</h3>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline">
                <PlusIcon />
                Adicionar passo
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {(Object.keys(STEP_TYPE_LABEL) as StepType[]).map((t) => (
                <DropdownMenuItem key={t} onSelect={() => add(t)}>
                  {STEP_TYPE_LABEL[t]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {flow.steps.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Nenhum passo ainda. Use “Adicionar passo”.
          </p>
        ) : (
          <ul
            aria-label="Passos do fluxo"
            className="overflow-hidden rounded-xl border border-border-soft bg-card"
          >
            {flow.steps.map((s, i) => {
              const problems = problemsOf(s.id)
              const isSelected = i === index
              return (
                <li
                  key={`${i}:${s.type}`}
                  aria-label={`Passo ${i + 1}: ${s.name}`}
                  className="border-b border-border-soft last:border-b-0"
                >
                  <button
                    type="button"
                    aria-current={isSelected ? 'step' : undefined}
                    onClick={() => setSelectedIndex(i)}
                    className={cn(
                      'flex w-full items-center gap-3 px-4 py-2.5 text-left outline-none hover:bg-muted focus-visible:bg-muted',
                      isSelected && 'bg-muted'
                    )}
                  >
                    <span className="tabular w-5 shrink-0 font-mono text-xs text-subtle-foreground">
                      {i + 1}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className={cn('truncate text-sm', isSelected && 'font-medium')}>
                        {s.name}
                      </span>
                      <span className="truncate font-mono text-xs text-subtle-foreground">
                        {stepSummary(s)}
                      </span>
                    </span>
                    {problems > 0 && <Chip tone="danger">{plural(problems, 'erro', 'erros')}</Chip>}
                    <Chip>{STEP_TYPE_LABEL[s.type]}</Chip>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {step && (
        <section
          role="region"
          aria-label={`Editar passo ${index + 1}`}
          className="flex flex-col gap-3 rounded-xl border border-border-soft bg-surface p-4"
        >
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-medium">{`Passo ${index + 1}`}</h3>
            <Chip>{STEP_TYPE_LABEL[step.type]}</Chip>
            <div className="flex-1" />
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Subir passo"
              disabled={index === 0}
              onClick={() => index > 0 && move(index, -1)}
            >
              <ArrowUpIcon />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Descer passo"
              disabled={index === flow.steps.length - 1}
              onClick={() => index < flow.steps.length - 1 && move(index, 1)}
            >
              <ArrowDownIcon />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Remover passo"
              onClick={() => {
                onChange({ ...flow, steps: flow.steps.filter((_, i) => i !== index) })
                setSelectedIndex(Math.max(0, index - 1))
              }}
            >
              <TrashIcon />
            </Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField
              label="Nome"
              value={step.name}
              onChange={(name) => setStep(index, { ...step, name })}
            />
            <TextField
              label="Chave"
              description="Usada em saltos e condições."
              value={step.id}
              mono
              onChange={(id) => setStep(index, { ...step, id: id.toLowerCase() })}
            />
          </div>
          <StepForm
            key={index}
            step={step}
            catalog={catalog}
            project={project}
            stepOptions={stepOptions}
            claudeSteps={flow.steps
              .slice(0, index)
              .filter((s) => s.type === 'claude_command')
              .map((s) => ({ value: s.id, label: `${s.name} (${s.id})` }))}
            onChange={(s) => setStep(index, s)}
          />
        </section>
      )}
    </div>
  )
}

function StepForm({
  step,
  catalog,
  project,
  stepOptions,
  claudeSteps,
  onChange
}: {
  step: Step
  catalog: CatalogGroup[] | null
  project: TaskFlowsProject
  stepOptions: { value: string; label: string }[]
  /** Passos do Claude Code (alvo de "Pedir ajustes"). */
  claudeSteps: { value: string; label: string }[]
  onChange(step: Step): void
}): React.JSX.Element {
  const supportsEffort = useSupportsEffort()
  const runtimeLabelId = useId()
  switch (step.type) {
    case 'claude_command': {
      const options: SelectOption[] =
        catalog && catalog.length > 0
          ? catalog.flatMap((g) =>
              g.commands.map((c) => ({
                value: c.name,
                label: `/${c.name}`,
                group: g.title,
                ...(c.description ? { description: c.description } : {})
              }))
            )
          : []
      const asPrompt = step.prompt !== undefined
      return (
        <div className="flex flex-col gap-3">
          <SegmentedControl
            label="O que o passo manda"
            className="self-start"
            options={[
              { value: 'command', label: 'Comando' },
              { value: 'prompt', label: 'Pedido em texto' }
            ]}
            value={asPrompt ? 'prompt' : 'command'}
            onChange={(v) => {
              const rest = { ...step }
              delete rest.prompt
              onChange(
                v === 'prompt'
                  ? { ...rest, command: '', args: '', prompt: '' }
                  : { ...rest, args: '{{briefing_path}}' }
              )
            }}
          />
          {asPrompt ? (
            <TextAreaField
              label="Pedido"
              description="Vai na conversa da tarefa (continua a sessão mais recente; sem sessão, começa uma com o briefing). Variáveis: {{task_id}}, {{notion_url}}, {{flow.<chave>}}, {{review.pr}}…"
              value={step.prompt ?? ''}
              rows={4}
              onChange={(prompt) => onChange({ ...step, prompt })}
            />
          ) : (
            <>
              {options.length > 0 ? (
                <SelectField
                  label="Comando"
                  hasSearch
                  searchPlaceholder="Buscar comando…"
                  isLoading={catalog === null}
                  options={options}
                  value={step.command || null}
                  onChange={(command: string) => onChange({ ...step, command })}
                />
              ) : (
                <TextField
                  label="Comando"
                  description="Nenhum comando no catálogo; digite o nome."
                  value={step.command}
                  mono
                  onChange={(command) => onChange({ ...step, command: command.replace(/^\//, '') })}
                />
              )}
              <TextField
                label="Argumentos"
                description="Variáveis: {{briefing_path}}, {{task_id}}, {{notion_url}}, {{flow.<chave>}}"
                value={step.args}
                mono
                onChange={(args) => onChange({ ...step, args })}
              />
            </>
          )}
          <div className="flex flex-col gap-1.5">
            <span id={runtimeLabelId} className="text-sm font-medium">
              Modelo e raciocínio
            </span>
            <RuntimePicker
              describedBy={runtimeLabelId}
              value={{
                ...(step.model !== undefined ? { model: step.model } : {}),
                ...(step.effort !== undefined ? { effort: step.effort } : {})
              }}
              supportsEffort={supportsEffort}
              inheritLabel="Do agente"
              className="self-start border border-input bg-card"
              onChange={(v) => {
                const rest = { ...step }
                delete rest.model
                delete rest.effort
                onChange({
                  ...rest,
                  ...(v.model !== undefined ? { model: v.model ?? 'default' } : {}),
                  ...(v.effort ? { effort: v.effort } : {})
                })
              }}
            />
          </div>
          <CheckboxField
            label="Só leitura"
            description="O Claude Code não recebe as ferramentas de edição e nada é aprovado sozinho: todo comando pede sua aprovação (bom para pedir um plano antes de mexer no código). Não combina com modo entrega."
            checked={step.readOnly === true}
            onChange={(on) => {
              const rest = { ...step }
              delete rest.readOnly
              onChange(on ? { ...rest, readOnly: true } : rest)
            }}
          />
          <CheckboxField
            label="Modo entrega"
            description="Só neste passo: o Claude Code pode criar/atualizar a PR (gh) e fazer push da branch da tarefa, com sua aprovação na primeira vez. Merge, força e outras branches continuam bloqueados."
            checked={step.delivery === true}
            onChange={(on) => {
              const rest = { ...step }
              delete rest.delivery
              onChange(on ? { ...rest, delivery: true } : rest)
            }}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField
              label="Tempo limite em minutos"
              value={String(step.timeoutMin)}
              onChange={(v) => onChange({ ...step, timeoutMin: Number(v) || 0 })}
            />
            <SelectField
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
          </div>
        </div>
      )
    }
    case 'gate':
      return (
        <div className="flex flex-col gap-3">
          <TextAreaField
            label="Mensagem do gate"
            value={step.message}
            rows={2}
            onChange={(message) => onChange({ ...step, message })}
          />
          <div className="grid gap-3 sm:grid-cols-3">
            <SelectField
              label="Mostrar ao aprovar"
              options={[
                { value: 'diff', label: 'Diff da pasta de trabalho' },
                { value: 'summary', label: 'Resumo da última execução' },
                { value: 'backlog', label: 'Spec e plano (task do Backlog)' },
                { value: 'result', label: 'Resultado do Claude Code (texto final)' },
                { value: 'none', label: 'Nada' }
              ]}
              value={step.show}
              onChange={(v: string) => onChange({ ...step, show: v as typeof step.show })}
            />
            <SelectField
              label="Ao recusar"
              options={[
                { value: 'stop', label: 'Encerrar o fluxo' },
                ...stepOptions.map((o) => ({ ...o, label: `Ir para ${o.label}` }))
              ]}
              value={step.onReject}
              onChange={(v: string) => onChange({ ...step, onReject: v })}
            />
            <TextField
              label="Expira em minutos"
              description="Vazio = espera sem limite."
              value={step.timeoutMin === null ? '' : String(step.timeoutMin)}
              onChange={(v) => onChange({ ...step, timeoutMin: v.trim() ? Number(v) || 0 : null })}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField
              label="Pedir ajustes"
              description="Mostra “Pedir ajustes…” no gate: o seu texto volta a este passo, na mesma conversa, e a aprovação aparece de novo."
              options={[
                { value: '', label: 'Não oferecer' },
                ...claudeSteps.map((o) => ({ ...o, label: `Voltar para ${o.label}` }))
              ]}
              value={step.revise?.step ?? ''}
              onChange={(v: string) => {
                const rest = { ...step }
                delete rest.revise
                onChange(v ? { ...rest, revise: { step: v, max: step.revise?.max ?? 3 } } : rest)
              }}
            />
            {step.revise && (
              <TextField
                label="Limite de ajustes"
                description={`De 1 a ${MAX_REVISE}.`}
                value={String(step.revise.max)}
                onChange={(v) =>
                  onChange({ ...step, revise: { step: step.revise!.step, max: Number(v) || 0 } })
                }
              />
            )}
          </div>
        </div>
      )
    case 'orkio_action':
      return (
        <SelectField
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
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="text-sm">Se</span>
        <Select
          aria-label="Combinar condições"
          size="sm"
          className="w-52"
          options={[
            { value: 'all', label: 'todas as condições' },
            { value: 'any', label: 'qualquer condição' }
          ]}
          value={join}
          onChange={(v: string) => setRows(rows, v as 'all' | 'any')}
        />
      </div>
      {rows.map((row, i) => (
        <div
          key={i}
          role="group"
          aria-label={`Condição ${i + 1}`}
          className="flex flex-wrap items-end gap-2 rounded-lg border border-border-soft bg-card p-3"
        >
          <SelectField
            label={`Tipo da condição ${i + 1}`}
            className="min-w-48 flex-1"
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
              <TextField
                label={`Variável (condição ${i + 1})`}
                className="min-w-40 flex-1"
                mono
                value={row.key}
                onChange={(key) => setRows(rows.map((r, k) => (k === i ? { ...row, key } : r)))}
              />
              <SelectField
                label={`Comparação (condição ${i + 1})`}
                className="min-w-40 flex-1"
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
                <TextField
                  label={`Valor (condição ${i + 1})`}
                  className="min-w-40 flex-1"
                  value={row.value}
                  onChange={(value) =>
                    setRows(rows.map((r, k) => (k === i ? { ...row, value } : r)))
                  }
                />
              )}
            </>
          ) : (
            <>
              <SelectField
                label={`Passo (condição ${i + 1})`}
                className="min-w-48 flex-1"
                options={stepOptions}
                value={row.step || null}
                onChange={(s: string) =>
                  setRows(rows.map((r, k) => (k === i ? { ...row, step: s } : r)))
                }
              />
              {row.type === 'step' ? (
                <SelectField
                  label={`Resultado (condição ${i + 1})`}
                  className="min-w-40 flex-1"
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
                <TextField
                  label={`Menos de quantas voltas (condição ${i + 1})`}
                  className="min-w-40 flex-1"
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
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={`Remover condição ${i + 1}`}
              onClick={() => setRows(rows.filter((_, k) => k !== i))}
            >
              <TrashIcon />
            </Button>
          )}
        </div>
      ))}
      <div className="flex flex-wrap items-end gap-2">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setRows([...rows, { type: 'visits', step: firstStep, lt: 2 }])}
        >
          <PlusIcon />
          Adicionar condição
        </Button>
        <SelectField
          label="Então ir para"
          className="min-w-48 flex-1"
          options={stepOptions}
          value={step.then || null}
          onChange={(then: string) => onChange({ ...step, then })}
        />
        <SelectField
          label="Senão"
          className="min-w-48 flex-1"
          options={[{ value: '', label: 'Seguir para o próximo' }, ...stepOptions]}
          value={step.else ?? ''}
          onChange={(v: string) => {
            const rest = { ...step }
            delete rest.else
            onChange(v ? { ...rest, else: v } : rest)
          }}
        />
      </div>
    </div>
  )
}
