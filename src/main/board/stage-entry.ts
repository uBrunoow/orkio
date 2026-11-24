import type { StageChange } from './board.service'

/**
 * Entrada real numa etapa (você ou a automação moveu a tarefa para `to`): é o que atribui agente,
 * dá o agente da raia e começa o fluxo da coluna. Reconciliação com o Notion, desfazer e remoção de
 * etapa nunca contam.
 */
export function isStageEntry(change: StageChange): change is StageChange & { to: string } {
  return (change.source === 'manual' || change.source === 'automation') && change.to !== null
}

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
