import { useEffect, useMemo, useState } from 'react'
import { Button } from '@astryxdesign/core/Button'
import { Card } from '@astryxdesign/core/Card'
import { HStack } from '@astryxdesign/core/HStack'
import { Heading } from '@astryxdesign/core/Heading'
import { Icon } from '@astryxdesign/core/Icon'
import { IconButton } from '@astryxdesign/core/IconButton'
import { Item } from '@astryxdesign/core/Item'
import { List } from '@astryxdesign/core/List'
import { MoreMenu } from '@astryxdesign/core/MoreMenu'
import { RadioList, RadioListItem } from '@astryxdesign/core/RadioList'
import { Selector } from '@astryxdesign/core/Selector'
import { StackItem } from '@astryxdesign/core/Stack'
import { Text } from '@astryxdesign/core/Text'
import { TextInput } from '@astryxdesign/core/TextInput'
import { Skeleton } from '@astryxdesign/core/Skeleton'
import { Token } from '@astryxdesign/core/Token'
import { VStack } from '@astryxdesign/core/VStack'
import type { AutomationRule, EventKind } from '../../../../shared/automation'
import type { Flow, StageFlow } from '../../../../shared/task-flow'
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput'
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl'
import {
  EVENT_DESCRIPTIONS,
  EVENT_KINDS,
  EVENT_LABELS,
  FLOW_COLORS,
  describeRule,
  exportFlow,
  fromBoardStages,
  importFlow,
  restoreDefaultFlow,
  simulate,
  validateFlow,
  type FlowDraft,
  type FlowStageDraft,
  type SimulationResult
} from '../../../../shared/flow'
import type {
  BoardView,
  ConfigEvent,
  NotionColor,
  NotionResult
} from '../../../../shared/ipc-contract'
import { Alert } from '../../components/Alert'
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, TrashIcon } from '../../components/icons'
import { tokenColor } from '../notion-workspace/notion-colors'

const COLOR_LABELS: Record<NotionColor, string> = {
  default: 'Padrão',
  gray: 'Cinza',
  brown: 'Marrom',
  orange: 'Laranja',
  yellow: 'Amarelo',
  green: 'Verde',
  blue: 'Azul',
  purple: 'Roxo',
  pink: 'Rosa',
  red: 'Vermelho'
}

const newId = (prefix: string): string =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

function initialDraft(view: BoardView): FlowDraft {
  return {
    stages: fromBoardStages(view.config!.stages),
    rules: view.config!.rules.map((r) => structuredClone(r)),
    removals: {}
  }
}

interface RuleEditing {
  rule: AutomationRule
  isNew: boolean
}

/**
 * Tela "Fluxo do projeto" (3C): etapas e automações num rascunho. Nada vale até "Salvar fluxo"
 * (o main valida de novo). Simular usa o motor puro da 3B sobre o rascunho, sem executar nada.
 */
export function FlowPage({
  view,
  onSaved,
  onClose,
  onOpenNotionSettings,
  onOpenTaskFlows
}: {
  view: BoardView
  onSaved(view: BoardView): void
  onClose(): void
  onOpenNotionSettings(): void
  /** "Criar fluxo" numa coluna: leva à tela Fluxos (5A). */
  onOpenTaskFlows(): void
}): React.JSX.Element {
  const [draft, setDraft] = useState<FlowDraft>(() => initialDraft(view))
  const [editing, setEditing] = useState<RuleEditing | null>(null)
  const [acceptWarnings, setAcceptWarnings] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ tone: 'danger' | 'warning'; text: string } | null>(null)
  const [events, setEvents] = useState<ConfigEvent[]>([])
  const [eventsKey, setEventsKey] = useState(0)
  /** 5A: fluxos de tarefa do projeto e as ligações salvas (para "Fluxo desta coluna"). */
  const [taskFlows, setTaskFlows] = useState<{ flows: Flow[]; bindings: StageFlow[] } | null>(null)

  useEffect(() => {
    let active = true
    void window.orkio.taskFlows.getProject(view.projectId).then((r) => {
      if (!active || !r.ok) return
      setTaskFlows({ flows: r.value.flows, bindings: r.value.bindings })
      // O rascunho ganha as ligações salvas (se ainda não tiver mexido nelas).
      setDraft((d) => (d.bindings ? d : { ...d, bindings: r.value.bindings }))
    })
    return () => {
      active = false
    }
  }, [view.projectId])

  const saved = view.config!
  const options = view.statusOptions
  const taskCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const c of view.cards) if (c.stageId) counts[c.stageId] = (counts[c.stageId] ?? 0) + 1
    return counts
  }, [view.cards])

  useEffect(() => {
    let active = true
    void window.orkio.flow
      .events(view.projectId)
      .then((list) => {
        if (active) setEvents(list)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [view.projectId, eventsKey])

  const issues = useMemo(
    () =>
      validateFlow(draft, {
        statusOptions: options,
        savedStageIds: saved.stages.map((s) => s.id),
        taskCounts
      }),
    [draft, options, saved.stages, taskCounts]
  )
  const errors = issues.filter((i) => i.level === 'error')
  const warnings = issues.filter((i) => i.level === 'warning')

  const update = (patch: (d: FlowDraft) => FlowDraft): void => {
    setDraft((d) => patch(structuredClone(d)))
    setAcceptWarnings(false)
  }
  const updateStage = (id: string, patch: Partial<FlowStageDraft>): void =>
    update((d) => ({ ...d, stages: d.stages.map((s) => (s.id === id ? { ...s, ...patch } : s)) }))
  const setStageStatus = (id: string, optionId: string): void =>
    update((d) => ({
      ...d,
      stages: d.stages.map((s) => {
        if (s.id !== id) return s
        const { missingStatusName: _ignored, ...rest } = s
        void _ignored
        return { ...rest, notionStatusId: optionId }
      })
    }))
  const moveStage = (index: number, delta: number): void =>
    update((d) => {
      const stages = [...d.stages]
      const [s] = stages.splice(index, 1)
      stages.splice(index + delta, 0, s!)
      return { ...d, stages }
    })
  const addStageAfter = (index: number): void =>
    update((d) => {
      const stages = [...d.stages]
      stages.splice(index + 1, 0, { id: newId('stage'), name: '', notionStatusId: null })
      return { ...d, stages }
    })
  const removeStage = (id: string): void =>
    update((d) => ({
      ...d,
      stages: d.stages.filter((s) => s.id !== id),
      removals: saved.stages.some((s) => s.id === id) ? { ...d.removals, [id]: null } : d.removals,
      ...(d.bindings ? { bindings: d.bindings.filter((b) => b.stageId !== id) } : {})
    }))
  const moveRule = (id: string, delta: number): void =>
    update((d) => {
      const rules = [...d.rules]
      const i = rules.findIndex((r) => r.id === id)
      const j = i + delta
      if (i < 0 || j < 0 || j >= rules.length) return d
      ;[rules[i], rules[j]] = [rules[j]!, rules[i]!]
      return { ...d, rules }
    })

  async function save(): Promise<void> {
    setSaving(true)
    setMessage(null)
    let result: NotionResult<BoardView>
    try {
      result = await window.orkio.flow.save(view.projectId, draft)
    } catch {
      result = {
        ok: false,
        error: { code: 'ipc', message: 'Não foi possível falar com o processo principal do Orkio.' }
      }
    }
    setSaving(false)
    if (!result.ok) {
      setMessage({ tone: 'danger', text: result.error.message })
      return
    }
    setEventsKey((n) => n + 1)
    onSaved(result.value)
  }

  async function doExport(): Promise<void> {
    const file = exportFlow(draft, options, new Date().toISOString())
    const result = await window.orkio.flow.exportFile(file).catch(() => null)
    if (result && !result.ok && !result.cancelled) {
      setMessage({ tone: 'danger', text: result.message ?? 'Não foi possível exportar.' })
    } else if (result?.ok) {
      setMessage({ tone: 'warning', text: 'Fluxo exportado.' })
    }
  }

  async function doImport(): Promise<void> {
    const result = await window.orkio.flow.importFile().catch(() => null)
    if (!result || (!result.ok && result.cancelled)) return
    if (!result.ok) {
      setMessage({ tone: 'danger', text: result.message ?? 'Não foi possível importar.' })
      return
    }
    const parsed = importFlow(result.content, options, () => newId('stage'))
    if (!parsed.ok) {
      setMessage({ tone: 'danger', text: parsed.error })
      return
    }
    update((d) => ({
      ...d,
      ...parsed.draft,
      removals: Object.fromEntries(saved.stages.map((s) => [s.id, null]))
    }))
    setMessage({
      tone: 'warning',
      text: `Fluxo importado no rascunho. ${parsed.warnings.join(' ')} Revise e salve para aplicar.`.trim()
    })
  }

  function restoreDefault(): void {
    const restored = restoreDefaultFlow(draft.stages, options, () => newId('stage'))
    update((d) => ({
      ...d,
      ...restored,
      removals: Object.fromEntries(
        saved.stages
          .filter((s) => !restored.stages.some((r) => r.id === s.id))
          .map((s) => [s.id, null])
      )
    }))
  }

  const removedWithTasks = saved.stages.filter(
    (s) => !draft.stages.some((d) => d.id === s.id) && (taskCounts[s.id] ?? 0) > 0
  )
  const notifyRules = draft.rules.filter((r) => r.action.type === 'notify')
  const ruleIndex = (id: string): number => draft.rules.findIndex((r) => r.id === id)

  const ruleItem = (rule: AutomationRule): React.JSX.Element => {
    const i = ruleIndex(rule.id)
    return (
      <Item
        as="li"
        key={rule.id}
        aria-label={rule.name}
        label={describeRule(rule, draft.stages)}
        description={`${i + 1}ª na ordem · ${EVENT_LABELS[rule.trigger]}`}
        endContent={
          <HStack gap={1} vAlign="center">
            <Token
              size="sm"
              label={rule.enabled ? 'Ativa' : 'Desativada'}
              color={rule.enabled ? 'green' : 'gray'}
            />
            <MoreMenu
              size="sm"
              label={`Ações da automação ${rule.name}`}
              items={[
                {
                  label: 'Editar',
                  onClick: () => setEditing({ rule: structuredClone(rule), isNew: false })
                },
                {
                  label: rule.enabled ? 'Desativar' : 'Ativar',
                  onClick: () =>
                    update((d) => ({
                      ...d,
                      rules: d.rules.map((r) =>
                        r.id === rule.id ? { ...r, enabled: !r.enabled } : r
                      )
                    }))
                },
                { label: 'Subir na ordem', onClick: () => moveRule(rule.id, -1) },
                { label: 'Descer na ordem', onClick: () => moveRule(rule.id, 1) },
                { type: 'divider' },
                {
                  label: 'Remover',
                  onClick: () =>
                    update((d) => ({ ...d, rules: d.rules.filter((r) => r.id !== rule.id) }))
                }
              ]}
            />
          </HStack>
        }
      />
    )
  }

  return (
    <VStack gap={5}>
      <HStack gap={2} vAlign="center" wrap="wrap" role="toolbar" aria-label="Ações do fluxo">
        <StackItem size="fill" />
        <Button variant="ghost" label="Restaurar padrão" onClick={restoreDefault} />
        <Button variant="ghost" label="Exportar JSON" onClick={() => void doExport()} />
        <Button variant="ghost" label="Importar JSON" onClick={() => void doImport()} />
        <Button variant="ghost" label="Etapa Orkio e Bloqueada…" onClick={onOpenNotionSettings} />
        <Button
          variant="ghost"
          label="Descartar alterações"
          onClick={() =>
            setDraft({
              ...initialDraft(view),
              ...(taskFlows ? { bindings: taskFlows.bindings } : {})
            })
          }
        />
        <Button variant="secondary" label="Voltar ao quadro" onClick={onClose} />
      </HStack>

      {message && <Alert tone={message.tone}>{message.text}</Alert>}

      <HStack
        gap={4}
        vAlign="start"
        isScrollable
        paddingBlockEnd={2}
        role="list"
        aria-label="Etapas do fluxo"
      >
        {draft.stages.map((stage, index) => {
          const label = stage.name || `etapa ${index + 1}`
          const rules = draft.rules.filter(
            (r) => r.action.type === 'move_to_stage' && r.action.stageId === stage.id
          )
          return (
            <VStack
              key={stage.id}
              role="listitem"
              aria-label={`Etapa ${label}`}
              width="calc(var(--spacing-12) * 7)"
              style={{ flexShrink: 0 }}
            >
              <Card variant="muted" padding={3}>
                <VStack gap={3}>
                  <TextInput
                    label={`Nome da etapa ${index + 1}`}
                    value={stage.name}
                    onChange={(value) => updateStage(stage.id, { name: value })}
                  />
                  <Selector
                    label={`Status no Notion da etapa ${index + 1}`}
                    options={options.map((o) => ({ value: o.id, label: o.name }))}
                    placeholder="Escolha a opção"
                    {...(stage.notionStatusId && options.some((o) => o.id === stage.notionStatusId)
                      ? { value: stage.notionStatusId }
                      : {
                          status: {
                            type: 'error' as const,
                            message: stage.missingStatusName
                              ? `“${stage.missingStatusName}” não existe no Notion.`
                              : 'Escolha uma opção.'
                          }
                        })}
                    onChange={(value: string) => setStageStatus(stage.id, value)}
                  />
                  <Selector
                    label={`Cor da etapa ${index + 1}`}
                    options={FLOW_COLORS.map((c) => ({ value: c, label: COLOR_LABELS[c] }))}
                    value={stage.color ?? 'default'}
                    onChange={(value: string) =>
                      updateStage(stage.id, { color: value as NotionColor })
                    }
                  />
                  <HStack gap={1} vAlign="center" wrap="wrap">
                    <Token size="sm" label={label} color={tokenColor(stage.color ?? 'default')} />
                    <Text type="supporting">{taskCounts[stage.id] ?? 0} tarefa(s)</Text>
                    <StackItem size="fill" />
                    <IconButton
                      size="sm"
                      variant="ghost"
                      label={`Mover ${label} para a esquerda`}
                      icon={<Icon icon={ArrowUpIcon} />}
                      isDisabled={index === 0}
                      onClick={() => index > 0 && moveStage(index, -1)}
                    />
                    <IconButton
                      size="sm"
                      variant="ghost"
                      label={`Mover ${label} para a direita`}
                      icon={<Icon icon={ArrowDownIcon} />}
                      isDisabled={index === draft.stages.length - 1}
                      onClick={() => index < draft.stages.length - 1 && moveStage(index, 1)}
                    />
                    <IconButton
                      size="sm"
                      variant="ghost"
                      label={`Remover ${label}`}
                      icon={<Icon icon={TrashIcon} />}
                      onClick={() => removeStage(stage.id)}
                    />
                    <IconButton
                      size="sm"
                      variant="ghost"
                      label={`Adicionar etapa depois de ${label}`}
                      icon={<Icon icon={PlusIcon} />}
                      onClick={() => addStageAfter(index)}
                    />
                  </HStack>

                  <StageFlowField
                    label={label}
                    flows={taskFlows?.flows ?? null}
                    binding={draft.bindings?.find((b) => b.stageId === stage.id) ?? null}
                    onChange={(binding) =>
                      update((d) => ({
                        ...d,
                        bindings: [
                          ...(d.bindings ?? []).filter((b) => b.stageId !== stage.id),
                          ...(binding ? [binding] : [])
                        ]
                      }))
                    }
                    stageId={stage.id}
                    onOpenTaskFlows={onOpenTaskFlows}
                  />

                  <VStack gap={2}>
                    <Text weight="semibold">Automações para esta etapa</Text>
                    {rules.length === 0 ? (
                      <Text type="supporting">Nenhuma automação leva para cá.</Text>
                    ) : (
                      <List hasDividers density="compact" aria-label={`Automações para ${label}`}>
                        {rules.map(ruleItem)}
                      </List>
                    )}
                    <HStack>
                      <Button
                        size="sm"
                        label="Nova automação"
                        icon={<Icon icon={PlusIcon} />}
                        aria-label={`Nova automação para ${label}`}
                        onClick={() =>
                          setEditing({
                            isNew: true,
                            rule: {
                              id: newId('rule'),
                              name: '',
                              enabled: true,
                              trigger: 'pr.opened',
                              conditions: { notBlocked: true },
                              action: { type: 'move_to_stage', stageId: stage.id }
                            }
                          })
                        }
                      />
                    </HStack>
                  </VStack>
                </VStack>
              </Card>
            </VStack>
          )
        })}
      </HStack>

      <HStack>
        <Button
          size="sm"
          label="Adicionar etapa no fim"
          icon={<Icon icon={PlusIcon} />}
          onClick={() => addStageAfter(draft.stages.length - 1)}
        />
      </HStack>

      <Card role="region" aria-label="Notificações">
        <VStack gap={2}>
          <Text weight="semibold">Notificações (sem mover a tarefa)</Text>
          {notifyRules.length === 0 ? (
            <Text type="supporting">Nenhuma.</Text>
          ) : (
            <List hasDividers density="compact" aria-label="Automações de notificação">
              {notifyRules.map(ruleItem)}
            </List>
          )}
          <HStack>
            <Button
              size="sm"
              label="Nova notificação"
              icon={<Icon icon={PlusIcon} />}
              onClick={() =>
                setEditing({
                  isNew: true,
                  rule: {
                    id: newId('rule'),
                    name: '',
                    enabled: true,
                    trigger: 'pr.approved',
                    conditions: {},
                    action: { type: 'notify', message: '' }
                  }
                })
              }
            />
          </HStack>
        </VStack>
      </Card>

      {editing && (
        <RuleForm
          editing={editing}
          stages={draft.stages}
          onCancel={() => setEditing(null)}
          onApply={(rule) => {
            const named = { ...rule, name: rule.name.trim() || EVENT_LABELS[rule.trigger] }
            update((d) => ({
              ...d,
              rules: editing.isNew
                ? [...d.rules, named]
                : d.rules.map((r) => (r.id === named.id ? named : r))
            }))
            setEditing(null)
          }}
        />
      )}

      {removedWithTasks.length > 0 && (
        <Card role="region" aria-label="Etapas removidas">
          <VStack gap={3}>
            <Text weight="semibold">Etapas removidas com tarefas</Text>
            {removedWithTasks.map((s) => (
              <Selector
                key={s.id}
                label={`Para onde vão as ${taskCounts[s.id]} tarefa(s) de “${s.name}”`}
                options={draft.stages.map((d) => ({ value: d.id, label: d.name || '(sem nome)' }))}
                placeholder="Escolha a etapa"
                {...(draft.removals[s.id] ? { value: draft.removals[s.id]! } : {})}
                onChange={(value: string) =>
                  update((d) => ({ ...d, removals: { ...d.removals, [s.id]: value } }))
                }
              />
            ))}
          </VStack>
        </Card>
      )}

      <Simulator view={view} draft={draft} />

      <VStack gap={2} role="region" aria-label="Validação do fluxo">
        {errors.length > 0 && (
          <Alert tone="danger">
            <VStack gap={1}>
              {errors.map((i) => (
                <Text key={`${i.kind}-${i.stageId ?? ''}-${i.ruleId ?? ''}-${i.message}`}>
                  {i.message}
                </Text>
              ))}
            </VStack>
          </Alert>
        )}
        {warnings.length > 0 && (
          <Alert tone="warning">
            <VStack gap={1}>
              {warnings.map((i) => (
                <Text key={`${i.kind}-${i.ruleId ?? ''}-${i.message}`}>{i.message}</Text>
              ))}
            </VStack>
          </Alert>
        )}
        {warnings.length > 0 && errors.length === 0 && (
          <CheckboxInput
            label="Entendi os avisos e quero salvar assim"
            value={acceptWarnings}
            onChange={setAcceptWarnings}
          />
        )}
        <HStack gap={2}>
          <Button
            variant="primary"
            label="Salvar fluxo"
            isLoading={saving}
            isDisabled={errors.length > 0 || (warnings.length > 0 && !acceptWarnings)}
            onClick={() => void save()}
          />
        </HStack>
      </VStack>

      <Card role="region" aria-label="Alterações do fluxo">
        <VStack gap={2}>
          <Text weight="semibold">Alterações do fluxo</Text>
          {events.length === 0 ? (
            <Text type="supporting">Nenhuma alteração registrada.</Text>
          ) : (
            <List hasDividers density="compact" aria-label="Histórico de configuração">
              {events.map((e) => (
                <Item
                  as="li"
                  key={e.id}
                  label={e.changes.join(' · ')}
                  description={`${e.actor} · ${new Date(e.at).toLocaleString('pt-BR', {
                    dateStyle: 'short',
                    timeStyle: 'short'
                  })}`}
                />
              ))}
            </List>
          )}
        </VStack>
      </Card>
    </VStack>
  )
}

function RuleForm({
  editing,
  stages,
  onApply,
  onCancel
}: {
  editing: RuleEditing
  stages: readonly FlowStageDraft[]
  onApply(rule: AutomationRule): void
  onCancel(): void
}): React.JSX.Element {
  const [rule, setRule] = useState<AutomationRule>(editing.rule)
  const from = rule.conditions?.fromStages ?? []
  const setConditions = (patch: Partial<NonNullable<AutomationRule['conditions']>>): void =>
    setRule((r) => ({ ...r, conditions: { ...r.conditions, ...patch } }))
  const incomplete =
    (rule.action.type === 'move_to_stage' &&
      !stages.some((s) => s.id === (rule.action as { stageId: string }).stageId)) ||
    (rule.action.type === 'notify' && !rule.action.message.trim())

  return (
    <Card role="region" aria-label={editing.isNew ? 'Nova automação' : 'Editar automação'}>
      <VStack gap={3}>
        <Heading level={3}>{editing.isNew ? 'Nova automação' : 'Editar automação'}</Heading>
        <Selector
          label="Quando"
          options={EVENT_KINDS.map((k) => ({
            value: k,
            label: EVENT_LABELS[k],
            description: EVENT_DESCRIPTIONS[k]
          }))}
          value={rule.trigger}
          onChange={(value: string) => setRule((r) => ({ ...r, trigger: value as EventKind }))}
        />
        <VStack gap={1} role="group" aria-label="Só quando a tarefa está em">
          <Text weight="semibold">Só quando a tarefa está em</Text>
          <Text type="supporting">Nenhuma marcada = qualquer etapa.</Text>
          <HStack gap={3} wrap="wrap">
            {stages.map((s) => (
              <CheckboxInput
                key={s.id}
                label={s.name || '(sem nome)'}
                value={from.includes(s.id)}
                onChange={(checked) =>
                  setConditions({
                    fromStages: checked ? [...from, s.id] : from.filter((id) => id !== s.id)
                  })
                }
              />
            ))}
          </HStack>
        </VStack>
        <HStack gap={4} wrap="wrap">
          <CheckboxInput
            label="Ignorar tarefas bloqueadas"
            value={rule.conditions?.notBlocked === true}
            onChange={(checked) => setConditions({ notBlocked: checked })}
          />
          <CheckboxInput
            label="Só avançar (nunca voltar etapas)"
            value={rule.conditions?.onlyForward === true}
            onChange={(checked) => setConditions({ onlyForward: checked })}
          />
        </HStack>
        <RadioList
          label="Então"
          value={rule.action.type}
          onChange={(value) =>
            setRule((r) => ({
              ...r,
              action:
                value === 'notify'
                  ? { type: 'notify', message: '' }
                  : { type: 'move_to_stage', stageId: stages[0]?.id ?? '' }
            }))
          }
        >
          <RadioListItem value="move_to_stage" label="Mover para uma etapa" />
          <RadioListItem value="notify" label="Só notificar" />
        </RadioList>
        {rule.action.type === 'move_to_stage' ? (
          <Selector
            label="Mover para"
            options={stages.map((s) => ({ value: s.id, label: s.name || '(sem nome)' }))}
            {...(stages.some((s) => s.id === (rule.action as { stageId: string }).stageId)
              ? { value: (rule.action as { stageId: string }).stageId }
              : {})}
            onChange={(value: string) =>
              setRule((r) => ({ ...r, action: { type: 'move_to_stage', stageId: value } }))
            }
          />
        ) : (
          <TextInput
            label="Mensagem da notificação"
            value={rule.action.message}
            onChange={(value) =>
              setRule((r) => ({ ...r, action: { type: 'notify', message: value } }))
            }
          />
        )}
        <HStack gap={4} wrap="wrap">
          {rule.action.type === 'move_to_stage' && (
            <CheckboxInput
              label="Notificação de desktop ao mover"
              value={rule.notify === true}
              onChange={(checked) => setRule((r) => ({ ...r, notify: checked }))}
            />
          )}
          <CheckboxInput
            label="Ativa"
            value={rule.enabled}
            onChange={(checked) => setRule((r) => ({ ...r, enabled: checked }))}
          />
        </HStack>
        <TextInput
          label="Nome (opcional)"
          value={rule.name}
          placeholder={EVENT_LABELS[rule.trigger]}
          onChange={(value) => setRule((r) => ({ ...r, name: value }))}
        />
        <Text type="supporting" data-testid="rule-preview">
          {describeRule(rule, stages)}
        </Text>
        <HStack gap={2}>
          <Button
            variant="primary"
            label="Aplicar ao rascunho"
            isDisabled={incomplete}
            onClick={() => onApply(rule)}
          />
          <Button variant="ghost" label="Cancelar" onClick={onCancel} />
        </HStack>
      </VStack>
    </Card>
  )
}

function Simulator({ view, draft }: { view: BoardView; draft: FlowDraft }): React.JSX.Element {
  const [taskId, setTaskId] = useState<string | null>(view.cards[0]?.taskId ?? null)
  const [event, setEvent] = useState<EventKind>('pr.opened')
  const [result, setResult] = useState<SimulationResult | null>(null)
  const card = view.cards.find((c) => c.taskId === taskId)
  const stageName = (id: string | null): string =>
    id ? (draft.stages.find((s) => s.id === id)?.name ?? 'etapa removida') : 'Sem etapa'

  function run(): void {
    if (!card) return
    const option = view.statusOptions.find((o) => o.name === card.status?.name)
    setResult(
      simulate(
        draft,
        view.statusOptions,
        {
          stageId: card.stageId,
          blocked: card.blocked,
          paused: card.automationPaused,
          globallyPaused: false,
          notionStatus: card.status ? { id: option?.id ?? null, name: card.status.name } : null
        },
        event
      )
    )
  }

  let text = ''
  if (result) {
    const d = result.decision
    const rule = d.ruleName ? `regra “${d.ruleName}”` : ''
    text =
      d.outcome === 'move'
        ? `Casa a ${rule}: ${stageName(d.from)} → ${stageName(d.to)}. ${
            result.notion.changes
              ? `O Notion mudaria de “${result.notion.from}” para “${result.notion.to}”.`
              : 'O status no Notion não muda.'
          }`
        : d.outcome === 'noop'
          ? `Casa a ${rule}, mas a tarefa já está em ${stageName(d.to)}: nada muda.`
          : d.outcome === 'skipped'
            ? `A ${rule} casaria, mas seria ignorada (${d.reason}).`
            : d.outcome === 'notify'
              ? `Casa a ${rule}: só notificaria (“${d.message}”).`
              : `Nenhuma automação casa: a tarefa fica em ${stageName(d.from)}.`
  }

  return (
    <Card role="region" aria-label="Testar automação">
      <VStack gap={3}>
        <Text weight="semibold">Testar automação</Text>
        <Text type="supporting">
          Mostra o que aconteceria com o rascunho atual. Nada é executado nem enviado ao Notion.
        </Text>
        <HStack gap={3} wrap="wrap" vAlign="end">
          <Selector
            label="Tarefa"
            options={view.cards.map((c) => ({
              value: c.taskId,
              label: `${c.displayId ?? ''} ${c.title}`.trim()
            }))}
            {...(taskId ? { value: taskId } : {})}
            onChange={(value: string) => {
              setTaskId(value)
              setResult(null)
            }}
          />
          <Selector
            label="Evento"
            options={EVENT_KINDS.map((k) => ({ value: k, label: EVENT_LABELS[k] }))}
            value={event}
            onChange={(value: string) => {
              setEvent(value as EventKind)
              setResult(null)
            }}
          />
          <Button label="Testar" isDisabled={!card} onClick={run} />
        </HStack>
        {result && (
          <Text role="status" data-testid="simulation-result">
            {text}
          </Text>
        )}
      </VStack>
    </Card>
  )
}

/** "Fluxo desta coluna" (5A): fluxo de tarefa ligado à etapa, ligado/desligado e modo. */
function StageFlowField({
  label,
  stageId,
  flows,
  binding,
  onChange,
  onOpenTaskFlows
}: {
  label: string
  stageId: string
  flows: Flow[] | null
  binding: StageFlow | null
  onChange(binding: StageFlow | null): void
  onOpenTaskFlows(): void
}): React.JSX.Element {
  if (flows === null) return <Skeleton height={32} aria-label="Carregando fluxos de tarefa" />
  if (flows.length === 0) {
    return (
      <HStack gap={1} vAlign="center" wrap="wrap">
        <Text type="supporting">Nenhum fluxo de tarefa ainda.</Text>
        <Button size="sm" variant="ghost" label="Criar fluxo" onClick={onOpenTaskFlows} />
      </HStack>
    )
  }
  return (
    <VStack gap={2} role="group" aria-label={`Fluxo da coluna ${label}`}>
      <Selector
        label={`Fluxo desta coluna (${label})`}
        options={[
          { value: '', label: 'Nenhum' },
          ...flows.map((f) => ({ value: f.id, label: f.name }))
        ]}
        value={binding?.flowId ?? ''}
        onChange={(flowId: string) =>
          onChange(
            flowId
              ? {
                  stageId,
                  flowId,
                  enabled: binding?.enabled ?? true,
                  mode: binding?.mode ?? 'on_enter'
                }
              : null
          )
        }
      />
      {binding && (
        <HStack gap={2} vAlign="center" wrap="wrap">
          <SegmentedControl
            label={`Quando rodar o fluxo (${label})`}
            size="sm"
            value={binding.mode}
            onChange={(mode) =>
              onChange({ ...binding, mode: mode === 'manual' ? 'manual' : 'on_enter' })
            }
          >
            <SegmentedControlItem value="on_enter" label="Ao entrar" />
            <SegmentedControlItem value="manual" label="Manual" />
          </SegmentedControl>
          <CheckboxInput
            label={`Ligado (${label})`}
            value={binding.enabled}
            onChange={(enabled) => onChange({ ...binding, enabled })}
          />
        </HStack>
      )}
    </VStack>
  )
}
