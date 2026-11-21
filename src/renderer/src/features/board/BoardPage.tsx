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
import { VStack } from '@astryxdesign/core/VStack'
import type { AutomationStatus, ProjectView } from '../../../../shared/ipc-contract'
import { Alert } from '../../components/Alert'
import { PageHeader } from '../../components/PageHeader'
import { PageState } from '../../components/PageState'
import { AutomationIcon, PauseIcon, RefreshIcon } from '../../components/icons'
import { ActiveFlowsProvider, useActiveFlows } from '../task-flows/active-flows'
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
  onOpenIntegrations,
  onOpenProjects,
  onExpandTask
}: {
  /** Projeto atual vinculado ao Notion (null = nenhum). */
  project: ProjectView | null
  /** Tarefa a abrir (notificação, Visão geral, Command Palette). */
  openTaskId: string | null
  onOpenIntegrations(): void
  onOpenProjects(): void
  /** Abre a tarefa em tela cheia. */
  onExpandTask(taskId: string): void
}): React.JSX.Element {
  return (
    <VStack gap={5}>
      <PageHeader
        title="Quadro"
        {...(project ? { context: project.name } : {})}
        subtitle="Suas etapas de trabalho, ligadas ao status das tarefas no Notion."
      />
      {!project ? (
        <PageState
          kind="empty"
          title="Nenhum projeto vinculado ao Notion"
          description="Vincule um projeto a um projeto do Notion em Projetos para abrir o quadro."
          action={{ label: 'Ir para Projetos', onClick: onOpenProjects }}
        />
      ) : (
        <Board
          projectId={project.id}
          openTaskId={openTaskId}
          onOpenIntegrations={onOpenIntegrations}
          onExpandTask={onExpandTask}
        />
      )}
    </VStack>
  )
}

function Board({
  projectId,
  openTaskId,
  onOpenIntegrations,
  onExpandTask
}: {
  projectId: string
  openTaskId: string | null
  onOpenIntegrations(): void
  onExpandTask(taskId: string): void
}): React.JSX.Element {
  const board = useBoard(projectId)
  const automation = useAutomationStatus(projectId)
  const signals = useTaskSignals(projectId)
  const refreshSignals = signals.refresh
  const activeFlows = useActiveFlows(projectId)
  const [selected, setPicked] = useState<string | null>(openTaskId)
  const [query, setQuery] = useState('')
  const [priority, setPriority] = useState<string | null>(null)
  const [onlyBlocked, setOnlyBlocked] = useState(false)
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
        (!onlyBlocked || c.blocked)
    )
  }, [view?.cards, query, priority, onlyBlocked])

  if (!view) {
    return board.error ? (
      <BoardErrorAlert error={board.error} onOpenIntegrations={onOpenIntegrations} />
    ) : (
      <PageState kind="loading" label="Carregando quadro" />
    )
  }

  if (!view.config) {
    return <BoardSettings view={view} onSave={(input) => board.save(input)} onCancel={undefined} />
  }

  const selectedCard = view.cards.find((c) => c.taskId === selected) ?? null
  const actions = {
    onOpen: (taskId: string) => setPicked(taskId),
    onMove: (taskId: string, stageId: string) => void board.move(taskId, stageId),
    onToggleBlocked: (taskId: string, blocked: boolean) => void board.setBlocked(taskId, blocked),
    onToggleAutomation: (taskId: string, paused: boolean) =>
      void board.setAutomationPaused(taskId, paused)
  }

  return (
    <VStack gap={4}>
      <HStack gap={3} vAlign="end" wrap="wrap" role="toolbar" aria-label="Filtros do quadro">
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

      <AutomationLine status={automation.status} />
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

      <HStack gap={4} vAlign="start">
        <StackItem size="fill">
          {view.cards.length === 0 ? (
            <EmptyState
              title="Nenhuma tarefa neste projeto"
              description="As tarefas do Notion ligadas a este projeto aparecem aqui."
              headingLevel={2}
            />
          ) : (
            <ActiveFlowsProvider value={activeFlows}>
              <BoardColumns
                stages={view.config.stages}
                cards={cards}
                signals={signals.result?.signals ?? {}}
                selectedTaskId={selected}
                actions={actions}
              />
            </ActiveFlowsProvider>
          )}
        </StackItem>
        {selectedCard && (
          <VStack
            width="min(calc(var(--spacing-12) * 9), 42%)"
            height="calc(100dvh - var(--spacing-12) * 5)"
          >
            <TaskPanel
              projectId={projectId}
              card={selectedCard}
              stages={view.config.stages}
              signals={signals.result?.signals[selectedCard.taskId]}
              onMove={(stageId) => actions.onMove(selectedCard.taskId, stageId)}
              onToggleBlocked={(blocked) => actions.onToggleBlocked(selectedCard.taskId, blocked)}
              onToggleAutomation={(paused) =>
                actions.onToggleAutomation(selectedCard.taskId, paused)
              }
              onClose={() => setPicked(null)}
              onExpand={() => onExpandTask(selectedCard.taskId)}
            />
          </VStack>
        )}
      </HStack>
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

function AutomationLine({ status }: { status: AutomationStatus | null }): React.JSX.Element | null {
  if (!status) return null
  const time = (iso: string | null): string =>
    iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—'
  const text = status.paused
    ? 'Automações pausadas para todos os projetos. Os eventos são registrados no histórico, sem mover tarefas.'
    : status.github === 'disconnected'
      ? 'Automações: só eventos locais (conecte o GitHub em Integrações para PRs e reviews).'
      : status.github === 'rate_limited'
        ? `Automações: limite do GitHub atingido; próxima verificação às ${time(status.nextRunAt)}.`
        : status.github === 'ok'
          ? `Automações ativas: GitHub verificado às ${time(status.lastRunAt)}.`
          : status.lastRunAt
            ? `Automações: última verificação às ${time(status.lastRunAt)}${status.error ? ` (${status.error})` : ''}.`
            : 'Automações: aguardando a primeira verificação.'
  return (
    <HStack gap={2} vAlign="center" data-testid="automation-status">
      <Icon icon={status.paused ? PauseIcon : AutomationIcon} size="sm" color="secondary" />
      <Text type="supporting">{text}</Text>
    </HStack>
  )
}
