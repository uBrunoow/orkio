import { PrHoverCard } from '../board/PrHoverCard'
import { Button } from '@/components/ui/button'
import type { TaskSignals } from '../../../../shared/ipc-contract'
import type { ChecksState, PullRequestState, ReviewDecision } from '../../../../shared/task-signals'
import { StatusToken, toneOf } from '../../components/StatusToken'
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
    <div className="flex flex-wrap items-center gap-2" data-testid="task-signals">
      {branches.length > 0 && (
        <div className="flex min-w-0 items-center gap-1" data-testid="task-branch">
          <GitBranchIcon className="size-3.5 text-subtle-foreground" />
          <code className="truncate font-mono text-xs text-muted-foreground">{branches[0]}</code>
          {branches.length > 1 && (
            <span className="text-xs text-subtle-foreground">+{branches.length - 1}</span>
          )}
          <span className="text-xs text-subtle-foreground" data-testid="task-branch-where">
            {whereLabel(signals, branches[0]!)}
          </span>
        </div>
      )}
      {pr && (
        <div className="flex flex-wrap items-center gap-2" data-testid="task-pr">
          <PrHoverCard pr={pr}>
            <Button
              size="xs"
              variant="ghost"
              className="font-mono"
              aria-label={`Abrir a PR #${pr.number} no GitHub`}
              onClick={() => void window.orkio.openExternal(pr.url)}
            >
              <PullRequestIcon />#{pr.number}
            </Button>
          </PrHoverCard>
          <StatusToken
            label={PR_STATE[pr.state].label}
            tone={toneOf(PR_STATE[pr.state].color)}
            data-testid="pr-state"
          />
          {pr.reviewDecision && pr.state !== 'merged' && pr.state !== 'closed' && (
            <StatusToken
              label={REVIEW[pr.reviewDecision].label}
              tone={toneOf(REVIEW[pr.reviewDecision].color)}
              data-testid="pr-review"
            />
          )}
          {pr.unresolvedComments !== null && pr.unresolvedComments > 0 && (
            <StatusToken
              label={`${pr.unresolvedComments} ${pr.unresolvedComments === 1 ? 'comentário' : 'comentários'}`}
              tone="warning"
              data-testid="pr-comments"
            />
          )}
          {pr.checks && pr.state !== 'merged' && pr.state !== 'closed' && (
            <StatusToken label={CHECKS[pr.checks].label} tone={toneOf(CHECKS[pr.checks].color)} />
          )}
          {signals.otherPrs > 0 && (
            <span className="text-xs text-subtle-foreground">
              +{signals.otherPrs} {signals.otherPrs === 1 ? 'PR' : 'PRs'}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

function whereLabel(signals: TaskSignals, branch: string): string {
  const local = signals.localBranches.includes(branch)
  const remote = signals.remoteBranches.includes(branch)
  return local && remote ? 'local e remota' : local ? 'local' : 'remota'
}
