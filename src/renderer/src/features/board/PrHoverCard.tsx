import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import { StatusDot, type StatusTone } from '@/components/StatusToken'
import { Timestamp } from '@/components/Timestamp'
import { plural } from '@/lib/format'
import { CI_STATUS, isPrOpen, PR_STATE, REVIEW_DECISION, type StatusText } from '@/lib/status-text'
import type { TaskSignals } from '../../../../shared/task-signals'

type TaskPullRequest = NonNullable<TaskSignals['pr']>

/** "owner/repo" a partir da URL da PR (validada no main: github.com/<o>/<r>/pull/<n>). */
export function repoOfPrUrl(url: string): string | null {
  try {
    const [, owner, repo] = new URL(url).pathname.split('/')
    return owner && repo ? `${owner}/${repo}` : null
  } catch {
    return null
  }
}

/** Pílula de estado da PR: o que mais importa primeiro (encerrada > revisão > rascunho). */
function prBadge(pr: TaskPullRequest): StatusText {
  if (pr.state === 'merged' || pr.state === 'closed') return PR_STATE[pr.state]
  if (pr.reviewDecision === 'changes_requested' || pr.reviewDecision === 'approved')
    return REVIEW_DECISION[pr.reviewDecision]
  if (pr.state === 'draft') return PR_STATE.draft
  return REVIEW_DECISION.review_required
}

const PILL: Record<StatusTone, string> = {
  success: 'bg-ok-tint text-ok',
  warning: 'bg-warn-tint text-warn',
  danger: 'bg-danger-tint text-danger',
  running: 'bg-brand-tint text-brand',
  neutral: 'bg-muted text-muted-foreground'
}

/**
 * Cartão ao passar o mouse (ou focar) no chip da PR, como no Claude Desktop. Campo que o GitHub
 * não deu (GraphQL falhou, sem permissão) simplesmente não aparece.
 */
export function PrHoverCard({
  pr,
  children
}: {
  pr: TaskPullRequest
  children: React.ReactNode
}): React.JSX.Element {
  const repo = repoOfPrUrl(pr.url)
  const badge = prBadge(pr)
  const open = isPrOpen(pr)
  const ci = open && pr.checks ? CI_STATUS[pr.checks] : null
  const hasSize = pr.additions !== undefined && pr.deletions !== undefined
  const unresolved = open ? (pr.unresolvedComments ?? 0) : 0
  return (
    <HoverCard>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent data-testid="pr-hover-card" aria-label={`PR #${pr.number}`}>
        <div className="flex flex-col gap-2">
          <p className="line-clamp-2 text-sm leading-snug font-medium text-foreground">
            {pr.title || `PR #${pr.number}`}
          </p>
          <p className="font-mono text-xs text-subtle-foreground">
            {repo ? `${repo} ` : ''}#{pr.number}
          </p>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            {pr.author && (
              <span className="flex items-center gap-1.5">
                <Avatar className="size-4">
                  <AvatarFallback className="text-[9px]">
                    {pr.author.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span className="text-foreground">{pr.author}</span>
              </span>
            )}
            {pr.createdAt && <Timestamp value={pr.createdAt} />}
            {hasSize && (
              <span className="font-mono" data-testid="pr-hover-size">
                <span className="text-ok">+{pr.additions}</span>{' '}
                <span className="text-danger">−{pr.deletions}</span>
              </span>
            )}
            {pr.changedFiles !== undefined && (
              <span>{plural(pr.changedFiles, 'arquivo', 'arquivos')}</span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 pt-0.5">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs ${PILL[badge.tone]}`}
              data-testid="pr-hover-badge"
            >
              <StatusDot tone={badge.tone} />
              {badge.label}
            </span>
            {ci && (
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <StatusDot tone={ci.tone} />
                {ci.label}
              </span>
            )}
            {unresolved > 0 && (
              <span className="text-xs text-warn">
                {plural(unresolved, 'comentário sem resposta', 'comentários sem resposta')}
              </span>
            )}
          </div>
        </div>
      </HoverCardContent>
    </HoverCard>
  )
}
