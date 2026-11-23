import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  CheckboxField,
  RadioListField,
  SegmentedControl,
  SelectField,
  TextField
} from '@/components/form'
import { cn } from '@/lib/utils'
import { StatusToken } from '../../components/StatusToken'
import type { AutomationRule, EventKind } from '../../../../shared/automation'
import type { Flow, StageFlow } from '../../../../shared/task-flow'
import {
  EVENT_DESCRIPTIONS,
  EVENT_KINDS,
  EVENT_LABELS,
  EVENT_PHRASES,
  FLOW_COLORS,
  describeRule,
  diffFlow,
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
import { SaveBar } from '../../components/SaveBar'
import { plural } from '../../lib/format'
import { DeliverySection } from '../task-flows/DeliverySection'
import {
  ArrowDownIcon,
  ArrowUpIcon,
  BackIcon,
  MoreIcon,
  PlusIcon,
  TrashIcon
} from '../../components/icons'
import { useProjectActivity } from '../../components/SentenceDetail'
import { RuleDetail } from './RuleDetail'
import type { BoardSettingsTab } from '../../app/routes'

const BOARD_TABS: { id: BoardSettingsTab; label: string }[] = [
  { id: 'columns', label: 'Colunas' },
  { id: 'rules', label: 'Automações' },
  { id: 'flows', label: 'Fluxos' },
  { id: 'delivery', label: 'Entrega' }
]

function firedLabel(n: number): string {
  return n === 0 ? 'não disparou esta semana' : `disparou ${n}× esta semana`
}

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

/** Ponto da etapa com a cor escolhida (só tokens do tema; sem cor, neutro). */
const STAGE_DOT: Record<NotionColor, string> = {
  default: 'bg-subtle-foreground',
  gray: 'bg-muted-foreground',
  brown: 'bg-brand',
  orange: 'bg-brand',
  yellow: 'bg-warn',
  green: 'bg-ok',
  blue: 'bg-info',
  purple: 'bg-purple',
  pink: 'bg-pink',
  red: 'bg-danger'
}

function StageDot({ color }: { color: NotionColor | undefined }): React.JSX.Element {
  return (
    <span
      aria-hidden="true"
      className={cn('inline-block size-[7px] shrink-0 rounded-full', STAGE_DOT[color ?? 'default'])}
    />
  )
}

/** Cabeçalho de bloco (mockup `.sh` menor): título, descrição e ação à direita. */
function BlockHead({
  title,
  level = 2,
  description,
  action
}: {
  title: string
  level?: 2 | 3
  description?: React.ReactNode
  action?: React.ReactNode
}): React.JSX.Element {
  const H = level === 2 ? 'h2' : 'h3'
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <H className={level === 2 ? 'text-base font-medium' : 'text-sm font-medium'}>{title}</H>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  )
}

const CARD = 'rounded-xl border border-border-soft bg-card'
const ROWS = 'overflow-hidden rounded-xl border border-border-soft bg-card'
const ROW = 'border-b border-border-soft last:border-b-0'

/**
 * A frase da automação com o gatilho em destaque e a etapa de destino sublinhada (mockup `.rule`).
 * O texto é o mesmo de `describeRule` (os testes e a busca leem a frase inteira).
 */
function RuleSentence({
  rule,
  stages
}: {
  rule: AutomationRule
  stages: readonly { id: string; name: string }[]
}): React.JSX.Element {
  const full = describeRule(rule, stages)
  const head = `Quando ${EVENT_PHRASES[rule.trigger]}`
  if (!full.startsWith(head)) return <>{full}</>
  const rest = full.slice(head.length)
  const trigger = (
    <em className="rounded-[5px] bg-brand-tint px-1.5 py-px not-italic text-brand-tint-foreground">
      {EVENT_PHRASES[rule.trigger]}
    </em>
  )
  if (rule.action.type === 'move_to_stage') {
    const stageId = rule.action.stageId
    const target = stages.find((s) => s.id === stageId)?.name ?? 'etapa removida'
    const lead = 'mover para '
    const at = rest.indexOf(`${lead}${target}`)
    if (at >= 0) {
      const cut = at + lead.length
      return (
        <>
          Quando {trigger}
          {rest.slice(0, cut)}
          <span className="border-b border-dashed border-subtle-foreground text-foreground">
            {target}
          </span>
          {rest.slice(cut + target.length)}
        </>
      )
    }
  }
  return (
    <>
      Quando {trigger}
      {rest}
    </>
  )
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
  header,
  onSaved,
  onOpenNotionSettings,
  onOpenTaskFlows,
  tab,
  onTabChange,
  flowsSlot
}: {
  view: BoardView
  /** Cabeçalho da página com as ações do fluxo à direita. */
  header(action: React.ReactNode): React.ReactNode
  onSaved(view: BoardView): void
  onOpenNotionSettings(): void
  /** "Criar fluxo" numa coluna: leva à aba Fluxos (5A). */
  onOpenTaskFlows(): void
  /** Aba de Quadro e automações (Colunas · Automações · Fluxos · Entrega). */
  tab: BoardSettingsTab
  onTabChange(tab: BoardSettingsTab): void
  /** Conteúdo da aba Fluxos (editor da 5A e modelos do alva-flow). */
  flowsSlot: React.ReactNode
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
  const [selectedStage, setSelectedStage] = useState<string | null>(null)
  const [showAllEvents, setShowAllEvents] = useState(false)
  // Automação aberta em frase (fase 6); o formulário só abre em "Editar".
  const [viewingRule, setViewingRule] = useState<string | null>(null)
  const automationActivity = useProjectActivity(view.projectId, 'automation')

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

  // Rascunho salvo (o que "Descartar" restaura) e quantas mudanças o rascunho tem.
  const baseline = useMemo(
    (): FlowDraft => ({
      ...initialDraft(view),
      ...(taskFlows ? { bindings: taskFlows.bindings } : {})
    }),
    [view, taskFlows]
  )
  const changeCount = useMemo(() => {
    const named = (d: FlowDraft) => ({
      stages: d.stages.map((st) => ({
        id: st.id,
        name: st.name,
        notionStatus: { name: options.find((o) => o.id === st.notionStatusId)?.name ?? '' },
        ...(st.color ? { color: st.color } : {})
      })),
      rules: d.rules
    })
    const flowChanges = diffFlow(named(baseline), named(draft)).length
    const bindingChanges =
      JSON.stringify(baseline.bindings ?? []) === JSON.stringify(draft.bindings ?? []) ? 0 : 1
    return flowChanges + bindingChanges
  }, [baseline, draft, options])

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
  const addStageAfter = (index: number): void => {
    const id = newId('stage')
    update((d) => {
      const stages = [...d.stages]
      stages.splice(index + 1, 0, { id, name: '', notionStatusId: null })
      return { ...d, stages }
    })
    setSelectedStage(id)
    setEditing(null)
  }
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
    // A tela continua aberta depois de salvar: o salvo vira o novo rascunho (e as ligações salvas
    // são as do rascunho), senão "Descartar" e o contador comparariam com o estado anterior.
    const bindings = draft.bindings
    if (bindings) setTaskFlows((tf) => (tf ? { ...tf, bindings } : tf))
    setDraft({ ...initialDraft(result.value), ...(bindings ? { bindings } : {}) })
    setEditing(null)
    setAcceptWarnings(false)
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
  const moveRules = draft.rules.filter((r) => r.action.type === 'move_to_stage')
  const ruleIndex = (id: string): number => draft.rules.findIndex((r) => r.id === id)

  const editRule = (rule: AutomationRule): void => {
    if (rule.action.type === 'move_to_stage') setSelectedStage(rule.action.stageId)
    setViewingRule(null)
    setEditing({ rule: structuredClone(rule), isNew: false })
  }
  const toggleRule = (id: string): void =>
    update((d) => ({
      ...d,
      rules: d.rules.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r))
    }))

  const ruleItem = (rule: AutomationRule): React.JSX.Element => {
    const i = ruleIndex(rule.id)
    const selected = viewingRule === rule.id
    return (
      <li
        key={rule.id}
        aria-label={rule.name}
        data-selected={selected || undefined}
        className={cn(
          ROW,
          'flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/40 data-[selected]:bg-muted/60'
        )}
      >
        <button
          type="button"
          aria-current={selected || undefined}
          className="flex min-w-0 flex-1 flex-col gap-0.5 self-stretch rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          onClick={() => {
            setEditing(null)
            setViewingRule(rule.id)
            requestAnimationFrame(() =>
              document
                .querySelector('[data-testid="rule-detail-anchor"]')
                ?.scrollIntoView({ block: 'start', behavior: 'smooth' })
            )
          }}
        >
          <span
            className={cn(
              'text-sm leading-6 text-muted-foreground',
              !rule.enabled && 'text-subtle-foreground'
            )}
          >
            <RuleSentence rule={rule} stages={draft.stages} />
          </span>
          <span className="font-mono text-2xs text-subtle-foreground">
            {i + 1}ª na ordem · {EVENT_LABELS[rule.trigger]} ·{' '}
            {firedLabel(view.ruleCountsWeek[rule.id] ?? 0)}
          </span>
        </button>
        <Switch
          aria-label={`Automação ${rule.name} ativa`}
          checked={rule.enabled}
          onCheckedChange={() => toggleRule(rule.id)}
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Ações da automação ${rule.name}`}
              className="text-muted-foreground"
            >
              <MoreIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => editRule(rule)}>Editar</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => toggleRule(rule.id)}>
              {rule.enabled ? 'Desativar' : 'Ativar'}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => moveRule(rule.id, -1)}>
              Subir na ordem
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => moveRule(rule.id, 1)}>
              Descer na ordem
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onSelect={() =>
                update((d) => ({ ...d, rules: d.rules.filter((r) => r.id !== rule.id) }))
              }
            >
              Remover
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </li>
    )
  }

  const ruleForm = editing && (
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
  )

  const discard = (): void => {
    setDraft(baseline)
    setEditing(null)
    setAcceptWarnings(false)
    setMessage(null)
  }

  const stage = draft.stages.find((st) => st.id === selectedStage) ?? draft.stages[0] ?? null
  const stageIndex = stage ? draft.stages.indexOf(stage) : -1
  const stageLabel = stage ? stage.name || `etapa ${stageIndex + 1}` : ''
  const stageRules = stage
    ? draft.rules.filter((r) => r.action.type === 'move_to_stage' && r.action.stageId === stage.id)
    : []
  const shownRule = viewingRule ? (draft.rules.find((r) => r.id === viewingRule) ?? null) : null
  /** Fluxo que a coluna dispara ao entrar (para a tabela das colunas). */
  const onEnterFlow = (stageId: string): string | null => {
    const b = (draft.bindings ?? []).find(
      (x) => x.stageId === stageId && x.enabled && x.mode === 'on_enter'
    )
    return b ? (taskFlows?.flows.find((f) => f.id === b.flowId)?.name ?? null) : null
  }
  const stageErrors = (id: string): number => errors.filter((i) => i.stageId === id).length

  const history = (
    <section aria-label="Alterações do fluxo" className="flex flex-col gap-3">
      <BlockHead title="Alterações salvas" />
      {events.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nenhuma alteração registrada.</p>
      ) : (
        <ul aria-label="Histórico de configuração" className={ROWS}>
          {(showAllEvents ? events : events.slice(0, 5)).map((e) => (
            <li key={e.id} className={cn(ROW, 'flex flex-col gap-0.5 px-4 py-2.5')}>
              <span className="text-sm">{e.changes.join(' · ')}</span>
              <span className="text-2xs text-subtle-foreground">
                {e.actor} ·{' '}
                {new Date(e.at).toLocaleString('pt-BR', {
                  dateStyle: 'short',
                  timeStyle: 'short'
                })}
              </span>
            </li>
          ))}
        </ul>
      )}
      {events.length > 5 && !showAllEvents && (
        <div>
          <Button size="sm" variant="ghost" onClick={() => setShowAllEvents(true)}>
            Ver todas ({events.length})
          </Button>
        </div>
      )}
    </section>
  )

  return (
    <div className="flex flex-col gap-5">
      {header(
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" aria-label="Mais ações do fluxo">
              <MoreIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onOpenNotionSettings}>
              Etapa Orkio e Bloqueada…
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={restoreDefault}>Restaurar padrão</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void doExport()}>Exportar JSON</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void doImport()}>Importar JSON</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {message && <Alert tone={message.tone}>{message.text}</Alert>}

      <Tabs
        value={tab}
        onValueChange={(v) => onTabChange(BOARD_TABS.find((t) => t.id === v)?.id ?? 'columns')}
        className="gap-5"
      >
        <TabsList
          variant="line"
          className="w-full justify-start gap-5 rounded-none border-b border-border-soft p-0 group-data-[orientation=horizontal]/tabs:h-auto"
        >
          {BOARD_TABS.map((t) => (
            <TabsTrigger
              key={t.id}
              value={t.id}
              className="h-auto flex-none rounded-none border-0 px-0.5 pt-0 pb-2 text-sm font-normal text-muted-foreground after:bg-brand hover:text-foreground data-[state=active]:text-foreground group-data-[orientation=horizontal]/tabs:after:bottom-[-1px]"
            >
              {t.label}
              {t.id === 'rules' && (
                <>
                  {' '}
                  <span className="font-mono text-2xs text-subtle-foreground tabular">
                    {moveRules.length}
                  </span>
                </>
              )}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="columns" className="flex flex-col gap-5">
          {/* Tabela das colunas (mockup): escolher uma linha abre o editor dela embaixo. */}
          <section aria-label="Etapas" className={ROWS}>
            <div
              aria-hidden="true"
              className="grid grid-cols-[14px_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_56px] gap-3 border-b border-border-soft px-4 py-2 text-2xs tracking-[0.06em] text-subtle-foreground uppercase"
            >
              <span />
              <span>Coluna</span>
              <span>Status no Notion</span>
              <span>Ao entrar, roda</span>
              <span className="text-right">Tarefas</span>
            </div>
            <ul aria-label="Etapas do fluxo">
              {draft.stages.map((st, index) => {
                const label = st.name || `etapa ${index + 1}`
                const count = taskCounts[st.id] ?? 0
                const problems = stageErrors(st.id)
                const status = options.find((o) => o.id === st.notionStatusId)?.name
                const flowName = onEnterFlow(st.id)
                const selected = stage?.id === st.id
                return (
                  <li key={st.id} aria-label={`Etapa ${label}`} className={ROW}>
                    <button
                      type="button"
                      aria-current={selected || undefined}
                      onClick={() => {
                        setSelectedStage(st.id)
                        setEditing(null)
                        setViewingRule(null)
                      }}
                      className={cn(
                        'grid w-full grid-cols-[14px_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_56px] items-center gap-3 px-4 py-2.5 text-left text-sm outline-none transition-colors hover:bg-muted/40 focus-visible:bg-muted/60',
                        selected && 'bg-muted/60'
                      )}
                    >
                      <StageDot color={st.color} />
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-foreground">{label}</span>
                        {problems > 0 && (
                          <StatusToken tone="danger" label={plural(problems, 'erro', 'erros')} />
                        )}
                      </span>
                      <span
                        className={cn(
                          'truncate font-mono text-xs',
                          status ? 'text-muted-foreground' : 'text-danger'
                        )}
                      >
                        {status ?? 'Sem status'}
                      </span>
                      <span className="min-w-0">
                        {flowName ? (
                          <span className="inline-block max-w-full truncate rounded-full border border-brand-tint-border bg-brand-tint px-2 py-0.5 align-middle font-mono text-2xs text-brand-tint-foreground">
                            {flowName}
                          </span>
                        ) : (
                          <span className="text-subtle-foreground">—</span>
                        )}
                      </span>
                      <span className="text-right text-muted-foreground tabular">{count}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
            <div className="border-t border-border-soft px-2 py-1.5">
              <Button
                size="sm"
                variant="ghost"
                className="text-muted-foreground"
                onClick={() => addStageAfter(draft.stages.length - 1)}
              >
                <PlusIcon />
                Adicionar etapa no fim
              </Button>
            </div>
          </section>

          <div className="flex flex-col">
            <div data-testid="rule-detail-anchor" />
            {shownRule ? (
              <div className="flex flex-col gap-2">
                <div>
                  <Button variant="ghost" size="sm" onClick={() => setViewingRule(null)}>
                    <BackIcon />
                    {stage ? `Voltar para a etapa ${stageLabel}` : 'Voltar para as etapas'}
                  </Button>
                </div>
                <RuleDetail
                  rule={shownRule}
                  index={ruleIndex(shownRule.id)}
                  total={draft.rules.length}
                  stages={draft.stages}
                  activity={automationActivity}
                  onEdit={() => editRule(shownRule)}
                  onToggle={() => toggleRule(shownRule.id)}
                />
              </div>
            ) : (
              stage && (
                <section
                  aria-label={`Etapa ${stageLabel}`}
                  className={cn(CARD, 'flex flex-col gap-5 p-4')}
                >
                  <div className="flex flex-wrap items-center gap-1">
                    <StageDot color={stage.color} />
                    <p className="ml-1.5 min-w-0 flex-1 truncate text-sm font-medium">
                      {stageLabel}
                    </p>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Mover ${stageLabel} para a esquerda`}
                      disabled={stageIndex === 0}
                      onClick={() => stageIndex > 0 && moveStage(stageIndex, -1)}
                    >
                      <ArrowUpIcon />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Mover ${stageLabel} para a direita`}
                      disabled={stageIndex === draft.stages.length - 1}
                      onClick={() =>
                        stageIndex < draft.stages.length - 1 && moveStage(stageIndex, 1)
                      }
                    >
                      <ArrowDownIcon />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Adicionar etapa depois de ${stageLabel}`}
                      onClick={() => addStageAfter(stageIndex)}
                    >
                      <PlusIcon />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Remover ${stageLabel}`}
                      onClick={() => removeStage(stage.id)}
                    >
                      <TrashIcon />
                    </Button>
                  </div>
                  <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-3">
                    <TextField
                      label="Nome"
                      value={stage.name}
                      onChange={(value) => updateStage(stage.id, { name: value })}
                    />
                    <SelectField
                      label="Status no Notion"
                      options={options.map((o) => ({ value: o.id, label: o.name }))}
                      placeholder="Escolha a opção"
                      {...(stage.notionStatusId &&
                      options.some((o) => o.id === stage.notionStatusId)
                        ? { value: stage.notionStatusId }
                        : {
                            error: stage.missingStatusName
                              ? `“${stage.missingStatusName}” não existe no Notion.`
                              : 'Escolha uma opção.'
                          })}
                      onChange={(value) => setStageStatus(stage.id, value)}
                    />
                    <SelectField
                      label="Cor"
                      options={FLOW_COLORS.map((c) => ({ value: c, label: COLOR_LABELS[c] }))}
                      value={stage.color ?? 'default'}
                      onChange={(value) => updateStage(stage.id, { color: value as NotionColor })}
                    />
                  </div>

                  <StageFlowField
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

                  <div className="flex flex-col gap-2.5">
                    <BlockHead
                      level={3}
                      title="Automações que trazem para cá"
                      action={
                        <Button
                          size="sm"
                          variant="outline"
                          aria-label={`Nova automação para ${stageLabel}`}
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
                        >
                          <PlusIcon />
                          Nova automação
                        </Button>
                      }
                    />
                    {stageRules.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        Nenhuma automação leva para cá.
                      </p>
                    ) : (
                      <ul
                        aria-label={`Automações para ${stageLabel}`}
                        className="overflow-hidden rounded-lg border border-border-soft"
                      >
                        {stageRules.map(ruleItem)}
                      </ul>
                    )}
                  </div>

                  {editing && editing.rule.action.type === 'move_to_stage' && ruleForm}
                </section>
              )
            )}
          </div>

          {removedWithTasks.length > 0 && (
            <section
              aria-label="Etapas removidas"
              className={cn(CARD, 'flex flex-col gap-3 border-warn-tint-border p-4')}
            >
              <BlockHead title="Etapas removidas com tarefas" />
              {removedWithTasks.map((s) => (
                <SelectField
                  key={s.id}
                  label={`Para onde vão ${plural(taskCounts[s.id] ?? 0, 'a tarefa', 'as tarefas')} de “${s.name}”`}
                  options={draft.stages.map((d) => ({
                    value: d.id,
                    label: d.name || '(sem nome)'
                  }))}
                  placeholder="Escolha a etapa"
                  {...(draft.removals[s.id] ? { value: draft.removals[s.id]! } : {})}
                  onChange={(value) =>
                    update((d) => ({ ...d, removals: { ...d.removals, [s.id]: value } }))
                  }
                  className="max-w-sm"
                />
              ))}
            </section>
          )}

          {history}
        </TabsContent>

        <TabsContent value="rules" className="flex flex-col gap-6">
          <section aria-label="Automações" className="flex flex-col gap-3">
            <BlockHead
              title="Automações"
              description="Movem a tarefa quando algo acontece no GitHub. Lidas de cima para baixo; a primeira que casar vence."
              action={
                draft.stages[0] && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setEditing({
                        isNew: true,
                        rule: {
                          id: newId('rule'),
                          name: '',
                          enabled: true,
                          trigger: 'pr.opened',
                          conditions: { notBlocked: true },
                          action: { type: 'move_to_stage', stageId: draft.stages[0]!.id }
                        }
                      })
                    }
                  >
                    <PlusIcon />
                    Nova automação
                  </Button>
                )
              }
            />
            {moveRules.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nenhuma automação.</p>
            ) : (
              <ul aria-label="Todas as automações" className={ROWS}>
                {moveRules.map(ruleItem)}
              </ul>
            )}
            {editing && editing.rule.action.type === 'move_to_stage' && ruleForm}
            <div data-testid="rule-detail-anchor" />
            {shownRule && (
              <RuleDetail
                rule={shownRule}
                index={ruleIndex(shownRule.id)}
                total={draft.rules.length}
                stages={draft.stages}
                activity={automationActivity}
                onEdit={() => editRule(shownRule)}
                onToggle={() => toggleRule(shownRule.id)}
              />
            )}
          </section>

          <section aria-label="Notificações" className="flex flex-col gap-3">
            <BlockHead
              title="Notificações"
              description="Avisam no desktop sem mover a tarefa."
              action={
                <Button
                  size="sm"
                  variant="outline"
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
                >
                  <PlusIcon />
                  Nova notificação
                </Button>
              }
            />
            {notifyRules.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nenhuma.</p>
            ) : (
              <ul aria-label="Automações de notificação" className={ROWS}>
                {notifyRules.map(ruleItem)}
              </ul>
            )}
            {editing && editing.rule.action.type === 'notify' && ruleForm}
          </section>

          <Simulator view={view} draft={draft} />

          {history}
        </TabsContent>

        <TabsContent value="flows" className="flex flex-col gap-5">
          {flowsSlot}
        </TabsContent>

        <TabsContent value="delivery" className="flex flex-col gap-5">
          <DeliverySection projectId={view.projectId} />
        </TabsContent>
      </Tabs>

      <SaveBar
        label="Validação do fluxo"
        changes={changeCount}
        saveLabel="Salvar fluxo"
        isSaving={saving}
        isDisabled={
          changeCount === 0 || errors.length > 0 || (warnings.length > 0 && !acceptWarnings)
        }
        onSave={() => void save()}
        onDiscard={discard}
      >
        {errors.length > 0 && (
          <Alert tone="danger">
            <div className="flex flex-col gap-1">
              {errors.map((i) => (
                <p key={`${i.kind}-${i.stageId ?? ''}-${i.ruleId ?? ''}-${i.message}`}>
                  {i.message}
                </p>
              ))}
            </div>
          </Alert>
        )}
        {warnings.length > 0 && (
          <Alert tone="warning">
            <div className="flex flex-col gap-1">
              {warnings.map((i) => (
                <p key={`${i.kind}-${i.ruleId ?? ''}-${i.message}`}>{i.message}</p>
              ))}
            </div>
          </Alert>
        )}
        {warnings.length > 0 && errors.length === 0 && (
          <CheckboxField
            label="Entendi os avisos e quero salvar assim"
            checked={acceptWarnings}
            onChange={setAcceptWarnings}
          />
        )}
      </SaveBar>
    </div>
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
  const title = editing.isNew ? 'Nova automação' : 'Editar automação'

  return (
    <section
      aria-label={title}
      className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-4"
    >
      <h3 className="text-sm font-medium">{title}</h3>
      <SelectField
        label="Quando"
        options={EVENT_KINDS.map((k) => ({
          value: k,
          label: EVENT_LABELS[k],
          description: EVENT_DESCRIPTIONS[k]
        }))}
        value={rule.trigger}
        onChange={(value) => setRule((r) => ({ ...r, trigger: value as EventKind }))}
        className="max-w-sm"
      />
      <div role="group" aria-label="Só quando a tarefa está em" className="flex flex-col gap-2">
        <div className="flex flex-col gap-0.5">
          <p className="text-sm font-medium">Só quando a tarefa está em</p>
          <p className="text-xs text-muted-foreground">Nenhuma marcada = qualquer etapa.</p>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {stages.map((s) => (
            <CheckboxField
              key={s.id}
              label={s.name || '(sem nome)'}
              checked={from.includes(s.id)}
              onChange={(checked) =>
                setConditions({
                  fromStages: checked ? [...from, s.id] : from.filter((id) => id !== s.id)
                })
              }
            />
          ))}
        </div>
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        <CheckboxField
          label="Ignorar tarefas bloqueadas"
          checked={rule.conditions?.notBlocked === true}
          onChange={(checked) => setConditions({ notBlocked: checked })}
        />
        <CheckboxField
          label="Só avançar (nunca voltar etapas)"
          checked={rule.conditions?.onlyForward === true}
          onChange={(checked) => setConditions({ onlyForward: checked })}
        />
      </div>
      <RadioListField
        label="Então"
        value={rule.action.type}
        options={[
          { value: 'move_to_stage', label: 'Mover para uma etapa' },
          { value: 'notify', label: 'Só notificar' }
        ]}
        onChange={(value) =>
          setRule((r) => ({
            ...r,
            action:
              value === 'notify'
                ? { type: 'notify', message: '' }
                : { type: 'move_to_stage', stageId: stages[0]?.id ?? '' }
          }))
        }
      />
      {rule.action.type === 'move_to_stage' ? (
        <SelectField
          label="Mover para"
          options={stages.map((s) => ({ value: s.id, label: s.name || '(sem nome)' }))}
          {...(stages.some((s) => s.id === (rule.action as { stageId: string }).stageId)
            ? { value: (rule.action as { stageId: string }).stageId }
            : {})}
          onChange={(value) =>
            setRule((r) => ({ ...r, action: { type: 'move_to_stage', stageId: value } }))
          }
          className="max-w-sm"
        />
      ) : (
        <TextField
          label="Mensagem da notificação"
          value={rule.action.message}
          onChange={(value) =>
            setRule((r) => ({ ...r, action: { type: 'notify', message: value } }))
          }
        />
      )}
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {rule.action.type === 'move_to_stage' && (
          <CheckboxField
            label="Notificação de desktop ao mover"
            checked={rule.notify === true}
            onChange={(checked) => setRule((r) => ({ ...r, notify: checked }))}
          />
        )}
        <CheckboxField
          label="Ativa"
          checked={rule.enabled}
          onChange={(checked) => setRule((r) => ({ ...r, enabled: checked }))}
        />
      </div>
      <TextField
        label="Nome (opcional)"
        value={rule.name}
        placeholder={EVENT_LABELS[rule.trigger]}
        onChange={(value) => setRule((r) => ({ ...r, name: value }))}
        className="max-w-sm"
      />
      <p
        className="rounded-md border border-border-soft bg-card px-3 py-2 text-xs text-muted-foreground"
        data-testid="rule-preview"
      >
        {describeRule(rule, stages)}
      </p>
      <div className="flex gap-2">
        <Button disabled={incomplete} onClick={() => onApply(rule)}>
          Aplicar ao rascunho
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </section>
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
    <section aria-label="Testar automação" className={cn(CARD, 'flex flex-col gap-3 p-4')}>
      <BlockHead
        title="Testar automação"
        description="Mostra o que aconteceria com o rascunho atual. Nada é executado nem enviado ao Notion."
      />
      <div className="flex flex-wrap items-end gap-3">
        <SelectField
          label="Tarefa"
          options={view.cards.map((c) => ({
            value: c.taskId,
            label: `${c.displayId ?? ''} ${c.title}`.trim()
          }))}
          {...(taskId ? { value: taskId } : {})}
          onChange={(value) => {
            setTaskId(value)
            setResult(null)
          }}
          className="w-72"
        />
        <SelectField
          label="Evento"
          options={EVENT_KINDS.map((k) => ({ value: k, label: EVENT_LABELS[k] }))}
          value={event}
          onChange={(value) => {
            setEvent(value as EventKind)
            setResult(null)
          }}
          className="w-56"
        />
        <Button variant="outline" disabled={!card} onClick={run}>
          Testar
        </Button>
      </div>
      {result && (
        <p
          role="status"
          data-testid="simulation-result"
          className="rounded-md border border-border-soft bg-surface px-3 py-2 text-sm"
        >
          {text}
        </p>
      )}
    </section>
  )
}

/** "Fluxo desta coluna" (5A): fluxo de tarefa ligado à etapa, ligado/desligado e modo. */
function StageFlowField({
  stageId,
  flows,
  binding,
  onChange,
  onOpenTaskFlows
}: {
  stageId: string
  flows: Flow[] | null
  binding: StageFlow | null
  onChange(binding: StageFlow | null): void
  onOpenTaskFlows(): void
}): React.JSX.Element {
  if (flows === null) {
    return <Skeleton className="h-8" aria-label="Carregando fluxos de tarefa" />
  }
  if (flows.length === 0) {
    return (
      <div className="flex flex-wrap items-center gap-1">
        <p className="text-xs text-muted-foreground">Nenhum fluxo de tarefa ainda.</p>
        <Button size="sm" variant="ghost" onClick={onOpenTaskFlows}>
          Criar fluxo
        </Button>
      </div>
    )
  }
  return (
    <div role="group" aria-label="Fluxo desta coluna" className="flex flex-col gap-2">
      <SelectField
        label="Fluxo desta coluna"
        options={[
          { value: '', label: 'Nenhum' },
          ...flows.map((f) => ({ value: f.id, label: f.name }))
        ]}
        value={binding?.flowId ?? ''}
        onChange={(flowId) =>
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
        className="max-w-sm"
      />
      {binding && (
        <div className="flex flex-wrap items-center gap-3">
          <SegmentedControl
            label="Quando rodar o fluxo"
            size="sm"
            value={binding.mode}
            options={[
              { value: 'on_enter', label: 'Ao entrar' },
              { value: 'manual', label: 'Manual' }
            ]}
            onChange={(mode) =>
              onChange({ ...binding, mode: mode === 'manual' ? 'manual' : 'on_enter' })
            }
          />
          <CheckboxField
            label="Ligado"
            checked={binding.enabled}
            onChange={(enabled) => onChange({ ...binding, enabled })}
          />
        </div>
      )}
    </div>
  )
}
