import { useId, useMemo, useState } from 'react'
import {
  AGENT_COLORS,
  AGENT_LIMITS,
  AGENT_MODEL_LABELS,
  AGENT_ROLE_LABELS,
  AGENT_ROLES,
  agentIdFromName,
  buildAgentPrompt,
  validateAgent,
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
  SelectField,
  TextAreaField,
  TextField
} from '@/components/form'
import { Spinner } from '../../components/Spinner'
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
        Entrega: {p.delivery ? 'pode (com os gates do Orkio)' : 'não pode'} · Comandos:{' '}
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
  const [idTouched, setIdTouched] = useState(false)
  const errors = useMemo(() => validateAgent(d), [d])
  const commandOptions = [...new Set([...commands, ...d.commands])].map((c) => ({
    value: c,
    label: `/${c}`
  }))
  const [stepsText, setStepsText] = useState(String(d.limits.stepsPerDay))
  const [costText, setCostText] = useState(
    d.limits.costPerDayUsd === null ? '' : String(d.limits.costPerDayUsd)
  )
  const title = isNew ? 'Novo agente' : `Editar ${d.name}`

  return (
    <div
      role="form"
      aria-label={title}
      className="flex flex-col gap-4 rounded-xl border border-border-soft bg-card p-5"
    >
      <h2 className="text-base font-medium">{title}</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          label="Nome"
          value={d.name}
          required
          onChange={(name) =>
            set(isNew && !idTouched ? { name, id: agentIdFromName(name) } : { name })
          }
        />
        <TextField
          label="Id"
          description="Nome do arquivo (.orkio/agents/<id>.md). Não muda depois de criado."
          value={d.id}
          mono
          disabled={!isNew}
          onChange={(id) => {
            setIdTouched(true)
            set({ id })
          }}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <SelectField
          label="Papel"
          options={AGENT_ROLES.map((r) => ({ value: r, label: AGENT_ROLE_LABELS[r] }))}
          value={d.role}
          onChange={(role) => set({ role: role as AgentProfile['role'] })}
        />
        <SelectField
          label="Cor"
          options={AGENT_COLORS.map((c) => ({ value: c, label: COLOR_LABELS[c] }))}
          value={d.color}
          onChange={(color) => set({ color: color as AgentColor })}
        />
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
      <TextAreaField
        label="Instruções"
        description="Como este agente trabalha: convenções, o que sempre fazer, o que evitar. Nada de tokens ou senhas."
        value={d.instructions}
        rows={8}
        onChange={(instructions) =>
          set({ instructions: instructions.slice(0, AGENT_LIMITS.instructions) })
        }
      />
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
                'Grava .orkio/agents/<id>.md na pasta do projeto (sem commit). O time usa o mesmo agente.'
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
        description="Entra com --append-system-prompt. O resumo da tarefa continua igual."
        value={buildAgentPrompt(d)}
        rows={6}
      />
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
