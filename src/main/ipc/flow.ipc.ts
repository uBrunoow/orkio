import type { IpcMain } from 'electron'
import type { AutomationRule } from '../../shared/automation'
import type { FlowDraft, FlowStageDraft, ConfigEvent, FlowFileResult } from '../../shared/flow'
import { IPC_CHANNELS } from '../../shared/ipc-contract'
import type { BoardService } from '../board/board.service'
import { parseRule } from '../config/orkio-config'
import { isStageId } from './board.ipc'
import { errorName } from './payload'
import { isId } from './projects.ipc'
import type { SenderGuard } from './trusted-sender'
import type { Result } from '../../shared/result'

const MAX_FILE_BYTES = 1024 * 1024

const GENERIC: Result<never> = {
  ok: false,
  error: { code: 'unexpected', message: 'Algo deu errado ao salvar o fluxo. Tente novamente.' }
}
const INVALID: Result<never> = {
  ok: false,
  error: { code: 'invalid', message: 'Fluxo em formato inválido. Atualize a tela e tente de novo.' }
}

export interface FlowFiles {
  /** Abre "Salvar como…" e grava; `null` = cancelado. */
  save(json: string): Promise<boolean | null>
  /** Abre o seletor e devolve o texto; `null` = cancelado. */
  open(maxBytes: number): Promise<string | null>
}

export function registerFlowIpc(
  ipc: Pick<IpcMain, 'handle'>,
  service: Pick<BoardService, 'saveFlow' | 'configEvents'>,
  files: FlowFiles,
  isTrustedSender: SenderGuard,
  ready: Promise<void> = Promise.resolve()
): void {
  const ch = IPC_CHANNELS.flow
  function guarded<T>(channel: string, fallback: T, run: (...args: unknown[]) => Promise<T>): void {
    ipc.handle(channel, async (event, ...args: unknown[]) => {
      if (!isTrustedSender(event)) throw new Error('Origem de IPC não autorizada')
      try {
        await ready
        return await run(...args)
      } catch (error) {
        console.error(`[orkio] falha inesperada em ${channel}: ${errorName(error)}`)
        return fallback
      }
    })
  }

  guarded(ch.save, GENERIC, async (projectId, draft) =>
    isId(projectId) && isFlowDraft(draft) ? service.saveFlow(projectId, draft) : INVALID
  )
  guarded<ConfigEvent[]>(ch.events, [], async (projectId) =>
    isId(projectId) ? service.configEvents(projectId) : []
  )
  guarded<FlowFileResult>(
    ch.exportFile,
    { ok: false, cancelled: false, message: 'Não foi possível exportar o fluxo.' },
    async (content) => {
      const json = JSON.stringify(content, null, 2)
      if (typeof content !== 'object' || content === null || json.length > MAX_FILE_BYTES) {
        return { ok: false, cancelled: false, message: 'Fluxo grande demais para exportar.' }
      }
      const saved = await files.save(json)
      return saved === null ? { ok: false, cancelled: true } : { ok: true, content: null }
    }
  )
  guarded<FlowFileResult>(
    ch.importFile,
    { ok: false, cancelled: false, message: 'Não foi possível ler o arquivo.' },
    async () => {
      const text = await files.open(MAX_FILE_BYTES)
      if (text === null) return { ok: false, cancelled: true }
      try {
        return { ok: true, content: JSON.parse(text) as unknown }
      } catch {
        return { ok: false, cancelled: false, message: 'O arquivo não é um JSON válido.' }
      }
    }
  )
}

function isStageDraft(value: unknown): value is FlowStageDraft {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    isStageId(v['id']) &&
    typeof v['name'] === 'string' &&
    v['name'].length <= 60 &&
    (v['notionStatusId'] === null ||
      (typeof v['notionStatusId'] === 'string' && v['notionStatusId'].length <= 200)) &&
    (v['color'] === undefined || typeof v['color'] === 'string')
  )
}

/** Valida a forma; as regras de negócio (validateFlow) rodam no serviço. */
export function isFlowDraft(value: unknown): value is FlowDraft {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  const stages = v['stages']
  const rules = v['rules']
  const removals = v['removals']
  if (!Array.isArray(stages) || stages.length > 30 || !stages.every(isStageDraft)) return false
  if (!Array.isArray(rules) || rules.length > 100) return false
  const parsed = rules.map(parseRule)
  if (parsed.some((r) => r === null)) return false
  // A forma normalizada substitui a recebida (campos extras são descartados).
  v['rules'] = parsed as AutomationRule[]
  if (typeof removals !== 'object' || removals === null || Array.isArray(removals)) return false
  const bindings = v['bindings']
  if (bindings !== undefined) {
    if (!Array.isArray(bindings) || bindings.length > 30) return false
    const ok = bindings.every(
      (b) =>
        typeof b === 'object' &&
        b !== null &&
        isStageId((b as Record<string, unknown>)['stageId']) &&
        typeof (b as Record<string, unknown>)['flowId'] === 'string' &&
        ((b as Record<string, unknown>)['flowId'] as string).length <= 100 &&
        typeof (b as Record<string, unknown>)['enabled'] === 'boolean' &&
        ['on_enter', 'manual'].includes((b as Record<string, unknown>)['mode'] as string)
    )
    if (!ok) return false
  }
  return Object.entries(removals).every(
    ([k, dest]) => isStageId(k) && (dest === null || isStageId(dest))
  )
}
