import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible'
import { Skeleton } from '@/components/ui/skeleton'
import {
  reviewHeadline,
  reviewsWithText,
  type ReviewSummary,
  type ReviewThread,
  type ReviewThreadsResult
} from '../../../../shared/review'
import { Alert } from '../../components/Alert'
import { ExternalLinkIcon } from '../../components/icons'
import { MarkdownText } from '../../components/MarkdownText'
import { formatDateTime, plural } from '../../lib/format'
import { StatusToken, type StatusTone } from '../../components/StatusToken'
import { CollapsibleHeader } from '../../components/CollapsibleHeader'
import { useTaskView } from './task-view'
import { ipcResult } from '../../lib/ipc'

type State =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; data: ReviewThreadsResult }

/** Texto de onde o comentário está: `arquivo:linha` ou "geral". */
function threadWhere(t: Pick<ReviewThread, 'path' | 'line'>): string {
  return t.path ? `${t.path}${t.line ? `:${t.line}` : ''}` : 'geral'
}

const REVIEW_STATE: Record<string, { label: string; tone: StatusTone }> = {
  CHANGES_REQUESTED: { label: 'Pediu alterações', tone: 'warning' },
  COMMENTED: { label: 'Comentou', tone: 'neutral' }
}

/** Revisão de topo (o resumo, sem comentário em linha): quem, o que pediu e o texto. */
function ReviewCard({
  review,
  defaultOpen
}: {
  review: ReviewSummary
  defaultOpen: boolean
}): React.JSX.Element {
  const [open, setOpen] = useState(defaultOpen)
  const state = REVIEW_STATE[review.state] ?? REVIEW_STATE['COMMENTED']!
  return (
    <li className="flex min-w-0 flex-col rounded-xl border border-border p-3">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleHeader open={open} className="gap-2 text-xs">
          <span className="font-medium text-foreground">{review.author ?? 'alguém'}</span>
          <StatusToken tone={state.tone} label={state.label} />
          {review.at && (
            <span className="ml-auto shrink-0 text-2xs text-subtle-foreground">
              {formatDateTime(review.at)}
            </span>
          )}
        </CollapsibleHeader>
        <CollapsibleContent>
          <div className="mt-2 text-[13px]">
            <MarkdownText text={review.body} />
          </div>
        </CollapsibleContent>
      </Collapsible>
    </li>
  )
}

function ThreadCard({ thread }: { thread: ReviewThread }): React.JSX.Element {
  const link = thread.comments.find((c) => c.url)?.url ?? null
  return (
    <li className="flex min-w-0 flex-col gap-2 rounded-xl border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">
          {threadWhere(thread)}
        </span>
        {thread.outdated && (
          <span className="shrink-0 text-2xs text-subtle-foreground">desatualizado</span>
        )}
      </div>
      {thread.comments.map((c, i) => (
        <div key={i} className="flex flex-col gap-0.5 text-[13px]">
          <span className="text-xs font-medium">{c.author ?? 'alguém'}</span>
          <MarkdownText text={c.body} />
        </div>
      ))}
      {link && (
        <div>
          <Button size="xs" variant="ghost" onClick={() => void window.orkio.openExternal(link)}>
            <ExternalLinkIcon />
            Abrir no GitHub
          </Button>
        </div>
      )}
    </li>
  )
}

/**
 * Aba "Revisão": comentários não resolvidos da PR da tarefa (texto lido pelo main, só em
 * memória), depois os resolvidos recolhidos. `active` evita ler enquanto a aba está escondida.
 */
export function ReviewPanel({ active }: { active: boolean }): React.JSX.Element | null {
  const { projectId, taskId, version } = useTaskView()
  const [state, setState] = useState<State>({ phase: 'loading' })
  const [showResolved, setShowResolved] = useState(false)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    if (!active) return
    let live = true
    void ipcResult(() =>
      window.orkio.signals.reviewThreads(projectId, taskId, { force: nonce > 0 })
    ).then((r) => {
      if (!live) return
      setState(
        r.ok ? { phase: 'ready', data: r.value } : { phase: 'error', message: r.error.message }
      )
    })
    return () => {
      live = false
    }
  }, [projectId, taskId, active, version, nonce])

  if (state.phase === 'loading') {
    return <Skeleton className="h-20" aria-label="Carregando os comentários da PR" />
  }
  if (state.phase === 'error') return <Alert tone="danger">{state.message}</Alert>
  const { data } = state
  const open = data.threads.filter((t) => !t.resolved)
  const resolved = data.threads.filter((t) => t.resolved)
  return (
    <section aria-label="Revisão da PR" className="flex min-w-0 flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[13px]">{reviewHeadline(data, data.pr.number)}</p>
        <Button size="xs" variant="ghost" onClick={() => setNonce((n) => n + 1)}>
          Atualizar
        </Button>
      </div>
      {data.unreadThreads > 0 && (
        <Alert tone="warning">
          {plural(data.unreadThreads, 'thread não foi lida', 'threads não foram lidas')} (a PR tem
          muitas). Abra no GitHub para ver todas.
        </Alert>
      )}
      {data.truncated && <Alert tone="warning">Alguns textos longos foram cortados.</Alert>}
      {reviewsWithText(data.reviews).length > 0 && (
        <ul aria-label="Revisões" className="flex flex-col gap-2.5">
          {reviewsWithText(data.reviews).map((r, i) => (
            <ReviewCard key={`${r.author}-${r.at}-${i}`} review={r} defaultOpen={i === 0} />
          ))}
        </ul>
      )}
      {open.length > 0 && (
        <ul aria-label="Comentários não resolvidos" className="flex flex-col gap-2.5">
          {open.map((t) => (
            <ThreadCard key={t.id} thread={t} />
          ))}
        </ul>
      )}
      {resolved.length > 0 && (
        <Collapsible open={showResolved} onOpenChange={setShowResolved}>
          <CollapsibleHeader open={showResolved} className="text-xs text-muted-foreground">
            {plural(resolved.length, 'resolvido', 'resolvidos')}
          </CollapsibleHeader>
          <CollapsibleContent>
            <ul aria-label="Comentários resolvidos" className="mt-2 flex flex-col gap-2.5">
              {resolved.map((t) => (
                <ThreadCard key={t.id} thread={t} />
              ))}
            </ul>
          </CollapsibleContent>
        </Collapsible>
      )}
      <div>
        <Button
          size="xs"
          variant="ghost"
          onClick={() => void window.orkio.openExternal(data.pr.url)}
        >
          <ExternalLinkIcon />
          Abrir a PR #{data.pr.number} no GitHub
        </Button>
      </div>
    </section>
  )
}
