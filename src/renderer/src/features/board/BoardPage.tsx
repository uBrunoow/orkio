import { useEffect, useMemo, useState } from 'react'
import { Button } from '@astryxdesign/core/Button'
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput'
import { EmptyState } from '@astryxdesign/core/EmptyState'
import { HStack } from '@astryxdesign/core/HStack'
import { Icon } from '@astryxdesign/core/Icon'
import { Selector } from '@astryxdesign/core/Selector'
import { StackItem } from '@astryxdesign/core/Stack'
import { Text } from '@astryxdesign/core/Text'
import { TextInput } from '@astryxdesign/core/TextInput'
import { Tooltip } from '@astryxdesign/core/Tooltip'
import { VStack } from '@astryxdesign/core/VStack'
import type { AutomationStatus, ProjectView } from '../../../../shared/ipc-contract'
import type { TaskSection } from '../../../../shared/overview'
import { isTextField } from '../../app/shortcuts'
import { Alert } from '../../components/Alert'
import { PageHeader } from '../../components/PageHeader'
import { PageState } from '../../components/PageState'
import { AutomationIcon, PauseIcon, RefreshIcon } from '../../components/icons'
import { ActiveFlowsProvider, useActiveFlows } from '../task-flows/active-flows'
import { AgentBadgesProvider, useAgentBadges } from '../agents/agent-badges'
import { useTaskSignals } from '../notion-workspace/useTaskSignals'
import { BoardColumns } from './BoardColumns'
import { BoardSettings } from './BoardSettings'
import { TaskPanel } from './TaskPanel'
import { useBoard, type BoardError } from './useBoard'

/**
 * Tela "Quadro" do projeto atual (o projeto vem do menu). Etapas e automações, Fluxos e Contexto
 * do Claude são rotas próprias (6E); aqui fica só o quadro e, sem quadro ainda, a criação dele.
 */
export function BoardPage({
  project,
  openTaskId,
  focusSection = null,
  onOpenIntegrations,
  onOpenProjects,
  onExpandTask
}: {
  /** Projeto atual vinculado ao Notion (null = nenhum). */
  project: ProjectView | null
  /** Tarefa a abrir (notificação, Visão geral, Command Palette). */
  openTaskId: string | null
  /** Seção do painel a mostrar ao abrir a tarefa (Visão geral, 6D). */
  focusSection?: TaskSection | null
  onOpenIntegrations(): void
  onOpenProjects(): void
  /** Abre a tarefa em tela cheia. */
  onExpandTask(taskId: string): void
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
      openTaskId={openTaskId}
      focusSection={focusSection}
      onOpenIntegrations={onOpenIntegrations}
      onExpandTask={onExpandTask}
    />
  )
}

function Board({
  projectId,
  projectName,
  openTaskId,
  focusSection,
  onOpenIntegrations,
  onExpandTask
}: {
  projectId: string
  projectName: string
  openTaskId: string | null
  focusSection: TaskSection | null
  onOpenIntegrations(): void
  onExpandTask(taskId: string): void
}): React.JSX.Element {
  const board = useBoard(projectId)
  const automation = useAutomationStatus(projectId)
  const signals = useTaskSignals(projectId)
  const refreshSignals = signals.refresh
  const activeFlows = useActiveFlows(projectId)
  const agentBadges = useAgentBadges(projectId)
  const [selected, setPicked] = useState<string | null>(openTaskId)
  const [query, setQuery] = useState('')
  const [priority, setPriority] = useState<string | null>(null)
  const [onlyBlocked, setOnlyBlocked] = useState(false)
  const { view } = board

  // Esc fecha o painel (fora de campos de texto e de diálogos, que tratam o próprio Esc).
  useEffect(() => {
    if (!selected) return
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented || isTextField(e.target)) return
      if (e.target instanceof Element && e.target.closest('dialog, [role="dialog"], [role="menu"]'))
        return
      setPicked(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selected])

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
        (!onlyBlocked || c.blocked)
    )
  }, [view?.cards, query, priority, onlyBlocked])

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

  const selectedCard = view.cards.find((c) => c.taskId === selected) ?? null
  const actions = {
    onOpen: (taskId: string) => setPicked(taskId),
    onMove: (taskId: string, stageId: string) => void board.move(taskId, stageId),
    onToggleBlocked: (taskId: string, blocked: boolean) => void board.setBlocked(taskId, blocked),
    onToggleAutomation: (taskId: string, paused: boolean) =>
      void board.setAutomationPaused(taskId, paused),
    onExpand: onExpandTask
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
      </HStack>

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
        <HStack gap={4} vAlign="stretch" height="100%" minHeight="calc(var(--spacing-12) * 6)">
          <StackItem size="fill">
            {view.cards.length === 0 ? (
              <EmptyState
                title="Nenhuma tarefa neste projeto"
                description="As tarefas do Notion ligadas a este projeto aparecem aqui."
                headingLevel={2}
              />
            ) : (
              <ActiveFlowsProvider value={activeFlows}>
                <AgentBadgesProvider value={agentBadges}>
                  <BoardColumns
                    stages={view.config.stages}
                    cards={cards}
                    signals={signals.result?.signals ?? {}}
                    selectedTaskId={selected}
                    actions={actions}
                  />
                </AgentBadgesProvider>
              </ActiveFlowsProvider>
            )}
          </StackItem>
          {selectedCard && (
            <VStack width="min(calc(var(--spacing-12) * 9), 42%)" height="100%">
              <TaskPanel
                projectId={projectId}
                agent={agentBadges[selectedCard.taskId] ?? null}
                card={selectedCard}
                stages={view.config.stages}
                signals={signals.result?.signals[selectedCard.taskId]}
                onMove={(stageId) => actions.onMove(selectedCard.taskId, stageId)}
                onToggleBlocked={(blocked) => actions.onToggleBlocked(selectedCard.taskId, blocked)}
                onToggleAutomation={(paused) =>
                  actions.onToggleAutomation(selectedCard.taskId, paused)
                }
                onClose={() => setPicked(null)}
                focusSection={selectedCard.taskId === openTaskId ? focusSection : null}
                onExpand={() => onExpandTask(selectedCard.taskId)}
              />
            </VStack>
          )}
        </HStack>
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
          : status.lastRunAt
            ? `Verificado às ${time(status.lastRunAt)}${status.error ? ` (${status.error})` : ''}`
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
