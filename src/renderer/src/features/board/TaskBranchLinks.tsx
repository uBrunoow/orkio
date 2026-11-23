import { useCallback, useEffect, useState } from 'react'
import { Button } from '@astryxdesign/core/Button'
import { Code } from '@astryxdesign/core/Code'
import { HStack } from '@astryxdesign/core/HStack'
import { Item } from '@astryxdesign/core/Item'
import { List } from '@astryxdesign/core/List'
import { Selector } from '@astryxdesign/core/Selector'
import { VStack } from '@astryxdesign/core/VStack'
import type { TaskBranchesView } from '../../../../shared/agent-run'
import { Alert } from '../../components/Alert'

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
  /** Vinculou/desvinculou: relê os sinais (branch, PR) da tarefa. */
  onChanged?: () => void
}): React.JSX.Element {
  const [view, setView] = useState<TaskBranchesView | null>(null)
  const [choice, setChoice] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void window.orkio.claude.branches(projectId, taskId).then((r) => {
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
    <VStack gap={2} role="group" aria-label="Branches da tarefa" data-testid="task-branches">
      {view.linked.length > 0 && (
        <List density="compact" aria-label="Branches ligadas à tarefa">
          {view.linked.map((l) => (
            <Item
              as="li"
              key={l.branch}
              label={<Code>{l.branch}</Code>}
              description={SOURCE_LABEL[l.source]}
              endContent={
                <Button
                  size="sm"
                  variant="ghost"
                  label="Desvincular"
                  aria-label={`Desvincular ${l.branch}`}
                  isDisabled={busy}
                  onClick={() =>
                    void apply(() => window.orkio.claude.unlinkBranch(projectId, taskId, l.branch))
                  }
                />
              }
            />
          ))}
        </List>
      )}
      <HStack gap={2} vAlign="end" wrap="wrap">
        <Selector
          label="Vincular branch"
          description="Uma branch criada fora do Orkio: o Orkio passa a ver ela e a PR dela nesta tarefa."
          size="sm"
          hasSearch
          searchPlaceholder="Buscar branch"
          emptyText="Nenhuma branch para vincular."
          emptySearchText="Nenhuma branch com esse nome."
          placeholder="Escolha uma branch"
          options={view.available.map((b) => ({ value: b, label: b }))}
          {...(choice ? { value: choice } : {})}
          onChange={(v: string) => setChoice(v)}
        />
        <Button
          size="sm"
          variant="secondary"
          label="Vincular"
          isLoading={busy}
          isDisabled={!choice}
          onClick={() =>
            void apply(() => window.orkio.claude.linkBranch(projectId, taskId, choice))
          }
        />
      </HStack>
      {error && <Alert tone="danger">{error}</Alert>}
    </VStack>
  )
}
