import type { BusyItem } from '../../shared/updates'

export interface BusyInput {
  runs: { projectId: string; taskId: string; queued: boolean }[]
  flows: { projectId: string; taskId: string; flowName: string; step: string | null }[]
  pendingWrites: number
  /** ID da tarefa para mostrar (ex.: ORK-142); vem do cache do Notion. */
  taskLabel(projectId: string, taskId: string): Promise<string | null>
}

export function busyCount(input: Omit<BusyInput, 'taskLabel'>): number {
  return input.runs.length + input.flows.length + input.pendingWrites
}

/** O que impede reiniciar agora, em frases curtas para o botão de atualizar. */
export async function describeBusy(input: BusyInput): Promise<BusyItem[]> {
  const label = async (projectId: string, taskId: string): Promise<string> =>
    (await input.taskLabel(projectId, taskId).catch(() => null)) ?? 'uma tarefa'
  const items: BusyItem[] = []
  const flowTasks = new Set(input.flows.map((f) => f.taskId))
  for (const f of input.flows) {
    const step = f.step ? `, passo “${f.step}”` : ''
    items.push({
      kind: 'flow',
      label: `Fluxo “${f.flowName}” em ${await label(f.projectId, f.taskId)}${step}`
    })
  }
  // A execução de um passo de fluxo já aparece no fluxo.
  for (const r of input.runs.filter((r) => !flowTasks.has(r.taskId))) {
    const what = r.queued ? 'Claude Code na fila' : 'Claude Code rodando'
    items.push({ kind: 'claude', label: `${what} em ${await label(r.projectId, r.taskId)}` })
  }
  if (input.pendingWrites > 0) {
    items.push({
      kind: 'notion',
      label:
        input.pendingWrites === 1
          ? '1 alteração esperando o Notion (continua depois de reiniciar)'
          : `${input.pendingWrites} alterações esperando o Notion (continuam depois de reiniciar)`
    })
  }
  return items
}
