/**
 * Fase 5: `slices_checkpoint`, o git como checkpoint das fatias ("Quebrar em passos"). Lê os
 * trailers `Spec-Slice:` dos commits da branch da tarefa (desde a base do worktree) e grava quais
 * fatias estão feitas, quais podem entrar agora (dependências do plano) e quantas faltam. Retomar
 * nunca refaz uma fatia que já está no git. Sem o total do plano, mantém o `restam` que o Claude
 * disse (fluxos antigos seguem iguais).
 */
import { ORKIO_ACTIONS } from '../../shared/orkio-actions'
import { nextSlices, sliceDeps, slicesDone, SLICE_TRAILER, SLICE_VARS } from '../../shared/slices'
import type { Git } from '../git/git'
import type { OrkioAction } from './flow-runner'

export function createSliceActions(deps: {
  worktree(taskId: string): { path: string; baseRef: string } | null
  git: Pick<Git, 'trailersSince'>
}): OrkioAction[] {
  return [
    {
      ...ORKIO_ACTIONS.slices_checkpoint,
      run: async ({ taskId, vars }) => {
        const wt = deps.worktree(taskId)
        if (!wt) {
          return {
            ok: false,
            code: 'no_worktree',
            message: 'A tarefa ainda não tem ambiente (worktree) para conferir as fatias.'
          }
        }
        const done = slicesDone(await deps.git.trailersSince(wt.path, wt.baseRef, SLICE_TRAILER))
        const total = Number(vars[SLICE_VARS.total])
        const doneText = done.length > 0 ? done.join(', ') : 'nenhuma'
        if (!Number.isInteger(total) || total <= 0) {
          return {
            ok: true,
            vars: { [SLICE_VARS.done]: doneText, [SLICE_VARS.next]: 'a próxima do plano' },
            message: `Fatias no git: ${doneText}.`
          }
        }
        const finished = done.filter((n) => n <= total)
        const left = total - finished.length
        const next = left > 0 ? nextSlices(total, finished, sliceDeps(vars)) : []
        return {
          ok: true,
          vars: {
            [SLICE_VARS.done]: doneText,
            [SLICE_VARS.next]: next.length > 0 ? next.join(', ') : 'nenhuma',
            [SLICE_VARS.left]: String(left)
          },
          message:
            left === 0
              ? `Todas as ${total} fatias estão no git.`
              : `Fatias no git: ${doneText} de ${total}. Próxima: ${next.join(' ou ')}.`
        }
      }
    }
  ]
}
