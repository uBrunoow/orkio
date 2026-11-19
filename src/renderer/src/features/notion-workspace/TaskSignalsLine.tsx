import { Button } from '@astryxdesign/core/Button'
import { Code } from '@astryxdesign/core/Code'
import { HStack } from '@astryxdesign/core/HStack'
import { Icon } from '@astryxdesign/core/Icon'
import { Text } from '@astryxdesign/core/Text'
import { Token } from '@astryxdesign/core/Token'
import type { TaskSignals } from '../../../../shared/ipc-contract'
import type { ChecksState, PullRequestState, ReviewDecision } from '../../../../shared/task-signals'
import { GitBranchIcon, PullRequestIcon } from '../../components/icons'

type Color = 'default' | 'gray' | 'green' | 'yellow' | 'red' | 'purple'

const PR_STATE: Record<PullRequestState, { label: string; color: Color }> = {
  draft: { label: 'Rascunho', color: 'gray' },
  open: { label: 'Aberta', color: 'green' },
  merged: { label: 'Mergeada', color: 'purple' },
  closed: { label: 'Fechada', color: 'red' }
}

const REVIEW: Record<ReviewDecision, { label: string; color: Color }> = {
  approved: { label: 'Aprovada', color: 'green' },
  changes_requested: { label: 'Alterações pedidas', color: 'red' },
  review_required: { label: 'Revisão pendente', color: 'yellow' }
}

const CHECKS: Record<ChecksState, { label: string; color: Color }> = {
  success: { label: 'CI ok', color: 'green' },
  failure: { label: 'CI falhou', color: 'red' },
  pending: { label: 'CI rodando', color: 'gray' }
}

/** Branch (local/remota) e PR de uma tarefa. Nada é renderizado sem sinais. */
export function TaskSignalsLine({
  signals
}: {
  signals: TaskSignals | undefined
}): React.JSX.Element | null {
  if (!signals) return null
  const branches = [...new Set([...signals.localBranches, ...signals.remoteBranches])]
  const pr = signals.pr
  if (branches.length === 0 && !pr) return null

  return (
    <HStack gap={2} vAlign="center" wrap="wrap" data-testid="task-signals">
      {branches.length > 0 && (
        <HStack gap={1} vAlign="center" data-testid="task-branch">
          <Icon icon={GitBranchIcon} size="sm" color="secondary" />
          <Code>{branches[0]}</Code>
          {branches.length > 1 && <Text type="supporting">+{branches.length - 1}</Text>}
          <Text type="supporting" data-testid="task-branch-where">
            {whereLabel(signals, branches[0]!)}
          </Text>
        </HStack>
      )}
      {pr && (
        <HStack gap={1} vAlign="center" wrap="wrap" data-testid="task-pr">
          <Button
            size="sm"
            variant="ghost"
            icon={<Icon icon={PullRequestIcon} />}
            label={`#${pr.number}`}
            aria-label={`Abrir a PR #${pr.number} no GitHub`}
            onClick={() => void window.orkio.openExternal(pr.url)}
          />
          <Token
            size="sm"
            label={PR_STATE[pr.state].label}
            color={PR_STATE[pr.state].color}
            data-testid="pr-state"
          />
          {pr.reviewDecision && pr.state !== 'merged' && pr.state !== 'closed' && (
            <Token
              size="sm"
              label={REVIEW[pr.reviewDecision].label}
              color={REVIEW[pr.reviewDecision].color}
              data-testid="pr-review"
            />
          )}
          {pr.unresolvedComments !== null && pr.unresolvedComments > 0 && (
            <Token
              size="sm"
              label={`${pr.unresolvedComments} ${pr.unresolvedComments === 1 ? 'comentário' : 'comentários'}`}
              color="yellow"
              data-testid="pr-comments"
            />
          )}
          {pr.checks && pr.state !== 'merged' && pr.state !== 'closed' && (
            <Token size="sm" label={CHECKS[pr.checks].label} color={CHECKS[pr.checks].color} />
          )}
          {signals.otherPrs > 0 && (
            <Text type="supporting">
              +{signals.otherPrs} {signals.otherPrs === 1 ? 'PR' : 'PRs'}
            </Text>
          )}
        </HStack>
      )}
    </HStack>
  )
}

function whereLabel(signals: TaskSignals, branch: string): string {
  const local = signals.localBranches.includes(branch)
  const remote = signals.remoteBranches.includes(branch)
  return local && remote ? 'local e remota' : local ? 'local' : 'remota'
}
