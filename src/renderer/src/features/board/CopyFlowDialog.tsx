import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import type { StatusOption } from '../../../../shared/board'
import { fromBoardStages, type FlowStageDraft } from '../../../../shared/flow'
import { copyFlowFrom, type FlowCopyResult } from '../../../../shared/flow-copy'
import type { Flow } from '../../../../shared/task-flow'
import { Alert } from '../../components/Alert'
import { RadioListField } from '../../components/form'
import { plural } from '../../lib/format'
import { ipcResult } from '../../lib/ipc'
import { useProjects } from '../projects/useProjects'

export type FlowCopyOk = Extract<FlowCopyResult, { ok: true }>

/**
 * "Copiar de outro projeto…": escolhe o projeto, mostra o que vem (colunas reaproveitadas,
 * automações, fluxos de tarefa, modos das colunas e os status que faltam) e entrega ao rascunho.
 */
export function CopyFlowDialog({
  open,
  onOpenChange,
  target,
  newId,
  onApply
}: {
  open: boolean
  onOpenChange(open: boolean): void
  target: {
    projectId: string
    stages: readonly FlowStageDraft[]
    options: readonly StatusOption[]
    flows: readonly Flow[]
  }
  newId(): string
  onApply(result: FlowCopyOk, sourceName: string): void
}): React.JSX.Element {
  const { projects } = useProjects()
  const others = (projects ?? []).filter((p) => p.id !== target.projectId && !p.archived)
  const [sourceId, setSourceId] = useState<string | null>(null)
  const [result, setResult] = useState<FlowCopyResult | null>(null)
  const [loading, setLoading] = useState(false)
  const sourceName = others.find((p) => p.id === sourceId)?.name ?? ''

  async function choose(id: string): Promise<void> {
    setSourceId(id)
    setResult(null)
    setLoading(true)
    const [board, flows, columns] = await Promise.all([
      ipcResult(() => window.orkio.board.get(id)),
      ipcResult(() => window.orkio.taskFlows.getProject(id)),
      ipcResult(() => window.orkio.taskSetup.columns(id))
    ])
    setLoading(false)
    if (!board.ok || !board.value.config) {
      setResult({
        ok: false,
        error: board.ok ? 'Este projeto ainda não tem quadro.' : board.error.message
      })
      return
    }
    const config = board.value.config
    setResult(
      copyFlowFrom({
        source: {
          draft: { stages: fromBoardStages(config.stages), rules: config.rules },
          options: board.value.statusOptions,
          bindings: flows.ok ? flows.value.bindings : [],
          flows: flows.ok ? flows.value.flows : [],
          setups: columns.ok
            ? columns.value.stages.map((s) => ({ stageId: s.id, setup: s.setup }))
            : []
        },
        target,
        newId
      })
    )
  }

  const ok = result?.ok ? result : null
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o)
        if (!o) {
          setSourceId(null)
          setResult(null)
        }
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogTitle>Copiar de outro projeto</DialogTitle>
        <DialogDescription>
          Traz colunas, automações, o fluxo de cada coluna e o “Como as colunas rodam” para o
          rascunho. Nada muda até você salvar o fluxo.
        </DialogDescription>
        {others.length === 0 ? (
          <p className="text-xs text-muted-foreground">Não há outro projeto para copiar.</p>
        ) : (
          <RadioListField
            label="Projeto de origem"
            value={sourceId ?? ''}
            onChange={(id) => void choose(id)}
            options={others.map((p) => ({ value: p.id, label: p.name }))}
          />
        )}
        {loading && <p className="text-xs text-muted-foreground">Lendo o fluxo de {sourceName}…</p>}
        {result && !result.ok && <Alert tone="danger">{result.error}</Alert>}
        {ok && (
          <div className="flex flex-col gap-2 text-[13px]" data-testid="copy-flow-summary">
            <ul className="flex list-disc flex-col gap-0.5 pl-5">
              <li>
                {plural(ok.draft.stages.length, 'coluna', 'colunas')} (
                {plural(ok.reused, 'reaproveitada', 'reaproveitadas')}: as tarefas ficam onde estão)
              </li>
              <li>{plural(ok.draft.rules.length, 'automação', 'automações')}</li>
              <li>
                {plural(ok.draft.bindings?.length ?? 0, 'coluna com fluxo', 'colunas com fluxo')}
                {ok.flowsToAdd.length > 0 &&
                  ` (${plural(ok.flowsToAdd.length, 'fluxo de tarefa novo', 'fluxos de tarefa novos')})`}
              </li>
              <li>{plural(ok.setups.length, 'coluna com modo', 'colunas com modo')}</li>
              {Object.keys(ok.draft.removals).length > 0 && (
                <li>
                  {plural(
                    Object.keys(ok.draft.removals).length,
                    'coluna deste projeto sai',
                    'colunas deste projeto saem'
                  )}{' '}
                  (você escolhe o destino das tarefas antes de salvar)
                </li>
              )}
            </ul>
            {ok.warnings.length > 0 && <Alert tone="warning">{ok.warnings.join(' ')}</Alert>}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            disabled={!ok}
            onClick={() => {
              if (ok) onApply(ok, sourceName)
              onOpenChange(false)
            }}
          >
            Copiar para o rascunho
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
