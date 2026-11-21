import { useEffect, useState } from 'react'
import { Button } from '@astryxdesign/core/Button'
import { Card } from '@astryxdesign/core/Card'
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
import { EVENT_LABELS, type EventKind } from '../../../../shared/automation'
import { Alert } from '../../components/Alert'
import { CloseIcon, ExpandIcon, ExternalLinkIcon } from '../../components/icons'
import { TaskClaudeSection } from '../claude/TaskClaudeSection'
import { TaskFlowSection } from '../task-flows/TaskFlowSection'
import { TaskSignalsLine } from '../notion-workspace/TaskSignalsLine'

/**
 * Tarefa: dados, ações, branch/PR, fluxo, Claude Code e histórico (task_events).
 * `panel` = prévia ao lado do Quadro (rolagem própria, "Abrir tarefa"); `page` = tela cheia em
 * duas colunas (trabalho à esquerda, dados e histórico à direita).
 */
export function TaskPanel({
  projectId,
  card,
  stages,
  signals,
  onMove,
  onToggleBlocked,
  onToggleAutomation,
  onClose,
  onExpand,
  variant = 'panel'
}: {
  projectId: string
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
}): React.JSX.Element {
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
        {card.priority && <Token size="sm" label={card.priority.name} />}
        {card.sync.state === 'pending' && <Token size="sm" color="yellow" label="Sincronizando" />}
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
      <TaskFlowSection
        projectId={projectId}
        taskId={card.taskId}
        stageId={card.stageId}
        pr={signals?.pr ?? null}
      />
      <TaskClaudeSection
        projectId={projectId}
        taskId={card.taskId}
        stageName={card.stageId ? stageName(card.stageId) : null}
        onWaitingChange={setWaiting}
      />
    </>
  )

  const historySection = (
    <VStack gap={2}>
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
    <Card role="complementary" aria-label={`Detalhes de ${label}`} padding={0} height="100%">
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
    </Card>
  )
}

/** Link da branch (entrega sem PR conhecida): github.com/<owner>/<repo>/tree/<branch>. */
function branchUrl(e: BoardHistoryEntry): string | null {
  if (e.kind !== 'delivery') return null
  const { owner, repo, branch } = (e.detail ?? {}) as Record<string, unknown>
  return typeof owner === 'string' && typeof repo === 'string' && typeof branch === 'string'
    ? `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/tree/${branch
        .split('/')
        .map(encodeURIComponent)
        .join('/')}`
    : null
}

function prNumber(e: BoardHistoryEntry): number | null {
  const pr = e.detail?.['pr'] as { number?: unknown } | undefined
  return typeof pr?.number === 'number' ? pr.number : null
}

/** Link da PR montado a partir de owner/repo/número (o banco não guarda URLs nem títulos). */
function prUrl(e: BoardHistoryEntry): string | null {
  const pr = e.detail?.['pr'] as { number?: unknown; owner?: unknown; repo?: unknown } | undefined
  return typeof pr?.number === 'number' &&
    typeof pr.owner === 'string' &&
    typeof pr.repo === 'string'
    ? `https://github.com/${encodeURIComponent(pr.owner)}/${encodeURIComponent(pr.repo)}/pull/${pr.number}`
    : null
}

/** "PR #45 mergeada" / "Branch criada (ORK-1/x)". */
function automationEvent(e: BoardHistoryEntry): string {
  const kind = e.detail?.['event']
  const label =
    typeof kind === 'string' && kind in EVENT_LABELS ? EVENT_LABELS[kind as EventKind] : 'Evento'
  const n = prNumber(e)
  const branch = e.detail?.['branch'] as { name?: unknown } | undefined
  return n !== null
    ? `${label} (PR #${n})`
    : typeof branch?.name === 'string'
      ? `${label} (${branch.name})`
      : label
}

function describe(e: BoardHistoryEntry, stageName: (id: string | null) => string): string {
  const rule = typeof e.detail?.['ruleName'] === 'string' ? `“${e.detail['ruleName']}”` : null
  if (e.kind === 'moved' && e.source === 'automation') {
    return `${automationEvent(e)} → regra ${rule ?? ''}: ${stageName(e.fromStage)} → ${stageName(e.toStage)}`
  }
  if (e.kind === 'automation') {
    const outcome = e.detail?.['outcome']
    if (outcome === 'skipped') {
      return `${automationEvent(e)}: regra ${rule ?? ''} ignorada (${String(e.detail?.['reason'] ?? '')})`
    }
    if (outcome === 'noop') return `${automationEvent(e)}: já estava em ${stageName(e.fromStage)}`
    if (outcome === 'notify') return `${automationEvent(e)}: notificação (regra ${rule ?? ''})`
    return automationEvent(e)
  }
  switch (e.kind) {
    case 'automation_paused':
      return 'Automações pausadas nesta tarefa'
    case 'automation_resumed':
      return 'Automações retomadas nesta tarefa'
    case 'added':
      return `Entrou no quadro em ${stageName(e.toStage)}`
    case 'moved':
      return `Movida de ${stageName(e.fromStage)} para ${stageName(e.toStage)}`
    case 'reconciled': {
      const status =
        typeof e.detail?.['status'] === 'string' ? ` (status “${e.detail['status']}”)` : ''
      return `Reposicionada pelo Notion: ${stageName(e.fromStage)} → ${stageName(e.toStage)}${status}`
    }
    case 'blocked':
      return e.source === 'notion' ? 'Marcada como bloqueada no Notion' : 'Marcada como bloqueada'
    case 'unblocked':
      return e.source === 'notion' ? 'Desbloqueada no Notion' : 'Desbloqueada'
    case 'sync_ok':
      return 'Sincronizada com o Notion'
    case 'run_started':
      return 'Claude Code iniciou uma execução'
    case 'run_finished':
      return `Claude Code terminou (${files(Number(e.detail?.['files'] ?? 0))})`
    case 'run_cancelled':
      return 'Execução do Claude Code cancelada'
    case 'run_failed':
      return 'Execução do Claude Code falhou'
    case 'flow_started':
      return `Fluxo iniciado: ${String(e.detail?.['flow'] ?? '')}`
    case 'step_started':
      return `Passo do fluxo começou (${String(e.detail?.['step'] ?? '')})`
    case 'step_finished':
      return `Passo do fluxo concluído (${String(e.detail?.['step'] ?? '')})`
    case 'step_failed':
      return `Passo do fluxo falhou (${String(e.detail?.['step'] ?? '')})`
    case 'step_skipped':
      return `Passo do fluxo pulado (${String(e.detail?.['step'] ?? '')})`
    case 'gate_waiting':
      return `Fluxo esperando aprovação (${String(e.detail?.['step'] ?? '')})`
    case 'gate_approved':
      return `Aprovação concedida (${String(e.detail?.['step'] ?? '')})`
    case 'gate_rejected':
      return `Aprovação recusada (${String(e.detail?.['step'] ?? '')})`
    case 'flow_paused':
      return `Fluxo pausado (${String(e.detail?.['reason'] ?? '')})`
    case 'flow_finished':
      return e.detail?.['result'] === 'cancelled'
        ? 'Fluxo cancelado'
        : e.detail?.['result'] === 'rejected'
          ? 'Fluxo encerrado (recusado)'
          : 'Fluxo concluído'
    case 'artifact_attached':
      return `Artefato anexado: ${String(e.detail?.['path'] ?? '')}`
    case 'artifact_published':
      return `Artefato publicado no Notion: ${String(e.detail?.['path'] ?? '')}`
    case 'delivery': {
      const by = e.detail?.['by'] === 'claude' ? 'Claude Code (modo entrega)' : 'Orkio'
      const branch = typeof e.detail?.['branch'] === 'string' ? e.detail['branch'] : ''
      const n = prNumber(e)
      const pr = n !== null ? ` na PR #${n}` : ''
      switch (e.detail?.['action']) {
        case 'push':
          return `Push de ${branch} pelo ${by}`
        case 'pr_create':
          return `PR aberta pelo ${by} (${branch})`
        case 'pr_edit':
          return `PR atualizada pelo ${by}${pr}`
        case 'pr_ready':
          return `PR marcada como pronta pelo ${by}${pr}`
        case 'pr_comment':
          return `Comentário${pr} pelo ${by}`
        case 'thread_reply':
          return `Resposta a comentário de review${pr} pelo ${by}`
        case 'thread_resolve':
          return `Conversa de review resolvida${pr} pelo ${by}`
        case 'review_request':
          return `Review pedido${pr} pelo ${by}`
        default:
          return `Entrega pelo ${by}`
      }
    }
    case 'run_blocked':
      return `Claude Code bloqueado: ${String(e.detail?.['reason'] ?? 'ação não permitida')}`
    case 'rolled_back':
      return `O Notion recusou a mudança; voltou para ${stageName(e.toStage)}`
    default:
      return e.kind
  }
}

function files(n: number): string {
  return n === 1 ? '1 arquivo alterado' : `${n} arquivos alterados`
}
