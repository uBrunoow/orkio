import { useEffect, useMemo, useState } from 'react'
import { Button } from '@astryxdesign/core/Button'
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput'
import { EmptyState } from '@astryxdesign/core/EmptyState'
import { HStack } from '@astryxdesign/core/HStack'
import { Icon } from '@astryxdesign/core/Icon'
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl'
import { Selector } from '@astryxdesign/core/Selector'
import { StackItem } from '@astryxdesign/core/Stack'
import { Text } from '@astryxdesign/core/Text'
import { TextInput } from '@astryxdesign/core/TextInput'
import { ToggleButton } from '@astryxdesign/core/ToggleButton'
import { Tooltip } from '@astryxdesign/core/Tooltip'
import { VStack } from '@astryxdesign/core/VStack'
import type { AutomationStatus, ProjectView } from '../../../../shared/ipc-contract'
import { Alert } from '../../components/Alert'
import { PageHeader } from '../../components/PageHeader'
import { PageState } from '../../components/PageState'
import {
  AutomationIcon,
  BoardIcon,
  DotIcon,
  ListIcon,
  PauseIcon,
  RefreshIcon
} from '../../components/icons'
import { ActiveFlowsProvider, useActiveFlows } from '../task-flows/active-flows'
import { AgentBadgesProvider, useAgentBadges, type AgentBadges } from '../agents/agent-badges'
import { AgentAvatar } from '../agents/AgentAvatar'
import type { ActiveFlows } from '../task-flows/active-flows'
import { useTaskSignals } from '../notion-workspace/useTaskSignals'
import { BoardColumns } from './BoardColumns'
import { BoardList } from './BoardList'
import { BoardSettings } from './BoardSettings'
import { useBoard, type BoardError } from './useBoard'

/**
 * Tela "Quadro" do projeto atual (o projeto vem do menu). Etapas e automações, Fluxos e Contexto
 * do Claude são rotas próprias (6E); aqui fica só o quadro e, sem quadro ainda, a criação dele.
 */
export function BoardPage({
  project,
  onOpenIntegrations,
  onOpenProjects,
  onOpenTask
}: {
  /** Projeto atual vinculado ao Notion (null = nenhum). */
  project: ProjectView | null
  onOpenIntegrations(): void
  onOpenProjects(): void
  /** Abre a tela da tarefa. */
  onOpenTask(taskId: string): void
}): React.JSX.Element {
  if (!project) {
    return (
      <VStack gap={5}>
        <PageHeader title="Quadro" />
        <PageState
          kind="empty"
          title="Nenhum projeto vinculado ao Notion"
          description="Vincule um projeto a um projeto do Notion em Projetos para abrir o quadro."
          action={{ label: 'Ir para Projetos', onClick: onOpenProjects }}
        />
      </VStack>
    )
  }
  return (
    <Board
      projectId={project.id}
      projectName={project.name}
      onOpenIntegrations={onOpenIntegrations}
      onOpenTask={onOpenTask}
    />
  )
}

function Board({
  projectId,
  projectName,
  onOpenIntegrations,
  onOpenTask
}: {
  projectId: string
  projectName: string
  onOpenIntegrations(): void
  onOpenTask(taskId: string): void
}): React.JSX.Element {
  const board = useBoard(projectId)
  const automation = useAutomationStatus(projectId)
  const signals = useTaskSignals(projectId)
  const refreshSignals = signals.refresh
  const activeFlows = useActiveFlows(projectId)
  const agentBadges = useAgentBadges(projectId)
  const [query, setQuery] = useState('')
  const [priority, setPriority] = useState<string | null>(null)
  const [onlyBlocked, setOnlyBlocked] = useState(false)
  const [agentKey, setAgentKey] = useState<string | null>(null)
  const [layout, setLayout] = useState<'kanban' | 'list'>('kanban')
  const { view } = board

  // Branches/PRs depois de carregar o quadro.
  const fetchedAt = view?.fetchedAt
  useEffect(() => {
    if (fetchedAt) void refreshSignals(false)
  }, [fetchedAt, refreshSignals])

  const priorities = useMemo(
    () => [...new Set((view?.cards ?? []).flatMap((c) => (c.priority ? [c.priority.name] : [])))],
    [view?.cards]
  )
  const cards = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (view?.cards ?? []).filter(
      (c) =>
        (!q ||
          c.title.toLowerCase().includes(q) ||
          (c.displayId ?? '').toLowerCase().includes(q)) &&
        (!priority || c.priority?.name === priority) &&
        (!onlyBlocked || c.blocked) &&
        (!agentKey || agentBadges[c.taskId]?.key === agentKey)
    )
  }, [view?.cards, query, priority, onlyBlocked, agentKey, agentBadges])

  const header = (action?: React.ReactNode): React.JSX.Element => (
    <PageHeader title="Quadro" context={projectName} action={action} />
  )

  if (!view) {
    return (
      <VStack gap={5}>
        {header()}
        {board.error ? (
          <BoardErrorAlert error={board.error} onOpenIntegrations={onOpenIntegrations} />
        ) : (
          <PageState kind="loading" label="Carregando quadro" />
        )}
      </VStack>
    )
  }

  if (!view.config) {
    return (
      <VStack gap={5}>
        {header()}
        <BoardSettings view={view} onSave={(input) => board.save(input)} onCancel={undefined} />
      </VStack>
    )
  }

  const actions = {
    onOpen: onOpenTask,
    onMove: (taskId: string, stageId: string) => void board.move(taskId, stageId),
    onToggleBlocked: (taskId: string, blocked: boolean) => void board.setBlocked(taskId, blocked),
    onToggleAutomation: (taskId: string, paused: boolean) =>
      void board.setAutomationPaused(taskId, paused),
    onExpand: onOpenTask
  }

  return (
    // Ocupa a altura útil da janela: as colunas e o painel rolam por dentro.
    <VStack gap={4} height="100%">
      {header(
        <HStack gap={2} vAlign="center" wrap="wrap" hAlign="end">
          <AutomationLine status={automation.status} onOpenIntegrations={onOpenIntegrations} />
          <Button
            variant="ghost"
            label="Atualizar"
            icon={<Icon icon={RefreshIcon} />}
            isLoading={board.loading || automation.running}
            onClick={() => {
              // Verifica git/GitHub agora (automações) e relê o Notion.
              void automation.runNow().then(() => board.load(true))
            }}
          />
          <Button
            variant="ghost"
            label={automation.status?.paused ? 'Retomar automações' : 'Pausar todas'}
            icon={<Icon icon={automation.status?.paused ? AutomationIcon : PauseIcon} />}
            onClick={() => void automation.setPaused(!automation.status?.paused)}
          />
        </HStack>
      )}
      <HStack gap={3} vAlign="center" wrap="wrap" role="toolbar" aria-label="Filtros do quadro">
        <TextInput
          type="search"
          label="Buscar tarefas"
          isLabelHidden
          placeholder="Buscar por ID ou título"
          hasClear
          value={query}
          onChange={setQuery}
        />
        {priorities.length > 0 && (
          <Selector
            label="Prioridade"
            isLabelHidden
            placeholder="Todas as prioridades"
            hasClear
            options={priorities.map((p) => ({ value: p, label: p }))}
            value={priority}
            onChange={(value: string | null) => setPriority(value)}
          />
        )}
        <CheckboxInput label="Só bloqueadas" value={onlyBlocked} onChange={setOnlyBlocked} />
        <StackItem size="fill" />
        <SegmentedControl
          label="Visualização do quadro"
          size="sm"
          value={layout}
          onChange={(v) => setLayout(v === 'list' ? 'list' : 'kanban')}
        >
          <SegmentedControlItem value="kanban" label="Kanban" icon={<Icon icon={BoardIcon} />} />
          <SegmentedControlItem value="list" label="Lista" icon={<Icon icon={ListIcon} />} />
        </SegmentedControl>
      </HStack>
      <AgentRow
        cards={view.cards}
        badges={agentBadges}
        flows={activeFlows}
        selected={agentKey}
        onSelect={setAgentKey}
      />

      {view.pendingCount > 0 && (
        <Alert
          tone="warning"
          action={<Button size="sm" label="Tentar agora" onClick={() => void board.retryNow()} />}
        >
          {view.pendingCount === 1
            ? '1 alteração aguardando o Notion.'
            : `${view.pendingCount} alterações aguardando o Notion.`}{' '}
          Elas são enviadas sozinhas quando a conexão voltar, mesmo depois de fechar o Orkio.
        </Alert>
      )}
      {board.error && (
        <BoardErrorAlert error={board.error} onOpenIntegrations={onOpenIntegrations} />
      )}
      {board.notice && (
        <Alert
          tone="danger"
          action={
            <HStack gap={2}>
              {board.notice.canReconnect && (
                <Button
                  size="sm"
                  variant="ghost"
                  label="Ir para Integrações"
                  onClick={onOpenIntegrations}
                />
              )}
              <Button
                size="sm"
                variant="ghost"
                label="Fechar aviso"
                onClick={board.dismissNotice}
              />
            </HStack>
          }
        >
          {board.notice.message}
        </Alert>
      )}
      {view.issues.length > 0 && (
        <Alert tone={view.issues.some((i) => i.level === 'error') ? 'danger' : 'warning'}>
          <VStack gap={1}>
            {view.issues.map((i) => (
              <Text key={`${i.stageId}-${i.message}`}>{i.message}</Text>
            ))}
          </VStack>
        </Alert>
      )}
      {view.truncated && (
        <Text type="supporting">Mostrando as 500 tarefas mais recentes deste projeto.</Text>
      )}

      <StackItem size="fill">
        <VStack
          height="100%"
          minHeight="calc(var(--spacing-12) * 6)"
          style={{ position: 'relative' }}
        >
          {view.cards.length === 0 ? (
            <EmptyState
              title="Nenhuma tarefa neste projeto"
              description="As tarefas do Notion ligadas a este projeto aparecem aqui."
              headingLevel={2}
            />
          ) : (
            <ActiveFlowsProvider value={activeFlows}>
              <AgentBadgesProvider value={agentBadges}>
                {layout === 'list' ? (
                  <BoardList
                    stages={view.config.stages}
                    cards={cards}
                    signals={signals.result?.signals ?? {}}
                    selectedTaskId={null}
                    actions={actions}
                  />
                ) : (
                  <BoardColumns
                    stages={view.config.stages}
                    cards={cards}
                    signals={signals.result?.signals ?? {}}
                    selectedTaskId={null}
                    actions={actions}
                    endInset={null}
                  />
                )}
              </AgentBadgesProvider>
            </ActiveFlowsProvider>
          )}
        </VStack>
      </StackItem>
    </VStack>
  )
}

function BoardErrorAlert({
  error,
  onOpenIntegrations
}: {
  error: BoardError
  onOpenIntegrations(): void
}): React.JSX.Element {
  const toIntegrations =
    error.canReconnect || ['not_configured', 'broken', 'not_connected'].includes(error.code)
  return (
    <Alert
      tone="danger"
      {...(toIntegrations
        ? {
            action: (
              <Button
                size="sm"
                variant="ghost"
                label="Ir para Integrações"
                onClick={onOpenIntegrations}
              />
            )
          }
        : {})}
    >
      {error.message}
    </Alert>
  )
}

/** Estado das automações do projeto (atualiza a cada 15 s enquanto a tela está aberta). */
function useAutomationStatus(projectId: string): {
  status: AutomationStatus | null
  running: boolean
  runNow(): Promise<void>
  setPaused(paused: boolean): Promise<void>
} {
  const [status, setStatus] = useState<AutomationStatus | null>(null)
  const [running, setRunning] = useState(false)
  useEffect(() => {
    let active = true
    const load = (): void => {
      void window.orkio.automation
        .status(projectId)
        .then((s) => {
          if (active) setStatus(s)
        })
        .catch(() => {})
    }
    load()
    const timer = window.setInterval(load, 15_000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [projectId])
  return {
    status,
    running,
    runNow: async () => {
      setRunning(true)
      const next = await window.orkio.automation.runNow(projectId).catch(() => null)
      setRunning(false)
      if (next) setStatus(next)
    },
    setPaused: async (paused) => {
      const next = await window.orkio.automation.setPaused(paused).catch(() => null)
      if (next)
        setStatus({
          ...next,
          ...(status
            ? { github: status.github, lastRunAt: status.lastRunAt, nextRunAt: status.nextRunAt }
            : {})
        })
    }
  }
}


/** Estado das automações, curto, no cabeçalho do quadro. */
function AutomationLine({
  status,
  onOpenIntegrations
}: {
  status: AutomationStatus | null
  onOpenIntegrations(): void
}): React.JSX.Element | null {
  if (!status) return null
  const time = (iso: string | null): string =>
    iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—'
  const text = status.paused
    ? 'Automações pausadas para todos os projetos'
    : status.github === 'disconnected'
      ? 'Automações só com eventos locais'
      : status.github === 'rate_limited'
        ? `Limite do GitHub: próxima verificação às ${time(status.nextRunAt)}`
        : status.github === 'ok'
          ? `GitHub verificado às ${time(status.lastRunAt)}`
          : status.github === 'unverified' || status.error
            ? `Falhou às ${time(status.lastRunAt)}${status.error ? ` (${status.error})` : ' (sem conexão com o GitHub)'}; nova tentativa às ${time(status.nextRunAt)}`
            : status.lastRunAt
              ? `Verificado às ${time(status.lastRunAt)}`
              : 'Aguardando a primeira verificação'
  const detail = status.paused
    ? 'Os eventos são registrados no histórico, sem mover tarefas.'
    : 'As automações movem as tarefas pelos eventos do git e do GitHub.'
  return (
    <HStack gap={2} vAlign="center" data-testid="automation-status">
      <Tooltip content={detail} placement="below">
        <HStack gap={1} vAlign="center">
          <Icon icon={status.paused ? PauseIcon : AutomationIcon} size="sm" color="secondary" />
          <Text type="supporting">{text}</Text>
        </HStack>
      </Tooltip>
      {!status.paused && status.github === 'disconnected' && (
        <Button size="sm" variant="ghost" label="Conectar GitHub" onClick={onOpenIntegrations} />
      )}
    </HStack>
  )
}

/**
 * Agentes com tarefas neste quadro: avatar, nome e quantas tarefas. Clicar filtra o quadro pelo
 * agente; o ponto laranja marca agente com fluxo rodando agora.
 */
function AgentRow({
  cards,
  badges,
  flows,
  selected,
  onSelect
}: {
  cards: readonly { taskId: string }[]
  badges: AgentBadges
  flows: ActiveFlows
  selected: string | null
  onSelect(key: string | null): void
}): React.JSX.Element | null {
  const agents = new Map<
    string,
    { name: string; color: AgentBadges[string]['color']; count: number; running: boolean }
  >()
  for (const { taskId } of cards) {
    const badge = badges[taskId]
    if (!badge) continue
    const cur = agents.get(badge.key) ?? {
      name: badge.name,
      color: badge.color,
      count: 0,
      running: false
    }
    cur.count += 1
    if (flows[taskId] === 'running') cur.running = true
    agents.set(badge.key, cur)
  }
  if (agents.size === 0) return null
  const list = [...agents.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name, 'pt-BR'))
  return (
    <HStack gap={2} vAlign="center" wrap="wrap" role="group" aria-label="Agentes do quadro">
      <Text type="supporting" color="secondary">
        Agentes
      </Text>
      {list.map(([key, a]) => (
        <ToggleButton
          key={key}
          size="sm"
          label={`${a.name}: ${a.count === 1 ? '1 tarefa' : `${a.count} tarefas`}${a.running ? ', rodando' : ''}`}
          isPressed={selected === key}
          onPressedChange={(pressed) => onSelect(pressed ? key : null)}
          icon={<AgentAvatar name={a.name} color={a.color} seed={key} />}
        >
          <HStack gap={1} vAlign="center">
            <Text>{a.name}</Text>
            <Text type="supporting" color="secondary" hasTabularNumbers>
              {a.count}
            </Text>
            {a.running && <Icon icon={DotIcon} size="sm" color="accent" />}
          </HStack>
        </ToggleButton>
      ))}
    </HStack>
  )
}
