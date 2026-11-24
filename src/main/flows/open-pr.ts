/**
 * "Abrir PR" (entrega avulsa): reaproveita o caminho seguro da 5C. Com a task do Backlog.md
 * vinculada e o alva-flow pronto, roda o fluxo do app "push (Orkio, com o gate) → /alva-flow:pr
 * em modo entrega". Sem isso, só o push pelo Orkio e o link de comparação do GitHub para criar a
 * PR à mão. Nunca há push fora da branch da tarefa nem força: o gate e as regras são os de sempre.
 */
import { alvaOpenPrFlow, sendBranchFlow } from '../../shared/alva-templates'
import type { Flow, FlowRunView, OpenPrResult } from '../../shared/task-flow'

export interface OpenPrDeps {
  /** A task do Backlog.md está vinculada à tarefa? */
  linked(taskId: string): boolean
  /** O projeto está pronto para o alva-flow (pré-checagem)? Falha ao checar = não. */
  alvaReady(projectId: string): Promise<boolean>
  /** `https://github.com/<o>/<r>/compare/<base>...<branch>?expand=1` (lança sem repo/ambiente). */
  compareUrl(projectId: string, taskId: string): string
  /** A branch da tarefa já está no GitHub sem commits novos? */
  alreadyPushed(projectId: string, taskId: string): Promise<boolean>
  startBuiltin(projectId: string, taskId: string, flow: Flow): Promise<FlowRunView>
}

export async function openPr(
  deps: OpenPrDeps,
  projectId: string,
  taskId: string
): Promise<OpenPrResult> {
  const withAlva = deps.linked(taskId) && (await deps.alvaReady(projectId).catch(() => false))
  // O push só entra se há algo novo: com a branch já enviada, o passo falharia ("nada novo").
  const pushed = await deps.alreadyPushed(projectId, taskId).catch(() => false)
  if (withAlva) {
    await deps.startBuiltin(projectId, taskId, alvaOpenPrFlow({ push: !pushed }))
    return { started: true, mode: 'pr', compareUrl: null }
  }
  const compareUrl = deps.compareUrl(projectId, taskId)
  // Sem alva-flow e nada a enviar: não há fluxo, só o link para criar a PR.
  if (pushed) return { started: false, mode: 'push', compareUrl }
  await deps.startBuiltin(projectId, taskId, sendBranchFlow())
  return { started: true, mode: 'push', compareUrl }
}
