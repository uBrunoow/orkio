import { useId, useMemo, useState } from 'react'
import {
  AGENT_AUTONOMIES,
  AGENT_AUTONOMY_TEXT,
  AGENT_COLORS,
  AGENT_LIMITS,
  AGENT_MODEL_LABELS,
  AGENT_ROLE_LABELS,
  AGENT_ROLES,
  agentAutonomy,
  agentGroupFromText,
  agentIdFromName,
  buildAgentPrompt,
  validateAgent,
  type AgentAutonomy,
  type AgentColor,
  type AgentProfile,
  type AgentScope,
  type AgentsState
} from '../../../../shared/agent'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  CheckboxField,
  Field,
  RadioListField,
  SegmentedControl,
  SelectField,
  TextAreaField,
  TextField
} from '@/components/form'
import { Spinner } from '../../components/Spinner'
import { ChoiceCards } from '../../components/ChoiceCards'
import { AGENT_STARTERS, type AgentStarter } from '../../../../shared/agent-starters'
import { cn } from '@/lib/utils'
import { agentFill } from './AgentAvatar'
import { AgentCardPreview } from './AgentCardFace'
import { MultiSelectField } from './MultiSelectField'
import { RuntimePicker, useSupportsEffort } from '../claude/RuntimePicker'

const COLOR_LABELS: Record<AgentColor, string> = {
  orange: 'Laranja',
  blue: 'Azul',
  green: 'Verde',
  purple: 'Roxo',
  pink: 'Rosa',
  teal: 'Verde-azulado',
  yellow: 'Amarelo'
}

export type Editing = {
  mode: 'new' | 'edit'
  scope: AgentScope
  draft: AgentProfile
  key: string | null
}

/** Campo de texto só leitura (prévia do prompt): continua `textbox` com o rótulo como nome. */
export function ReadOnlyText({
  label,
  description,
  value,
  rows
}: {
  label: string
  description?: string
  value: string
  rows: number
}): React.JSX.Element {
  return (
    <Field label={label} description={description}>
      {({ id, describedBy }) => (
        <Textarea
          id={id}
          readOnly
          rows={rows}
          value={value}
          aria-describedby={describedBy}
          className="font-mono text-xs text-muted-foreground"
        />
      )}
    </Field>
  )
}

export function ProfileSummary({
  profile: p,
  state
}: {
  profile: AgentProfile
  state: AgentsState
}): React.JSX.Element {
  const flow = p.flow ? (state.flows.find((f) => f.id === p.flow)?.name ?? p.flow) : 'o da coluna'
  return (
    <div className="flex flex-col gap-1 text-xs text-muted-foreground">
      <p>
        Papel: {AGENT_ROLE_LABELS[p.role]} · Modelo: {AGENT_MODEL_LABELS[p.model] ?? p.model} ·
        Fluxo: {flow}
      </p>
      <p>
        Sozinho: {AGENT_AUTONOMY_TEXT[agentAutonomy(p)].label.toLowerCase()} · Entrega:{' '}
        {p.delivery ? 'pode (com os gates do Orkio)' : 'não pode'} · Comandos:{' '}
        {p.commands.length === 0 ? 'todos' : p.commands.map((c) => `/${c}`).join(', ')}
      </p>
      <p>
        Limites: {p.limits.parallel} em paralelo · {p.limits.stepsPerDay} execuções/dia
        {p.limits.costPerDayUsd !== null ? ` · US$ ${p.limits.costPerDayUsd}/dia` : ''}
      </p>
    </div>
  )
}

export function AgentEditor({
  editing,
  state,
  commands,
  busy,
  onChange,
  onCancel,
  onSave
}: {
  editing: Editing
  state: AgentsState | null
  commands: string[]
  busy: boolean
  onChange(e: Editing): void
  onCancel(): void
  onSave(e: Editing): void
}): React.JSX.Element {
  const supportsEffort = useSupportsEffort()
  const runtimeLabelId = useId()
  const d = editing.draft
  const set = (patch: Partial<AgentProfile>): void =>
    onChange({ ...editing, draft: { ...d, ...patch } })
  const isNew = editing.mode === 'new'
  const [advanced, setAdvanced] = useState(false)
  const [idTouched, setIdTouched] = useState(false)
  // "Começar de" trocou instruções que você já tinha escrito: dá para desfazer.
  const [undo, setUndo] = useState<AgentProfile | null>(null)
  const [groupText, setGroupText] = useState(d.group)
  const errors = useMemo(() => validateAgent(d), [d])
  const commandOptions = [...new Set([...commands, ...d.commands])].map((c) => ({
    value: c,
    label: `/${c}`
  }))
  const preferredOptions = [
    { value: '', label: 'Nenhum (você escolhe ao rodar)' },
    ...(d.commands.length > 0
      ? d.commands.map((c) => ({ value: c, label: `/${c}` }))
      : commandOptions)
  ]
  const [stepsText, setStepsText] = useState(String(d.limits.stepsPerDay))
  const [costText, setCostText] = useState(
    d.limits.costPerDayUsd === null ? '' : String(d.limits.costPerDayUsd)
  )
  const title = isNew ? 'Novo agente' : `Editar ${d.name}`
  const autonomy = agentAutonomy(d)

  const startFrom = (starter: AgentStarter): void => {
    setUndo(d.instructions.trim() ? d : null)
    set({
      instructions: starter.instructions,
      description: d.description.trim() ? d.description : starter.description,
      role: starter.role,
      autonomy: starter.autonomy,
      ...(starter.autonomy === 'read_only' ? { delivery: false } : {})
    })
  }

  return (
    <div
      role="form"
      aria-label={title}
      className="flex flex-col gap-4 rounded-xl border border-border-soft bg-card p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-medium">{title}</h2>
        <SegmentedControl
          label="Modo do formulário"
          size="sm"
          value={advanced ? 'advanced' : 'simple'}
          onChange={(v) => setAdvanced(v === 'advanced')}
          options={[
            { value: 'simple', label: 'Simples' },
            { value: 'advanced', label: 'Avançado' }
          ]}
        />
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="flex min-w-0 flex-col gap-4">
          <ColorSwatches value={d.color} onChange={(color) => set({ color })} />
          <TextField
            label="Nome"
            value={d.name}
            required
            maxLength={AGENT_LIMITS.name}
            placeholder="Ex.: Ana"
            onChange={(name) =>
              set(isNew && !idTouched ? { name, id: agentIdFromName(name) } : { name })
            }
          />
          <TextField
            label="O que faz?"
            description="Uma frase. Aparece no card e no início da conversa do agente."
            value={d.description}
            maxLength={AGENT_LIMITS.description}
            placeholder="Ex.: Implementa a tarefa com testes e deixa a suíte verde."
            onChange={(description) => set({ description: description.replace(/[\r\n]+/g, ' ') })}
          />
          <div className="flex flex-col gap-2">
            <div
              className="flex flex-wrap items-center gap-1.5"
              role="group"
              aria-label="Começar de"
            >
              <span className="text-xs text-muted-foreground">Começar de:</span>
              {AGENT_STARTERS.map((s) => (
                <Button
                  key={s.id}
                  size="xs"
                  variant="outline"
                  title={s.hint}
                  aria-label={`Começar de: ${s.label}`}
                  onClick={() => startFrom(s)}
                >
                  {s.label}
                </Button>
              ))}
              {undo && (
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => {
                    onChange({ ...editing, draft: undo })
                    setUndo(null)
                  }}
                >
                  Desfazer
                </Button>
              )}
            </div>
            <TextAreaField
              label="Instruções"
              description="Como este agente trabalha: convenções, o que sempre fazer, o que evitar. Nada de tokens ou senhas."
              value={d.instructions}
              rows={8}
              onChange={(instructions) => {
                setUndo(null)
                set({ instructions: instructions.slice(0, AGENT_LIMITS.instructions) })
              }}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Como trabalha</span>
              <div
                className="flex flex-col gap-0.5 rounded-lg border border-border-soft px-3 py-2.5"
                title="Hoje todo agente é sob demanda: não há agente sempre ligado."
              >
                <span className="text-sm font-medium">Sob demanda</span>
                <span className="text-xs text-muted-foreground">
                  Roda quando uma tarefa é dele: você atribui, a regra da coluna ou o orquestrador.
                </span>
              </div>
            </div>
            <div className="flex min-w-0 flex-col gap-1.5">
              <span id={runtimeLabelId} className="text-sm font-medium">
                Modelo e raciocínio
              </span>
              <RuntimePicker
                describedBy={runtimeLabelId}
                value={{ model: d.model === 'default' ? null : d.model, effort: d.effort }}
                supportsEffort={supportsEffort}
                className="w-full justify-start border border-input bg-card"
                onChange={(v) =>
                  set({
                    model: (v.model ?? 'default') as AgentProfile['model'],
                    effort: v.effort ?? null
                  })
                }
              />
            </div>
          </div>

          {advanced && (
            <div
              role="group"
              aria-label="Avançado"
              className="flex flex-col gap-4 border-t border-border-soft pt-4"
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <TextField
                  label="Nome curto"
                  description="Usado para citar o agente e no arquivo (.orkio/agents/<nome-curto>.md). Não muda depois de criado."
                  value={d.id}
                  mono
                  disabled={!isNew}
                  onChange={(id) => {
                    setIdTouched(true)
                    set({ id })
                  }}
                />
                <TextField
                  label="Grupo"
                  description="Organiza a lista. Ex.: operacoes/incidentes."
                  value={groupText}
                  placeholder="Sem grupo"
                  onChange={(text) => {
                    setGroupText(text)
                    set({ group: agentGroupFromText(text) })
                  }}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">O que ele pode fazer sozinho?</span>
                <ChoiceCards
                  label="O que ele pode fazer sozinho?"
                  value={autonomy}
                  options={AGENT_AUTONOMIES.map((a) => ({
                    value: a,
                    title: AGENT_AUTONOMY_TEXT[a].label,
                    phrase: AGENT_AUTONOMY_TEXT[a].description,
                    hint: AUTONOMY_HINT[a]
                  }))}
                  onChange={(a) =>
                    set({ autonomy: a, ...(a === 'read_only' ? { delivery: false } : {}) })
                  }
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <SelectField
                  label="Comando preferido"
                  description="Já vem escolhido quando você roda como este agente."
                  options={preferredOptions}
                  value={d.command ?? ''}
                  onChange={(command) => set({ command: command || null })}
                />
                <SelectField
                  label="Papel"
                  options={AGENT_ROLES.map((r) => ({ value: r, label: AGENT_ROLE_LABELS[r] }))}
                  value={d.role}
                  onChange={(role) => set({ role: role as AgentProfile['role'] })}
                />
              </div>
              <SelectField
                label="Fluxo preferido"
                description="Usado quando a coluna dispara um fluxo e a tarefa é deste agente. Sem fluxo preferido, roda o fluxo da coluna com as instruções do agente."
                options={[
                  { value: '', label: 'O fluxo da coluna' },
                  ...(state?.flows ?? []).map((f) => ({ value: f.id, label: f.name }))
                ]}
                value={d.flow ?? ''}
                onChange={(flow) => set({ flow: flow || null })}
              />
              <MultiSelectField
                label="Comandos permitidos"
                placeholder="Todos os comandos"
                options={commandOptions}
                value={d.commands}
                hasSearch
                onChange={(value) => set({ commands: value })}
              />
              <CheckboxField
                label="Pode entregar (push, PR e pedir review, sempre pelos gates do Orkio)"
                checked={d.delivery}
                disabled={autonomy === 'read_only'}
                onChange={(delivery) => set({ delivery })}
              />
              <div className="grid gap-3 sm:grid-cols-3">
                <SelectField
                  label="Fluxos ao mesmo tempo"
                  options={Array.from({ length: AGENT_LIMITS.parallel }, (_, i) => ({
                    value: String(i + 1),
                    label: String(i + 1)
                  }))}
                  value={String(d.limits.parallel)}
                  onChange={(v) => set({ limits: { ...d.limits, parallel: Number(v) } })}
                />
                <TextField
                  label="Execuções do Claude Code por dia"
                  value={stepsText}
                  onChange={(v) => {
                    setStepsText(v)
                    const n = Number(v)
                    set({ limits: { ...d.limits, stepsPerDay: Number.isFinite(n) ? n : 0 } })
                  }}
                />
                <TextField
                  label="Custo máximo por dia (US$)"
                  description="Vazio = sem limite."
                  value={costText}
                  onChange={(v) => {
                    setCostText(v)
                    const t = v.trim().replace(',', '.')
                    set({ limits: { ...d.limits, costPerDayUsd: t === '' ? null : Number(t) } })
                  }}
                />
              </div>
              {isNew && (
                <RadioListField
                  label="Onde salvar"
                  value={editing.scope}
                  onChange={(scope) => onChange({ ...editing, scope: scope as AgentScope })}
                  options={[
                    {
                      value: 'repo',
                      label: 'No repositório do projeto',
                      description:
                        'Grava .orkio/agents/<nome-curto>.md na pasta do projeto (sem commit). O time usa o mesmo agente.'
                    },
                    {
                      value: 'local',
                      label: 'Só neste computador',
                      description: 'Vale para todos os seus projetos.'
                    }
                  ]}
                />
              )}
              <ReadOnlyText
                label="Prévia: o que vai no início da conversa"
                description="Entra com --append-system-prompt (mais a memória do agente, se houver). O resumo da tarefa continua igual."
                value={buildAgentPrompt(d)}
                rows={6}
              />
            </div>
          )}
        </div>
        <aside
          aria-label="Como vai aparecer"
          className="flex flex-col gap-2 lg:sticky lg:top-4 lg:self-start"
        >
          <p className="text-xs text-muted-foreground">Como vai aparecer</p>
          <AgentCardPreview profile={d} scope={editing.scope} />
          <p className="text-2xs text-subtle-foreground">
            {AGENT_AUTONOMY_TEXT[autonomy].label} ·{' '}
            {d.model === 'default'
              ? 'Modelo padrão do Claude Code'
              : (AGENT_MODEL_LABELS[d.model] ?? d.model)}
          </p>
        </aside>
      </div>
      {errors.length > 0 && (
        <ul className="flex flex-col gap-1 text-xs text-danger">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <Button disabled={busy || errors.length > 0} onClick={() => onSave(editing)}>
          {busy && <Spinner />}
          Salvar agente
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </div>
  )
}

/** Termo técnico da autonomia, um passo mais fundo (tooltip). */
const AUTONOMY_HINT: Record<AgentAutonomy, string> = {
  edits: '--permission-mode acceptEdits; comandos pela aprovação do Orkio.',
  ask: '--permission-mode manual; edições e comandos pela aprovação do Orkio.',
  read_only: 'Roda como passo só de leitura: sem Edit/Write e sem entrega.'
}

/** Cor do avatar em bolinhas (grupo de rádio). */
function ColorSwatches({
  value,
  onChange
}: {
  value: AgentColor
  onChange(color: AgentColor): void
}): React.JSX.Element {
  const move = (from: number, delta: number): void => {
    const next = AGENT_COLORS[(from + delta + AGENT_COLORS.length) % AGENT_COLORS.length]!
    onChange(next)
    requestAnimationFrame(() =>
      document.querySelector<HTMLButtonElement>(`[data-agent-color="${next}"]`)?.focus()
    )
  }
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">Cor</span>
      <div role="radiogroup" aria-label="Cor do avatar" className="flex flex-wrap gap-2">
        {AGENT_COLORS.map((c, i) => {
          const checked = c === value
          return (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={checked}
              aria-label={COLOR_LABELS[c]}
              title={COLOR_LABELS[c]}
              data-agent-color={c}
              tabIndex={checked ? 0 : -1}
              onClick={() => onChange(c)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                  e.preventDefault()
                  move(i, 1)
                } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                  e.preventDefault()
                  move(i, -1)
                }
              }}
              style={{ background: agentFill(c) }}
              className={cn(
                'size-6 rounded-full border border-border-soft transition-shadow motion-reduce:transition-none',
                'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card focus-visible:outline-none',
                checked && 'ring-2 ring-foreground/60 ring-offset-2 ring-offset-card'
              )}
            />
          )
        })}
      </div>
    </div>
  )
}
