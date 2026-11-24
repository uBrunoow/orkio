/**
 * v13 → v14: a coluna "A fazer" da lista lateral passa a ser do quadro (`boards[id].queueStageId`,
 * editada em Colunas). Antes ficava em `orchestrator[id].queueStageId`, que só a sugestão do
 * orquestrador preenchia. Saem do orquestrador `queueStageId` e `maxActive` (sem leitor desde que
 * ele parou de puxar da fila; `maxActive` ainda bloqueava salvar sem aparecer na tela).
 */
import { isRecord, rawStages } from './frozen'

export function migrateV13(data: Record<string, unknown>): Record<string, unknown> {
  const orchestrator = isRecord(data['orchestrator']) ? data['orchestrator'] : {}
  const rawBoards = isRecord(data['boards']) ? data['boards'] : {}
  const boards: Record<string, unknown> = { ...rawBoards }
  const nextOrchestrator: Record<string, unknown> = {}
  for (const [projectId, raw] of Object.entries(orchestrator)) {
    if (!isRecord(raw)) {
      nextOrchestrator[projectId] = raw
      continue
    }
    const rest = { ...raw }
    const queueStageId = rest['queueStageId']
    delete rest['queueStageId']
    delete rest['maxActive']
    nextOrchestrator[projectId] = rest
    const board = rawBoards[projectId]
    if (
      typeof queueStageId === 'string' &&
      isRecord(board) &&
      rawStages(board).some((s) => s.id === queueStageId)
    ) {
      boards[projectId] = { ...board, queueStageId }
    }
  }
  return {
    ...data,
    boards,
    ...(isRecord(data['orchestrator']) ? { orchestrator: nextOrchestrator } : {})
  }
}
