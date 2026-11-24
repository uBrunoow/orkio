import { PrHoverCard } from '../../components/PrHoverCard'
import { Button } from '@/components/ui/button'
import type { TaskSignals } from '../../../../shared/task-signals'
import { StatusToken } from '../../components/StatusToken'
import { CI_STATUS, isPrOpen, PR_STATE, REVIEW_DECISION } from '../../lib/status-text'
import { GitBranchIcon, PullRequestIcon } from '../../components/icons'

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
          <StatusToken {...PR_STATE[pr.state]} data-testid="pr-state" />
          {pr.reviewDecision && isPrOpen(pr) && (
            <StatusToken {...REVIEW_DECISION[pr.reviewDecision]} data-testid="pr-review" />
          )}
          {pr.unresolvedComments !== null && pr.unresolvedComments > 0 && (
            <StatusToken
              label={`${pr.unresolvedComments} ${pr.unresolvedComments === 1 ? 'comentário' : 'comentários'}`}
              tone="warning"
              data-testid="pr-comments"
            />
          )}
          {pr.checks && isPrOpen(pr) && <StatusToken {...CI_STATUS[pr.checks]} />}
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
