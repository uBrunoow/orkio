import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { Field } from '@/components/form'
import type { TaskBranchesView } from '../../../../shared/agent-run'
import { Alert } from '../../components/Alert'
import { Spinner } from '../../components/Spinner'
import { ipcResult } from '../../lib/ipc'

const SOURCE_LABEL = { orkio: 'criada pelo Orkio', manual: 'vinculada por você' } as const

/**
 * Branches ligadas à tarefa (Detalhes > GitHub): a que o Orkio criou e as vinculadas à mão. É o que
 * liga branch e PR à tarefa quando o nome da branch não tem o ID do Notion (`feat/listar-pedidos`).
 * Vincular troca a tarefa da branch se ela já era de outra; desvincular não apaga a branch.
 */
export function TaskBranchLinks({
  projectId,
  taskId,
  onChanged
}: {
  projectId: string
  taskId: string
  onChanged?: () => void
}): React.JSX.Element {
  const [view, setView] = useState<TaskBranchesView | null>(null)
  const [choice, setChoice] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void ipcResult(() => window.orkio.claude.branches(projectId, taskId)).then((r) => {
      if (!active) return
      if (r.ok) setView(r.value)
      else setError(r.error.message)
    })
    return () => {
      active = false
    }
  }, [projectId, taskId])

  const apply = useCallback(
    async (fn: () => ReturnType<typeof window.orkio.claude.branches>): Promise<void> => {
      setBusy(true)
      const r = await fn()
      setBusy(false)
      if (r.ok) {
        setView(r.value)
        setChoice('')
        setError(null)
        onChanged?.()
      } else setError(r.error.message)
    },
    [onChanged]
  )

  if (!view) return <>{error && <Alert tone="danger">{error}</Alert>}</>

  return (
    <div
      className="flex flex-col gap-2"
      role="group"
      aria-label="Branches da tarefa"
      data-testid="task-branches"
    >
      {view.linked.length > 0 && (
        <ul aria-label="Branches ligadas à tarefa" className="rounded-lg border border-border-soft">
          {view.linked.map((l) => (
            <li
              key={l.branch}
              className="flex items-center gap-3 border-b border-border-soft px-3 py-2 last:border-b-0"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <code className="truncate font-mono text-xs text-foreground">{l.branch}</code>
                <span className="text-xs text-muted-foreground">{SOURCE_LABEL[l.source]}</span>
              </div>
              <Button
                size="xs"
                variant="ghost"
                aria-label={`Desvincular ${l.branch}`}
                disabled={busy}
                onClick={() =>
                  void apply(() => window.orkio.claude.unlinkBranch(projectId, taskId, l.branch))
                }
              >
                Desvincular
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Field
        label="Vincular branch"
        description="Uma branch criada fora do Orkio: o Orkio passa a ver ela e a PR dela nesta tarefa."
      >
        {({ id, describedBy }) => (
          <div className="flex items-center gap-2">
            <Select
              id={id}
              aria-label="Vincular branch"
              aria-describedby={describedBy}
              size="sm"
              hasSearch
              searchPlaceholder="Buscar branch"
              emptyText={
                view.available.length === 0
                  ? 'Nenhuma branch para vincular.'
                  : 'Nenhuma branch com esse nome.'
              }
              placeholder="Escolha uma branch"
              options={view.available.map((b) => ({ value: b, label: b }))}
              value={choice || null}
              onChange={(v) => setChoice(v)}
              className="min-w-0 flex-1 font-mono"
            />
            <Button
              size="sm"
              variant="secondary"
              disabled={busy || !choice}
              onClick={() =>
                void apply(() => window.orkio.claude.linkBranch(projectId, taskId, choice))
              }
            >
              {busy && <Spinner className="size-3.5" />}
              Vincular
            </Button>
          </div>
        )}
      </Field>
      {error && <Alert tone="danger">{error}</Alert>}
    </div>
  )
}
