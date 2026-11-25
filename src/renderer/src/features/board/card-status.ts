import type { StatusTone } from '../../components/StatusToken'
import { TASK_LANE_STATUS } from '../../lib/status-text'
import type { BoardCard } from '../../../../shared/board'
import {
  PR_CHIP_TEXT,
  prChips,
  type PersonalTask,
  type TaskLane
} from '../../../../shared/task-lanes'
import type { TaskPullRequest } from '../../../../shared/task-signals'

export interface CardStatus {
  kind: 'sync'
  label: string
  tone: StatusTone
}

/** Badge da situação da tarefa (raia) com o quê vai junto; sem tarefa ou concluída, sem badge. */
export function laneBadge(
  t: PersonalTask | null
): { lane: TaskLane; label: string; tone: StatusTone; what: string } | null {
  const status = t ? TASK_LANE_STATUS[t.lane] : null
  if (!t || !status) return null
  return { lane: t.lane, ...status, what: t.what }
}

/** Só a sincronização com o Notion (o fluxo e a PR saem daqui). */
export function cardSyncStatus(card: Pick<BoardCard, 'sync'>): CardStatus | null {
  if (card.sync.state === 'failed')
    return { kind: 'sync', label: 'Não sincronizou', tone: 'danger' }
  if (card.sync.state === 'pending')
    return { kind: 'sync', label: 'Sincronizando', tone: 'neutral' }
  return null
}

/** Texto do botão da PR: `#n` e, com a PR aberta, os rótulos dela. */
export function prButtonText(pr: TaskPullRequest): string {
  if (pr.state !== 'open') return `#${pr.number}`
  return [`#${pr.number}`, ...prChips(pr).map((c) => PR_CHIP_TEXT[c].label)].join(' · ')
}
