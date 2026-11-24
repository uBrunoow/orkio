import { useEffect, useState } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import type { BacklogTaskDocument } from '../../../../shared/alva'
import { Alert } from '../../components/Alert'
import { MarkdownText } from '../../components/MarkdownText'
import { StatusToken } from '../../components/StatusToken'
import { plural } from '../../lib/format'
import { splitBacklogBody } from '../task/backlog-sections'

type State =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; linked: string | null; doc: BacklogTaskDocument | null }

/**
 * Spec, critérios e plano da task do Backlog.md vinculada, para ler antes de aprovar (só leitura;
 * o texto vem do arquivo no ambiente da tarefa, com segredos ocultados). `refreshKey` recarrega
 * (o fluxo muda o arquivo a cada passo).
 */
export function BacklogDocumentView({
  projectId,
  taskId,
  refreshKey = 0,
  part = 'all'
}: {
  projectId: string
  taskId: string
  refreshKey?: number
  /** Só a spec ou só o plano (abas da tela da tarefa); `all` = o texto inteiro. */
  part?: 'all' | 'spec' | 'plan'
}): React.JSX.Element {
  const [state, setState] = useState<State>({ phase: 'loading' })

  useEffect(() => {
    let active = true
    void window.orkio.alva
      .taskDocument(projectId, taskId)
      .then((r) => {
        if (!active) return
        setState(
          r.ok ? { phase: 'ready', ...r.value } : { phase: 'error', message: r.error.message }
        )
      })
      .catch(() => {
        if (active) setState({ phase: 'error', message: 'Não deu para ler a task do Backlog.' })
      })
    return () => {
      active = false
    }
  }, [projectId, taskId, refreshKey])

  if (state.phase === 'loading') {
    return <Skeleton className="h-20" aria-label="Carregando a task" />
  }
  if (state.phase === 'error') return <Alert tone="danger">{state.message}</Alert>
  if (!state.doc) {
    return (
      <p className="text-xs text-muted-foreground">
        {state.linked
          ? `Não achei o arquivo da task ${state.linked} na pasta de trabalho desta tarefa.`
          : 'Esta tarefa ainda não tem task no Backlog. O /spec cria.'}
      </p>
    )
  }
  const { info, truncated } = state.doc
  const sections = splitBacklogBody(state.doc.body)
  const body = part === 'spec' ? sections.spec : part === 'plan' ? sections.plan : state.doc.body
  const regionLabel = part === 'spec' ? 'Spec' : part === 'plan' ? 'Plano' : 'Spec e plano'
  return (
    <section aria-label={regionLabel} className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <p className="text-[15px] font-medium">{info.title}</p>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-2xs text-subtle-foreground">
          <span>{info.id}</span>
          <span>·</span>
          <StatusToken tone="neutral" label={info.status} className="font-sans" />
          <span>·</span>
          <span>
            critérios {info.criteria.done}/{info.criteria.total}
          </span>
          {info.openQuestions > 0 && (
            <StatusToken
              tone="warning"
              label={plural(info.openQuestions, 'pergunta em aberto', 'perguntas em aberto')}
              className="font-sans"
            />
          )}
        </div>
        {state.doc.draft && (
          <p className="text-xs text-muted-foreground" data-testid="backlog-draft">
            Rascunho que o /spec está escrevendo nesta tarefa. Leia aqui antes de aprovar.
          </p>
        )}
      </div>
      {body ? (
        <MarkdownText text={body} />
      ) : (
        <p className="text-xs text-muted-foreground">
          {part === 'plan'
            ? 'O plano ainda não foi escrito. O /plan escreve.'
            : 'A task ainda não tem texto.'}
        </p>
      )}
      {truncated && (
        <p className="text-xs text-muted-foreground">
          O texto passou do limite e foi cortado. Abra o arquivo da task para ler o resto.
        </p>
      )}
    </section>
  )
}
