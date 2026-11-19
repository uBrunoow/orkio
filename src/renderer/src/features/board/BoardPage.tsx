import { useEffect, useMemo, useState } from 'react'
import { Button } from '@astryxdesign/core/Button'
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput'
import { EmptyState } from '@astryxdesign/core/EmptyState'
import { HStack } from '@astryxdesign/core/HStack'
import { Icon } from '@astryxdesign/core/Icon'
import { Selector } from '@astryxdesign/core/Selector'
import { Skeleton } from '@astryxdesign/core/Skeleton'
import { StackItem } from '@astryxdesign/core/Stack'
import { Text } from '@astryxdesign/core/Text'
import { TextInput } from '@astryxdesign/core/TextInput'
import { VStack } from '@astryxdesign/core/VStack'
import type { ProjectView } from '../../../../shared/ipc-contract'
import { Alert } from '../../components/Alert'
import { PageHeader } from '../../components/PageHeader'
import { RefreshIcon, SettingsIcon } from '../../components/icons'
import { useTaskSignals } from '../notion-workspace/useTaskSignals'
import { BoardColumns } from './BoardColumns'
import { BoardSettings } from './BoardSettings'
import { TaskPanel } from './TaskPanel'
import { useBoard, type BoardError } from './useBoard'

/** Tela "Quadro": kanban por projeto vinculado ao Notion. */
export function BoardPage({
  onOpenIntegrations,
  onOpenProjects
}: {
  onOpenIntegrations(): void
  onOpenProjects(): void
}): React.JSX.Element {
  const [projects, setProjects] = useState<ProjectView[] | null>(null)
  const [projectId, setProjectId] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void window.orkio.projects
      .list()
      .then((result) => {
        if (!active) return
        const linked = result.projects.filter((p) => p.notionProject)
        setProjects(linked)
        setProjectId((current) => current ?? linked[0]?.id ?? null)
      })
      .catch(() => {
        if (active) setProjects([])
      })
    return () => {
      active = false
    }
  }, [])

  return (
    <VStack gap={5}>
      <PageHeader
        title="Quadro"
        subtitle="Suas etapas de trabalho, ligadas ao status das tarefas no Notion."
        action={
          projects && projects.length > 1 ? (
            <Selector
              label="Projeto"
              isLabelHidden
              width={260}
              options={projects.map((p) => ({ value: p.id, label: p.name }))}
              {...(projectId ? { value: projectId } : {})}
              onChange={(value: string) => setProjectId(value)}
            />
          ) : undefined
        }
      />
      {projects === null ? (
        <Skeleton height={120} aria-label="Carregando projetos" />
      ) : projects.length === 0 || !projectId ? (
        <EmptyState
          title="Nenhum projeto vinculado ao Notion"
          description="Vincule um projeto a um projeto do Notion em Projetos para abrir o quadro."
          headingLevel={2}
          actions={<Button label="Ir para Projetos" onClick={onOpenProjects} />}
        />
      ) : (
        <Board key={projectId} projectId={projectId} onOpenIntegrations={onOpenIntegrations} />
      )}
    </VStack>
  )
}

function Board({
  projectId,
  onOpenIntegrations
}: {
  projectId: string
  onOpenIntegrations(): void
}): React.JSX.Element {
  const board = useBoard(projectId)
  const signals = useTaskSignals(projectId)
  const refreshSignals = signals.refresh
  const [editing, setEditing] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
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
      <VStack gap={3} aria-label="Carregando quadro">
        <Skeleton height={48} />
        <Skeleton height={240} index={1} />
      </VStack>
    )
  }

  if (!view.config || editing) {
    return (
      <BoardSettings
        view={view}
        onSave={async (input) => {
          const result = await board.save(input)
          if (result.ok) setEditing(false)
          return result
        }}
        onCancel={view.config ? () => setEditing(false) : undefined}
      />
    )
  }

  const selectedCard = view.cards.find((c) => c.taskId === selected) ?? null
  const actions = {
    onOpen: (taskId: string) => setSelected(taskId),
    onMove: (taskId: string, stageId: string) => void board.move(taskId, stageId),
    onToggleBlocked: (taskId: string, blocked: boolean) => void board.setBlocked(taskId, blocked)
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
          isLoading={board.loading}
          onClick={() => {
            void board.load(true)
          }}
        />
        <Button
          variant="ghost"
          label="Ajustar quadro"
          icon={<Icon icon={SettingsIcon} />}
          onClick={() => setEditing(true)}
        />
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

      <HStack gap={4} vAlign="start">
        <StackItem size="fill">
          {view.cards.length === 0 ? (
            <EmptyState
              title="Nenhuma tarefa neste projeto"
              description="As tarefas do Notion ligadas a este projeto aparecem aqui."
              headingLevel={2}
            />
          ) : (
            <BoardColumns
              stages={view.config.stages}
              cards={cards}
              signals={signals.result?.signals ?? {}}
              selectedTaskId={selected}
              actions={actions}
            />
          )}
        </StackItem>
        {selectedCard && (
          <VStack width="calc(var(--spacing-12) * 7)">
            <TaskPanel
              projectId={projectId}
              card={selectedCard}
              stages={view.config.stages}
              signals={signals.result?.signals[selectedCard.taskId]}
              onMove={(stageId) => actions.onMove(selectedCard.taskId, stageId)}
              onToggleBlocked={(blocked) => actions.onToggleBlocked(selectedCard.taskId, blocked)}
              onClose={() => setSelected(null)}
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
