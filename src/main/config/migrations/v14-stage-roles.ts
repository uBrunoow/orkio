/**
 * v14 → v15: as etapas ganham papel (`role`), e daí em diante o app lê o papel, nunca o nome.
 * Preenchido uma única vez:
 * - `queue`: a coluna "A fazer" escolhida (`boards[id].queueStageId`, que sai); sem escolha, nenhum
 *   (a lista lateral continua usando a primeira coluna);
 * - os outros pelos nomes do template da época (sem acento/caixa), a primeira etapa de cada.
 * Dados congelados: nomes da v14, mesmo se o template mudar.
 */
import { isRecord, sameStageName } from './frozen'

const ROLE_BY_NAME: readonly { role: string; name: string }[] = [
  { role: 'plan', name: 'Planejando' },
  { role: 'work', name: 'Em andamento' },
  { role: 'review', name: 'Revisando' },
  { role: 'reviewed', name: 'Revisado' },
  { role: 'done', name: 'Finalizada' }
]

function withRoles(board: Record<string, unknown>): Record<string, unknown> {
  const rest = { ...board }
  const queueStageId = rest['queueStageId']
  delete rest['queueStageId']
  if (!Array.isArray(board['stages'])) return rest
  const taken = new Set<string>()
  const stages = board['stages'].map((raw: unknown) => {
    if (!isRecord(raw) || typeof raw['id'] !== 'string' || typeof raw['name'] !== 'string') {
      return raw
    }
    const { id, name } = raw
    const role =
      typeof queueStageId === 'string' && id === queueStageId && !taken.has('queue')
        ? 'queue'
        : ROLE_BY_NAME.find((r) => !taken.has(r.role) && sameStageName(name, r.name))?.role
    if (!role) return raw
    taken.add(role)
    return { ...raw, role }
  })
  return { ...rest, stages }
}

export function migrateV14(data: Record<string, unknown>): Record<string, unknown> {
  if (!isRecord(data['boards'])) return data
  const boards: Record<string, unknown> = {}
  for (const [projectId, board] of Object.entries(data['boards'])) {
    boards[projectId] = isRecord(board) ? withRoles(board) : board
  }
  return { ...data, boards }
}
