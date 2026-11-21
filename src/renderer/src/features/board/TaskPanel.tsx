import { useEffect, useState } from 'react'
import { Button } from '@astryxdesign/core/Button'
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput'
import { Code } from '@astryxdesign/core/Code'
import { HStack } from '@astryxdesign/core/HStack'
import { Heading } from '@astryxdesign/core/Heading'
import { Icon } from '@astryxdesign/core/Icon'
import { IconButton } from '@astryxdesign/core/IconButton'
import { Item } from '@astryxdesign/core/Item'
import { List } from '@astryxdesign/core/List'
import { ScrollableArea } from '@astryxdesign/core/ScrollableArea'
import { Selector } from '@astryxdesign/core/Selector'
import { Skeleton } from '@astryxdesign/core/Skeleton'
import { StackItem } from '@astryxdesign/core/Stack'
import { Text } from '@astryxdesign/core/Text'
import { Token } from '@astryxdesign/core/Token'
import { VStack } from '@astryxdesign/core/VStack'
import type {
  BoardCard,
  BoardHistoryEntry,
  BoardStage,
  TaskSignals
} from '../../../../shared/ipc-contract'
import type { TaskSection } from '../../../../shared/overview'
import {
  branchUrl,
  describeEvent as describe,
  prNumber,
  prUrl
} from '../../../../shared/task-history'
import { Alert } from '../../components/Alert'
import { CloseIcon, ExpandIcon, ExternalLinkIcon } from '../../components/icons'
import { StatusToken } from '../../components/StatusToken'
import { TaskClaudeSection } from '../claude/TaskClaudeSection'
import { TaskFlowSection } from '../task-flows/TaskFlowSection'
import { TaskSignalsLine } from '../notion-workspace/TaskSignalsLine'
import type { AgentBadge } from '../../../../shared/agent'
import { TaskAgentSection } from '../agents/TaskAgentSection'

/**
 * Tarefa: dados, ações, branch/PR, fluxo, Claude Code e histórico (task_events).
 * `panel` = prévia ao lado do Quadro (rolagem própria, "Abrir tarefa"); `page` = tela cheia em
 * duas colunas (trabalho à esquerda, dados e histórico à direita).
 */
export function TaskPanel({
  projectId,
  agent,
  card,
  stages,
  signals,
  onMove,
  onToggleBlocked,
  onToggleAutomation,
  onClose,
  onExpand,
  variant = 'panel',
  focusSection = null
}: {
  projectId: string
  /** Agente da tarefa (8A). */
  agent: AgentBadge | null
  card: BoardCard
  stages: readonly BoardStage[]
  signals: TaskSignals | undefined
  onMove(stageId: string): void
  onToggleBlocked(blocked: boolean): void
  onToggleAutomation(paused: boolean): void
  onClose(): void
  /** Abre a tarefa em tela cheia (só no painel). */
  onExpand?: () => void
  variant?: 'panel' | 'page'
  /** Seção a mostrar ao abrir (Visão geral, 6D): Fluxo, Claude Code ou Histórico. */
  focusSection?: TaskSection | null
}): React.JSX.Element {
  // Vindo da Visão geral: rola até a seção certa quando a tarefa abre.
  useEffect(() => {
    if (!focusSection) return
    const timer = setTimeout(() => {
      document
        .querySelector(`[data-panel-section="${focusSection}"]`)
        ?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    }, 50)
    return () => clearTimeout(timer)
  }, [focusSection, card.taskId])
  const [history, setHistory] = useState<BoardHistoryEntry[] | null>(null)
  // Execuções do Claude Code também escrevem no histórico (início, fim, bloqueios).
  const [runTick, setRunTick] = useState(0)
  useEffect(
    () =>
      window.orkio.claude.onRunEvent((m) => {
        if (
          m.taskId === card.taskId &&
          (m.event.kind === 'status' ||
            (m.event.kind === 'permission' && m.event.state === 'blocked'))
        ) {
          setRunTick((n) => n + 1)
        }
      }),
    [card.taskId]
  )
  // Fluxos (5A) também escrevem no histórico.
  useEffect(
    () =>
      window.orkio.taskFlows.onChanged((e) => {
        if (e.taskId === card.taskId) setRunTick((n) => n + 1)
      }),
    [card.taskId]
  )
  const stageName = (id: string | null): string =>
    id ? (stages.find((s) => s.id === id)?.name ?? 'etapa removida') : 'Sem etapa'

  // Recarrega o histórico quando o card muda (movido, sincronizado, recusado).
  useEffect(() => {
    let active = true
    void window.orkio.board
      .history(projectId, card.taskId)
      .then((result) => {
        if (active) setHistory(result.ok ? result.value : [])
      })
      .catch(() => {
        if (active) setHistory([])
      })
    return () => {
      active = false
    }
  }, [
    projectId,
    card.taskId,
    card.stageId,
    card.blocked,
    card.automationPaused,
    card.sync.state,
    agent?.key,
    runTick
  ])

  const label = card.displayId ?? card.title
  // "Esperando você" sempre no topo (6E): o pedido em si fica na seção Claude Code.
  const [waiting, setWaiting] = useState(0)
  const waitingBanner =
    waiting > 0 ? (
      <Alert
        tone="warning"
        action={
          <Button
            size="sm"
            variant="secondary"
            label={waiting === 1 ? 'Ver pedido' : 'Ver pedidos'}
            onClick={() =>
              document
                .getElementById(`claude-waiting-${card.taskId}`)
                ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
            }
          />
        }
      >
        {waiting === 1
          ? 'O Claude Code está esperando você.'
          : `O Claude Code está esperando você (${waiting} pedidos).`}
      </Alert>
    ) : null

  const tokens = (
    <>
      <HStack gap={2} wrap="wrap" vAlign="center">
        {card.status && <Token size="sm" label={`Notion: ${card.status.name}`} color="default" />}
        {card.priority && (
          <Text type="supporting" color="secondary" data-testid="task-priority">
            {card.priority.name}
          </Text>
        )}
        {card.sync.state === 'pending' && <StatusToken tone="warning" label="Sincronizando" />}
      </HStack>
      {card.sync.state === 'pending' && card.sync.message && (
        <Text type="supporting">{card.sync.message}</Text>
      )}
      {card.assignees.length > 0 && (
        <Text type="supporting">Responsável: {card.assignees.join(', ')}</Text>
      )}
      <TaskSignalsLine signals={signals} />
    </>
  )

  const controls = (
    <VStack gap={3}>
      <Selector
        label="Mover para"
        options={stages.map((s) => ({ value: s.id, label: s.name }))}
        {...(card.stageId ? { value: card.stageId } : { placeholder: 'Sem etapa' })}
        onChange={(value: string) => {
          if (value !== card.stageId) onMove(value)
        }}
      />
      <CheckboxInput
        label="Bloqueada"
        value={card.blocked}
        onChange={(checked) => onToggleBlocked(checked)}
      />
      <CheckboxInput
        label="Pausar automações desta tarefa"
        value={card.automationPaused}
        onChange={(checked) => onToggleAutomation(checked)}
      />
      {card.url && (
        <HStack>
          <Button
            variant="ghost"
            size="sm"
            label="Abrir no Notion"
            icon={<Icon icon={ExternalLinkIcon} />}
            onClick={() => void window.orkio.openExternal(card.url!)}
          />
        </HStack>
      )}
    </VStack>
  )

  const work = (
    <>
      <TaskAgentSection projectId={projectId} taskId={card.taskId} agent={agent} />
      <VStack data-panel-section="flow">
        <TaskFlowSection
          projectId={projectId}
          taskId={card.taskId}
          stageId={card.stageId}
          pr={signals?.pr ?? null}
        />
      </VStack>
      <VStack data-panel-section="claude">
        <TaskClaudeSection
          projectId={projectId}
          taskId={card.taskId}
          stageName={card.stageId ? stageName(card.stageId) : null}
          onWaitingChange={setWaiting}
        />
      </VStack>
    </>
  )

  const historySection = (
    <VStack gap={2} data-panel-section="history">
      <Heading level={3}>Histórico</Heading>
      {history === null ? (
        <Skeleton height={40} aria-label="Carregando histórico" />
      ) : history.length === 0 ? (
        <Text type="supporting">Sem eventos ainda.</Text>
      ) : (
        <List hasDividers density="compact" aria-label="Histórico da tarefa">
          {history.map((e) => (
            <Item
              as="li"
              key={e.id}
              label={describe(e, stageName)}
              description={new Date(e.at).toLocaleString('pt-BR', {
                dateStyle: 'short',
                timeStyle: 'short'
              })}
              {...(prUrl(e)
                ? {
                    endContent: (
                      <IconButton
                        size="sm"
                        variant="ghost"
                        label={`Abrir a PR #${prNumber(e)} no GitHub`}
                        icon={<Icon icon={ExternalLinkIcon} />}
                        onClick={() => void window.orkio.openExternal(prUrl(e)!)}
                      />
                    )
                  }
                : branchUrl(e)
                  ? {
                      endContent: (
                        <IconButton
                          size="sm"
                          variant="ghost"
                          label="Abrir a branch no GitHub"
                          icon={<Icon icon={ExternalLinkIcon} />}
                          onClick={() => void window.orkio.openExternal(branchUrl(e)!)}
                        />
                      )
                    }
                  : {})}
            />
          ))}
        </List>
      )}
    </VStack>
  )

  if (variant === 'page') {
    return (
      <HStack gap={6} vAlign="start" role="region" aria-label={`Tarefa ${label}`}>
        <StackItem size="fill">
          <VStack gap={5}>
            {waitingBanner}
            {work}
          </VStack>
        </StackItem>
        <VStack gap={5} width="calc(var(--spacing-12) * 7)">
          <VStack gap={3}>{tokens}</VStack>
          {controls}
          {historySection}
        </VStack>
      </HStack>
    )
  }

  return (
    <VStack role="complementary" aria-label={`Detalhes de ${label}`} height="100%">
      <ScrollableArea label={`Detalhes de ${label} (rolagem)`} height="100%" padding={4}>
        <VStack gap={4}>
          <HStack gap={1} vAlign="start">
            <StackItem size="fill">
              <VStack gap={1}>
                <HStack>
                  <Code>{card.displayId ?? '—'}</Code>
                </HStack>
                <Heading level={2}>{card.title}</Heading>
              </VStack>
            </StackItem>
            {onExpand && (
              <IconButton
                size="sm"
                variant="ghost"
                label="Abrir tarefa"
                icon={<Icon icon={ExpandIcon} />}
                onClick={onExpand}
              />
            )}
            <IconButton
              size="sm"
              variant="ghost"
              label="Fechar"
              icon={<Icon icon={CloseIcon} />}
              onClick={onClose}
            />
          </HStack>
          {waitingBanner}
          {tokens}
          {controls}
          {work}
          {historySection}
        </VStack>
      </ScrollableArea>
    </VStack>
  )
}
