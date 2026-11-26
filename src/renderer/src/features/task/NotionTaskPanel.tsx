import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert } from '../../components/Alert'
import { MarkdownText } from '../../components/MarkdownText'
import { StatusToken } from '../../components/StatusToken'
import { ExternalLinkIcon, RefreshIcon } from '../../components/icons'
import { ipcResult, unwrap, useIpcResource } from '../../lib/ipc'

/**
 * Aba "Notion" do painel da tarefa: o que a tarefa é, como está no Notion (título, status,
 * prioridade, responsáveis e a descrição da página). Só leitura; lida ao abrir a aba e em
 * "Atualizar".
 */
export function NotionTaskPanel({
  projectId,
  taskId
}: {
  projectId: string
  taskId: string
}): React.JSX.Element {
  const page = useIpcResource(`${projectId}\n${taskId}`, async (k) => {
    const [p, t] = k.split('\n') as [string, string]
    return unwrap(await ipcResult(() => window.orkio.claude.taskPage(p, t)))
  })
  const value = page.value
  if (!value) {
    return page.error ? (
      <Alert tone="danger">{page.error.message}</Alert>
    ) : (
      <Skeleton className="h-24" aria-label="Carregando a tarefa do Notion" />
    )
  }
  const { task, markdown, unsupported, warning } = value
  const fields = [
    { name: 'Status', value: task.status?.name ?? null },
    { name: 'Prioridade', value: task.priority?.name ?? null },
    { name: 'Responsáveis', value: task.assignees.length ? task.assignees.join(', ') : null }
  ].filter((f): f is { name: string; value: string } => f.value !== null)

  return (
    <section aria-label="Tarefa no Notion" className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        {task.displayId && (
          <span className="font-mono text-2xs text-subtle-foreground">{task.displayId}</span>
        )}
        <p className="text-[15px] font-medium leading-snug">{task.title}</p>
        <div className="flex flex-wrap items-center gap-1">
          {task.url && (
            <Button
              variant="ghost"
              size="sm"
              className="-ml-2"
              onClick={() => void window.orkio.openExternal(task.url!)}
            >
              <ExternalLinkIcon className="size-3.5" />
              Abrir no Notion
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            disabled={page.loading}
            onClick={() => void page.reload()}
          >
            <RefreshIcon className="size-3.5" />
            {page.loading ? 'Atualizando…' : 'Atualizar'}
          </Button>
        </div>
      </div>

      {fields.length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
          {fields.map((f) => (
            <div key={f.name} className="contents">
              <dt className="text-muted-foreground">{f.name}</dt>
              <dd className="min-w-0">
                {f.name === 'Status' ? <StatusToken tone="neutral" label={f.value} /> : f.value}
              </dd>
            </div>
          ))}
        </dl>
      )}

      <div className="flex flex-col gap-2 border-t border-border-soft pt-4">
        <h3 className="text-xs font-medium text-muted-foreground">Descrição</h3>
        {warning ? (
          <Alert tone="warning">{warning}</Alert>
        ) : markdown.trim() ? (
          <MarkdownText text={markdown} />
        ) : (
          <p className="text-xs text-muted-foreground">A página da tarefa está vazia no Notion.</p>
        )}
        {unsupported.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Alguns blocos do Notion não aparecem aqui ({unsupported.join(', ')}). Abra no Notion
            para ver a página inteira.
          </p>
        )}
      </div>
    </section>
  )
}
