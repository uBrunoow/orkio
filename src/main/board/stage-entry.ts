import type { StageChange } from './board.service'

export interface StageListener {
  onStageChanged(change: StageChange): void
}

/**
 * A entrada numa etapa, com a ordem fixa: o orquestrador dá o agente da etapa de trabalho (8B),
 * a regra da coluna atribui o agente (8A, na mesma transação) e só então o fluxo da coluna começa
 * (5A, que adia o trabalho e já encontra o agente). O `BoardService` chama depois de gravar o
 * evento, dentro da transação, para toda origem; o `FlowRunner` chama a mesma função quando um
 * fluxo que saiu da etapa termina.
 */
export function createEnterStage(listeners: {
  orchestrator: StageListener
  agents: StageListener
  flows: StageListener
}): (change: StageChange) => void {
  return (change) => {
    listeners.orchestrator.onStageChanged(change)
    listeners.agents.onStageChanged(change)
    listeners.flows.onStageChanged(change)
  }
}
