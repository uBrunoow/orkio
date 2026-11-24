import { Skeleton } from '@/components/ui/skeleton'
import { Alert } from '../../components/Alert'
import { MarkdownText } from '../../components/MarkdownText'
import { StatusToken } from '../../components/StatusToken'
import { plural } from '../../lib/format'
import { splitBacklogBody } from '../../../../shared/alva'
import { useTaskDocument } from '../task/task-view'

/**
 * Spec, critérios e plano da task do Backlog.md vinculada, para ler antes de aprovar (só leitura;
 * o texto vem do arquivo no ambiente da tarefa, com segredos ocultados). Um texto só por tarefa
 * (`useTaskDocument`), relido quando o fluxo ou o Claude mexem na tarefa.
 */
export function BacklogDocumentView({
  part = 'all'
}: {
  /** Só a spec ou só o plano (abas da tela da tarefa); `all` = o texto inteiro. */
  part?: 'all' | 'spec' | 'plan'
}): React.JSX.Element {
  const { value, error } = useTaskDocument()
  if (!value) {
    return error ? (
      <Alert tone="danger">{error.message}</Alert>
    ) : (
      <Skeleton className="h-20" aria-label="Carregando a task" />
    )
  }
  const state = value
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
