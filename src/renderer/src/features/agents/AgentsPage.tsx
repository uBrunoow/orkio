import { useEffect, useMemo, useState } from 'react'
import { Button } from '@astryxdesign/core/Button'
import { Card } from '@astryxdesign/core/Card'
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput'
import { EmptyState } from '@astryxdesign/core/EmptyState'
import { HStack } from '@astryxdesign/core/HStack'
import { Heading } from '@astryxdesign/core/Heading'
import { Icon } from '@astryxdesign/core/Icon'
import { Item } from '@astryxdesign/core/Item'
import { List } from '@astryxdesign/core/List'
import { MultiSelector } from '@astryxdesign/core/MultiSelector'
import { RadioList, RadioListItem } from '@astryxdesign/core/RadioList'
import { Selector } from '@astryxdesign/core/Selector'
import { Skeleton } from '@astryxdesign/core/Skeleton'
import { StackItem } from '@astryxdesign/core/Stack'
import { Text } from '@astryxdesign/core/Text'
import { TextArea } from '@astryxdesign/core/TextArea'
import { TextInput } from '@astryxdesign/core/TextInput'
import { Token } from '@astryxdesign/core/Token'
import { VStack } from '@astryxdesign/core/VStack'
import {
  AGENT_COLORS,
  AGENT_LIMITS,
  AGENT_MODEL_LABELS,
  AGENT_MODELS,
  AGENT_ROLE_LABELS,
  AGENT_ROLES,
  agentIdFromName,
  agentInitials,
  buildAgentPrompt,
  defaultAgent,
  validateAgent,
  type AgentColor,
  type AgentProfile,
  type AgentScope,
  type AgentsState,
  type AgentView
} from '../../../../shared/agent'
import type { ProjectView } from '../../../../shared/ipc-contract'
import { Alert } from '../../components/Alert'
import { PageHeader } from '../../components/PageHeader'
import { PlusIcon, TrashIcon } from '../../components/icons'

const COLOR_LABELS: Record<AgentColor, string> = {
  orange: 'Laranja',
  blue: 'Azul',
  green: 'Verde',
  purple: 'Roxo',
  pink: 'Rosa',
  teal: 'Verde-azulado',
  yellow: 'Amarelo'
}

const STATUS_TOKEN: Record<
  AgentView['status'],
  { label: string; color: 'green' | 'yellow' | 'red' | 'gray' }
> = {
  ready: { label: 'Pronto', color: 'green' },
  needs_review: { label: 'Revisar perfil', color: 'yellow' },
  invalid: { label: 'Com erro', color: 'red' },
  archived: { label: 'Arquivado', color: 'gray' }
}

/** Avatar do agente: iniciais na cor do perfil (cores do tema, via Token). */
export function AgentAvatar({
  name,
  color,
  testId
}: {
  name: string
  color: AgentColor
  testId?: string
}): React.JSX.Element {
  return (
    <Token
      size="sm"
      color={color}
      label={agentInitials(name)}
      aria-label={`Agente: ${name}`}
      {...(testId ? { 'data-testid': testId } : {})}
    />
  )
}

type Editing = { mode: 'new' | 'edit'; scope: AgentScope; draft: AgentProfile; key: string | null }

/** Tela "Agentes" (8A): perfis, aprovação dos perfis do repositório e regras por coluna. */
export function AgentsPage(): React.JSX.Element {
  const [projects, setProjects] = useState<ProjectView[] | null>(null)
  const [projectId, setProjectId] = useState<string | null>(null)
  const [state, setState] = useState<AgentsState | null>(null)
  const [editing, setEditing] = useState<Editing | null>(null)
  const [reviewing, setReviewing] = useState<string | null>(null)
  const [commands, setCommands] = useState<string[]>([])
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let active = true
    void window.orkio.projects
      .list()
      .then((r) => {
        if (!active) return
        setProjects(r.projects)
        setProjectId((cur) => cur ?? r.projects[0]?.id ?? null)
      })
      .catch(() => {
        if (active) setProjects([])
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!projectId) return
    let alive = true
    const load = (): void => {
      void window.orkio.agents.list(projectId).then((r) => {
        if (!alive) return
        if (r.ok) setState(r.value)
        else setMessage({ tone: 'error', text: r.error.message })
      })
    }
    load()
    void window.orkio.claude.catalog(projectId, 'agentes').then((r) => {
      if (alive && r.ok) {
        setCommands([...new Set(r.value.flatMap((g) => g.commands.map((c) => c.name)))])
      }
    })
    const off = window.orkio.agents.onChanged((e) => {
      if (e.projectId === projectId) load()
    })
    return () => {
      alive = false
      off()
    }
  }, [projectId])

  if (projects === null) return <Skeleton height={240} aria-label="Carregando agentes" />

  const header = (
    <PageHeader
      title="Agentes"
      subtitle="Colegas de IA com nome, papel e instruções que pegam tarefas do quadro, dentro das regras do Orkio."
      action={
        <HStack gap={2} vAlign="center">
          {projects.length > 1 && (
            <Selector
              label="Projeto"
              isLabelHidden
              width={240}
              options={projects.map((p) => ({ value: p.id, label: p.name }))}
              {...(projectId ? { value: projectId } : {})}
              onChange={(value: string) => {
                setState(null)
                setEditing(null)
                setProjectId(value)
              }}
            />
          )}
          {projectId && (
            <Button
              variant="primary"
              label="Novo agente"
              icon={<Icon icon={PlusIcon} />}
              onClick={() => {
                setMessage(null)
                setEditing({ mode: 'new', scope: 'repo', draft: defaultAgent(), key: null })
              }}
            />
          )}
        </HStack>
      }
    />
  )

  if (!projectId) {
    return (
      <VStack gap={5}>
        {header}
        <EmptyState
          title="Nenhum projeto ainda"
          description="Adicione um projeto em Projetos para criar agentes para ele."
        />
      </VStack>
    )
  }

  const save = async (e: Editing): Promise<void> => {
    setBusy(true)
    setMessage(null)
    const r = await window.orkio.agents.save({
      projectId,
      scope: e.scope,
      profile: e.draft,
      isNew: e.mode === 'new'
    })
    setBusy(false)
    if (!r.ok) {
      setMessage({ tone: 'error', text: r.error.message })
      return
    }
    setState(r.value)
    setEditing(null)
    setMessage({
      tone: 'ok',
      text:
        e.scope === 'repo'
          ? `Perfil salvo em .orkio/agents/${e.draft.id}.md. Commite o arquivo para o time usar o mesmo agente.`
          : 'Perfil salvo neste computador.'
    })
  }

  const approve = async (view: AgentView): Promise<void> => {
    setBusy(true)
    const r = await window.orkio.agents.approve(projectId, view.key, view.hash)
    setBusy(false)
    if (r.ok) {
      setState(r.value)
      setReviewing(null)
      setMessage({ tone: 'ok', text: `Perfil de ${view.profile?.name ?? view.id} aprovado.` })
    } else setMessage({ tone: 'error', text: r.error.message })
  }

  return (
    <VStack gap={5} role="region" aria-label="Agentes">
      {header}
      <Text type="supporting">
        O Orkio roda o Claude Code instalado por você, sem modificação e com o seu login. Um agente
        é um conjunto de instruções, modelo, fluxo preferido e limites por cima disso: ele nunca
        ganha permissões. Push, PR e gates continuam pelas regras do Orkio. O Orkio não usa o Agent
        SDK nem guarda credenciais da Anthropic.
      </Text>
      {message &&
        (message.tone === 'error' ? (
          <Alert tone="danger">{message.text}</Alert>
        ) : (
          <Text role="status">{message.text}</Text>
        ))}

      {editing && (
        <AgentEditor
          editing={editing}
          state={state}
          commands={commands}
          busy={busy}
          onChange={setEditing}
          onCancel={() => setEditing(null)}
          onSave={(e) => void save(e)}
        />
      )}

      {state === null ? (
        <Skeleton height={120} aria-label="Carregando agentes" />
      ) : state.agents.length === 0 && !editing ? (
        <EmptyState
          title="Nenhum agente ainda"
          description="Crie um agente (ex.: Ana, implementadora) e atribua tarefas a ele no quadro."
        />
      ) : (
        <List hasDividers aria-label="Lista de agentes">
          {state.agents.map((a) => (
            <AgentRow
              key={a.key}
              view={a}
              state={state}
              isReviewing={reviewing === a.key}
              busy={busy}
              onEdit={() => {
                if (!a.profile) return
                setMessage(null)
                setEditing({ mode: 'edit', scope: a.scope, draft: a.profile, key: a.key })
              }}
              onDuplicate={() => {
                if (!a.profile) return
                setMessage(null)
                setEditing({
                  mode: 'new',
                  scope: a.scope,
                  draft: {
                    ...a.profile,
                    id: '',
                    name: `${a.profile.name} (cópia)`,
                    archived: false
                  },
                  key: null
                })
              }}
              onArchive={() => {
                if (!a.profile) return
                void save({
                  mode: 'edit',
                  scope: a.scope,
                  draft: { ...a.profile, archived: !a.profile.archived },
                  key: a.key
                })
              }}
              onReview={() => setReviewing(reviewing === a.key ? null : a.key)}
              onApprove={() => void approve(a)}
            />
          ))}
        </List>
      )}

      {state && (
        <AssignRules
          key={JSON.stringify(state.rules)}
          state={state}
          onSave={async (rules) => {
            const r = await window.orkio.agents.setRules(projectId, rules)
            if (r.ok) {
              setState(r.value)
              setMessage({ tone: 'ok', text: 'Regras de atribuição salvas.' })
            } else setMessage({ tone: 'error', text: r.error.message })
          }}
        />
      )}
    </VStack>
  )
}

function AgentRow({
  view,
  state,
  isReviewing,
  busy,
  onEdit,
  onDuplicate,
  onArchive,
  onReview,
  onApprove
}: {
  view: AgentView
  state: AgentsState
  isReviewing: boolean
  busy: boolean
  onEdit(): void
  onDuplicate(): void
  onArchive(): void
  onReview(): void
  onApprove(): void
}): React.JSX.Element {
  const p = view.profile
  const name = p?.name ?? view.id
  const status = STATUS_TOKEN[view.status]
  const flowName = p?.flow ? (state.flows.find((f) => f.id === p.flow)?.name ?? p.flow) : null
  const details = [
    p ? AGENT_ROLE_LABELS[p.role] : null,
    view.file,
    `${view.assigned} tarefa(s)`,
    `hoje: ${view.usageToday.runs} execução(ões)`
  ].filter(Boolean)
  return (
    <Item
      as="li"
      align="start"
      startContent={<AgentAvatar name={name} color={p?.color ?? 'yellow'} />}
      label={name}
      description={
        <VStack gap={2}>
          <Text type="supporting">{details.join(' · ')}</Text>
          {flowName && <Text type="supporting">Fluxo preferido: {flowName}</Text>}
          {view.errors.map((e) => (
            <Alert key={e} tone="danger">
              {e}
            </Alert>
          ))}
          {view.warnings.map((w) => (
            <Text key={w} type="supporting">
              {w}
            </Text>
          ))}
          {view.status === 'needs_review' && p && (
            <Alert tone="warning">
              O perfil de {name} mudou no repositório desde a última aprovação. Revise antes de ele
              rodar de novo.
            </Alert>
          )}
          {isReviewing && p && (
            <Card variant="transparent">
              <VStack gap={3}>
                <ProfileSummary profile={p} state={state} />
                <TextArea
                  label="O que vai no início da conversa"
                  value={buildAgentPrompt(p)}
                  isReadOnly
                  rows={8}
                  onChange={() => undefined}
                />
                <HStack gap={2}>
                  <Button
                    size="sm"
                    variant="primary"
                    label="Aprovar este perfil"
                    isLoading={busy}
                    onClick={onApprove}
                  />
                  <Button size="sm" variant="ghost" label="Fechar" onClick={onReview} />
                </HStack>
              </VStack>
            </Card>
          )}
        </VStack>
      }
      endContent={
        <HStack gap={2} vAlign="center">
          <Token size="sm" color={status.color} label={status.label} />
          {view.status === 'needs_review' && p && !isReviewing && (
            <Button size="sm" variant="secondary" label={`Revisar ${name}`} onClick={onReview} />
          )}
          {p && (
            <>
              <Button size="sm" variant="ghost" label={`Editar ${name}`} onClick={onEdit} />
              <Button size="sm" variant="ghost" label={`Duplicar ${name}`} onClick={onDuplicate} />
              <Button
                size="sm"
                variant="ghost"
                label={p.archived ? `Desarquivar ${name}` : `Arquivar ${name}`}
                onClick={onArchive}
              />
            </>
          )}
        </HStack>
      }
    />
  )
}

function ProfileSummary({
  profile: p,
  state
}: {
  profile: AgentProfile
  state: AgentsState
}): React.JSX.Element {
  const flow = p.flow ? (state.flows.find((f) => f.id === p.flow)?.name ?? p.flow) : 'o da coluna'
  return (
    <VStack gap={1}>
      <Text type="supporting">
        Papel: {AGENT_ROLE_LABELS[p.role]} · Modelo: {AGENT_MODEL_LABELS[p.model]} · Fluxo: {flow}
      </Text>
      <Text type="supporting">
        Entrega: {p.delivery ? 'pode (com os gates do Orkio)' : 'não pode'} · Comandos:{' '}
        {p.commands.length === 0 ? 'todos' : p.commands.map((c) => `/${c}`).join(', ')}
      </Text>
      <Text type="supporting">
        Limites: {p.limits.parallel} em paralelo · {p.limits.stepsPerDay} execuções/dia
        {p.limits.costPerDayUsd !== null ? ` · US$ ${p.limits.costPerDayUsd}/dia` : ''}
      </Text>
    </VStack>
  )
}

function AgentEditor({
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
  const d = editing.draft
  const set = (patch: Partial<AgentProfile>): void =>
    onChange({ ...editing, draft: { ...d, ...patch } })
  const isNew = editing.mode === 'new'
  // Id gerado do nome até você mexer nele (só na criação).
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

  return (
    <Card role="form" aria-label={isNew ? 'Novo agente' : `Editar ${d.name}`}>
      <VStack gap={4}>
        <Heading level={2}>{isNew ? 'Novo agente' : `Editar ${d.name}`}</Heading>
        <HStack gap={3} wrap="wrap">
          <StackItem size="fill">
            <TextInput
              label="Nome"
              value={d.name}
              isRequired
              onChange={(name: string) =>
                set(isNew && !idTouched ? { name, id: agentIdFromName(name) } : { name })
              }
            />
          </StackItem>
          <StackItem size="fill">
            <TextInput
              label="Id"
              description="Nome do arquivo (.orkio/agents/<id>.md). Não muda depois de criado."
              value={d.id}
              isDisabled={!isNew}
              onChange={(id: string) => {
                setIdTouched(true)
                set({ id })
              }}
            />
          </StackItem>
        </HStack>
        <HStack gap={3} wrap="wrap">
          <StackItem size="fill">
            <Selector
              label="Papel"
              options={AGENT_ROLES.map((r) => ({ value: r, label: AGENT_ROLE_LABELS[r] }))}
              value={d.role}
              onChange={(role: string) => set({ role: role as AgentProfile['role'] })}
            />
          </StackItem>
          <StackItem size="fill">
            <Selector
              label="Cor"
              options={AGENT_COLORS.map((c) => ({ value: c, label: COLOR_LABELS[c] }))}
              value={d.color}
              onChange={(color: string) => set({ color: color as AgentColor })}
            />
          </StackItem>
          <StackItem size="fill">
            <Selector
              label="Modelo"
              options={AGENT_MODELS.map((m) => ({ value: m, label: AGENT_MODEL_LABELS[m] }))}
              value={d.model}
              onChange={(model: string) => set({ model: model as AgentProfile['model'] })}
            />
          </StackItem>
        </HStack>
        <Selector
          label="Fluxo preferido"
          description="Usado quando a coluna dispara um fluxo e a tarefa é deste agente. Sem fluxo preferido, roda o fluxo da coluna com as instruções do agente."
          options={[
            { value: '', label: 'O fluxo da coluna' },
            ...(state?.flows ?? []).map((f) => ({ value: f.id, label: f.name }))
          ]}
          value={d.flow ?? ''}
          onChange={(flow: string) => set({ flow: flow || null })}
        />
        <MultiSelector
          label="Comandos permitidos"
          placeholder="Todos os comandos"
          options={commandOptions}
          value={d.commands}
          triggerDisplay="labels"
          hasSearch
          onChange={(value: string[]) => set({ commands: value })}
        />
        <CheckboxInput
          label="Pode entregar (push, PR e pedir review, sempre pelos gates do Orkio)"
          value={d.delivery}
          onChange={(delivery) => set({ delivery })}
        />
        <HStack gap={3} wrap="wrap">
          <StackItem size="fill">
            <Selector
              label="Fluxos ao mesmo tempo"
              options={Array.from({ length: AGENT_LIMITS.parallel }, (_, i) => ({
                value: String(i + 1),
                label: String(i + 1)
              }))}
              value={String(d.limits.parallel)}
              onChange={(v: string) => set({ limits: { ...d.limits, parallel: Number(v) } })}
            />
          </StackItem>
          <StackItem size="fill">
            <TextInput
              label="Execuções do Claude Code por dia"
              value={stepsText}
              onChange={(v: string) => {
                setStepsText(v)
                const n = Number(v)
                set({ limits: { ...d.limits, stepsPerDay: Number.isFinite(n) ? n : 0 } })
              }}
            />
          </StackItem>
          <StackItem size="fill">
            <TextInput
              label="Custo máximo por dia (US$)"
              description="Vazio = sem limite."
              value={costText}
              onChange={(v: string) => {
                setCostText(v)
                const t = v.trim().replace(',', '.')
                set({ limits: { ...d.limits, costPerDayUsd: t === '' ? null : Number(t) } })
              }}
            />
          </StackItem>
        </HStack>
        <TextArea
          label="Instruções"
          description="Como este agente trabalha: convenções, o que sempre fazer, o que evitar. Nada de tokens ou senhas."
          value={d.instructions}
          maxLength={AGENT_LIMITS.instructions}
          rows={8}
          onChange={(instructions) => set({ instructions })}
        />
        {isNew && (
          <RadioList
            label="Onde salvar"
            value={editing.scope}
            onChange={(scope) => onChange({ ...editing, scope: scope as AgentScope })}
          >
            <RadioListItem
              value="repo"
              label="No repositório do projeto"
              description="Grava .orkio/agents/<id>.md na pasta do projeto (sem commit). O time usa o mesmo agente."
            />
            <RadioListItem
              value="local"
              label="Só neste computador"
              description="Vale para todos os seus projetos."
            />
          </RadioList>
        )}
        <TextArea
          label="Prévia: o que vai no início da conversa"
          description="Entra com --append-system-prompt. O briefing da tarefa continua igual."
          value={buildAgentPrompt(d)}
          isReadOnly
          rows={6}
          onChange={() => undefined}
        />
        {errors.length > 0 && (
          <VStack gap={1}>
            {errors.map((e) => (
              <Text key={e} type="supporting">
                {e}
              </Text>
            ))}
          </VStack>
        )}
        <HStack gap={2}>
          <Button
            variant="primary"
            label="Salvar agente"
            isLoading={busy}
            isDisabled={errors.length > 0}
            onClick={() => onSave(editing)}
          />
          <Button variant="ghost" label="Cancelar" onClick={onCancel} />
        </HStack>
      </VStack>
    </Card>
  )
}

/** "Tarefas que entram em <etapa> vão para <agente>" (uma por etapa). */
function AssignRules({
  state,
  onSave
}: {
  state: AgentsState
  onSave(rules: AgentsState['rules']): Promise<void>
}): React.JSX.Element | null {
  const [rules, setRules] = useState(state.rules)
  const [stageId, setStageId] = useState<string>('')
  const [agentKey, setAgentKey] = useState<string>('')
  const usable = state.agents.filter(
    (a) => a.profile && a.status !== 'invalid' && a.status !== 'archived'
  )
  if (state.stages.length === 0) {
    return (
      <VStack gap={2}>
        <Heading level={2}>Atribuição por coluna</Heading>
        <Text type="supporting">Crie o quadro deste projeto para atribuir tarefas por coluna.</Text>
      </VStack>
    )
  }
  const stageName = (id: string): string =>
    state.stages.find((s) => s.id === id)?.name ?? 'etapa removida'
  const agentName = (key: string): string =>
    state.agents.find((a) => a.key === key)?.profile?.name ?? key
  const free = state.stages.filter((s) => !rules.some((r) => r.stageId === s.id))
  const dirty = JSON.stringify(rules) !== JSON.stringify(state.rules)

  return (
    <VStack gap={3}>
      <Heading level={2}>Atribuição por coluna</Heading>
      <Text type="supporting">
        Tarefa sem agente que entra na coluna (à mão ou por automação) fica com o agente escolhido.
        Se a coluna tem fluxo ligado ao entrar, ele começa com esse agente.
      </Text>
      {rules.length > 0 && (
        <List hasDividers density="compact" aria-label="Regras de atribuição">
          {rules.map((r) => (
            <Item
              as="li"
              key={r.stageId}
              label={`Ao entrar em ${stageName(r.stageId)}, atribuir a ${agentName(r.agentKey)}`}
              endContent={
                <Button
                  size="sm"
                  variant="ghost"
                  isIconOnly
                  label={`Remover regra de ${stageName(r.stageId)}`}
                  icon={<Icon icon={TrashIcon} />}
                  onClick={() => setRules(rules.filter((x) => x.stageId !== r.stageId))}
                />
              }
            />
          ))}
        </List>
      )}
      {free.length > 0 && usable.length > 0 && (
        <HStack gap={2} vAlign="end" wrap="wrap">
          <Selector
            label="Ao entrar em"
            placeholder="Escolha a coluna"
            options={free.map((s) => ({ value: s.id, label: s.name }))}
            {...(stageId ? { value: stageId } : {})}
            onChange={(v: string) => setStageId(v)}
          />
          <Selector
            label="Atribuir a"
            placeholder="Escolha o agente"
            options={usable.map((a) => ({ value: a.key, label: a.profile!.name }))}
            {...(agentKey ? { value: agentKey } : {})}
            onChange={(v: string) => setAgentKey(v)}
          />
          <Button
            variant="secondary"
            label="Adicionar regra"
            isDisabled={!stageId || !agentKey}
            onClick={() => {
              setRules([...rules, { stageId, agentKey }])
              setStageId('')
              setAgentKey('')
            }}
          />
        </HStack>
      )}
      {dirty && (
        <HStack gap={2}>
          <Button variant="primary" label="Salvar regras" onClick={() => void onSave(rules)} />
          <Button variant="ghost" label="Descartar" onClick={() => setRules(state.rules)} />
        </HStack>
      )}
    </VStack>
  )
}
