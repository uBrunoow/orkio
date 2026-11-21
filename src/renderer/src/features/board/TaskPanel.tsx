import { useEffect, useState } from 'react'
import { Card } from '@astryxdesign/core/Card'
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput'
import { Code } from '@astryxdesign/core/Code'
import { HStack } from '@astryxdesign/core/HStack'
import { Heading } from '@astryxdesign/core/Heading'
import { Icon } from '@astryxdesign/core/Icon'
import { IconButton } from '@astryxdesign/core/IconButton'
import { Item } from '@astryxdesign/core/Item'
import { List } from '@astryxdesign/core/List'
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
import { CloseIcon, ExternalLinkIcon } from '../../components/icons'
import { TaskClaudeSection } from '../claude/TaskClaudeSection'
import { TaskFlowSection } from '../task-flows/TaskFlowSection'
import { TaskSignalsLine } from '../notion-workspace/TaskSignalsLine'
import { tokenColor } from '../notion-workspace/notion-colors'

/** Painel lateral da tarefa: dados, ações, branch/PR e histórico (task_events). */
export function TaskPanel({
  projectId,
  card,
  stages,
  signals,
  onMove,
  onToggleBlocked,
  onToggleAutomation,
  onClose,
  focusSection
}: {
  projectId: string
  card: BoardCard
  stages: readonly BoardStage[]
  signals: TaskSignals | undefined
  onMove(stageId: string): void
  onToggleBlocked(blocked: boolean): void
  onToggleAutomation(paused: boolean): void
  onClose(): void
  /** Seção a mostrar ao abrir (Visão geral, 6D): Fluxo, Claude Code ou Histórico. */
  focusSection?: TaskSection | null
}): React.JSX.Element {
  // Vindo da Visão geral: rola até a seção certa quando o painel abre.
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
    runTick
  ])

  return (
    <Card role="complementary" aria-label={`Detalhes de ${card.displayId ?? card.title}`}>
      <VStack gap={4}>
        <HStack gap={2} vAlign="start">
          <StackItem size="fill">
            <VStack gap={1}>
              <Code>{card.displayId ?? '—'}</Code>
              <Heading level={2}>{card.title}</Heading>
            </VStack>
          </StackItem>
          <IconButton
            size="sm"
            variant="ghost"
            label="Fechar"
            icon={<Icon icon={CloseIcon} />}
            onClick={onClose}
          />
        </HStack>

        <HStack gap={2} wrap="wrap" vAlign="center">
          {card.status && (
            <Token
              size="sm"
              label={`Notion: ${card.status.name}`}
              color={tokenColor(card.status.color)}
            />
          )}
          {card.priority && (
            <Token size="sm" label={card.priority.name} color={tokenColor(card.priority.color)} />
          )}
          {card.sync.state === 'pending' && (
            <Token size="sm" color="yellow" label="Sincronizando" />
          )}
        </HStack>
        {card.sync.state === 'pending' && card.sync.message && (
          <Text type="supporting">{card.sync.message}</Text>
        )}
        {card.assignees.length > 0 && (
          <Text type="supporting">Responsável: {card.assignees.join(', ')}</Text>
        )}
        <TaskSignalsLine signals={signals} />

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
          <HStack gap={2} vAlign="center">
            <IconButton
              variant="ghost"
              size="sm"
              label="Abrir no Notion"
              icon={<Icon icon={ExternalLinkIcon} />}
              onClick={() => void window.orkio.openExternal(card.url!)}
            />
            <Text type="supporting">Abrir no Notion</Text>
          </HStack>
        )}

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
          />
        </VStack>

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
      </VStack>
    </Card>
  )
}
