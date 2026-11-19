import type { IpcMain } from 'electron'
import {
  IPC_CHANNELS,
  type BoardSaveInput,
  type NotionResult,
  type OrkioStageChoice
} from '../../shared/ipc-contract'
import type { BoardService } from '../board/board.service'
import { isNotionId } from './notion-workspace.ipc'
import { errorName } from './payload'
import { isId } from './projects.ipc'
import type { SenderGuard } from './trusted-sender'

const GENERIC: NotionResult<never> = {
  ok: false,
  error: { code: 'unexpected', message: 'Algo deu errado no quadro. Tente novamente.' }
}
const INVALID: NotionResult<never> = {
  ok: false,
  error: { code: 'invalid', message: 'Dados inválidos. Atualize a tela e tente de novo.' }
}

/** O renderer manda só ids (projeto, página do Notion, etapa) e a configuração das etapas. */
export function registerBoardIpc(
  ipc: Pick<IpcMain, 'handle'>,
  service: Pick<BoardService, 'get' | 'save' | 'move' | 'setBlocked' | 'history' | 'retryNow'>,
  isTrustedSender: SenderGuard,
  ready: Promise<void> = Promise.resolve()
): void {
  const ch = IPC_CHANNELS.board

  function guarded(channel: string, run: (...args: unknown[]) => Promise<unknown>): void {
    ipc.handle(channel, async (event, ...args: unknown[]) => {
      if (!isTrustedSender(event)) throw new Error('Origem de IPC não autorizada')
      try {
        await ready
        return await run(...args)
      } catch (error) {
        console.error(`[orkio] falha inesperada em ${channel}: ${errorName(error)}`)
        return GENERIC
      }
    })
  }

  guarded(ch.get, async (projectId, options) =>
    isId(projectId) ? service.get(projectId, { force: isForce(options) }) : INVALID
  )
  guarded(ch.save, async (projectId, input) =>
    isId(projectId) && isBoardSaveInput(input) ? service.save(projectId, input) : INVALID
  )
  guarded(ch.move, async (projectId, taskId, stageId) =>
    isId(projectId) && isNotionId(taskId) && isStageId(stageId)
      ? service.move(projectId, taskId, stageId)
      : INVALID
  )
  guarded(ch.setBlocked, async (projectId, taskId, blocked) =>
    isId(projectId) && isNotionId(taskId) && typeof blocked === 'boolean'
      ? service.setBlocked(projectId, taskId, blocked)
      : INVALID
  )
  guarded(ch.history, async (projectId, taskId) =>
    isId(projectId) && isNotionId(taskId) ? service.history(projectId, taskId) : INVALID
  )
  guarded(ch.retryNow, async () => {
    service.retryNow()
  })
}

function isForce(value: unknown): boolean {
  return (
    typeof value === 'object' && value !== null && (value as { force?: unknown }).force === true
  )
}

export function isStageId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value)
}

function isShortString(value: unknown, max = 200): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max
}

function isOrkioStageChoice(value: unknown): value is OrkioStageChoice {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  if (v['mode'] === 'none' || v['mode'] === 'create') return true
  return v['mode'] === 'existing' && isShortString(v['propertyId'])
}

export function isBoardSaveInput(value: unknown): value is BoardSaveInput {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  const stages = v['stages']
  if (!Array.isArray(stages) || stages.length === 0 || stages.length > 30) return false
  const stagesOk = stages.every((s) => {
    if (typeof s !== 'object' || s === null) return false
    const st = s as Record<string, unknown>
    return (
      (st['id'] === null || isStageId(st['id'])) &&
      typeof st['name'] === 'string' &&
      st['name'].length <= 60 &&
      isShortString(st['notionStatusId'])
    )
  })
  return (
    stagesOk &&
    isOrkioStageChoice(v['orkioStage']) &&
    typeof v['addMissingOptions'] === 'boolean' &&
    (v['blockedPropertyId'] === null || isShortString(v['blockedPropertyId']))
  )
}
