import type { IpcMain } from 'electron'
import type { ClaudeResult } from '../../shared/agent-run'
import {
  ORCHESTRATOR_LIMITS,
  parseOrchestrator,
  type OrchestratorConfig,
  type OrchestratorState
} from '../../shared/orchestrator'
import { parseAgentKey } from '../../shared/agent'
import { IPC_CHANNELS } from '../../shared/ipc-contract'
import { OrchestratorError, type OrchestratorService } from '../orchestrator/orchestrator.service'
import { errorName } from './payload'
import { isId } from './projects.ipc'
import type { SenderGuard } from './trusted-sender'

const INVALID: ClaudeResult<never> = {
  ok: false,
  error: { code: 'invalid', message: 'Pedido inválido. Atualize a tela e tente de novo.' }
}
const GENERIC: ClaudeResult<never> = {
  ok: false,
  error: { code: 'unexpected', message: 'Algo deu errado com o orquestrador. Tente novamente.' }
}

/**
 * Config vinda do editor: só a forma, sem descartar nada em silêncio (a leitura tolerante da
 * config, `parseOrchestrator`, descartaria). As regras ficam no `validateOrchestrator` do serviço.
 * `enabledSince` é sempre do main.
 */
export function toOrchestratorConfig(value: unknown): OrchestratorConfig | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const v = value as Record<string, unknown>
  const lanes = v['lanes']
  if (
    typeof v['enabled'] !== 'boolean' ||
    !(v['queueStageId'] === null || isId(v['queueStageId'])) ||
    typeof v['maxActive'] !== 'number' ||
    !Array.isArray(lanes) ||
    lanes.length > ORCHESTRATOR_LIMITS.lanes
  ) {
    return null
  }
  for (const lane of lanes) {
    if (typeof lane !== 'object' || lane === null) return null
    const l = lane as Record<string, unknown>
    if (
      !isId(l['stageId']) ||
      !(l['next'] === null || isId(l['next'])) ||
      !Array.isArray(l['agents']) ||
      l['agents'].length > ORCHESTRATOR_LIMITS.agentsPerLane ||
      !l['agents'].every((k) => !!parseAgentKey(k)) ||
      new Set(l['agents']).size !== l['agents'].length
    ) {
      return null
    }
  }
  const parsed = parseOrchestrator({ ...v, enabledSince: null })
  // Etapa repetida seria descartada pela leitura tolerante: aqui é recusada.
  if (!parsed || parsed.lanes.length !== lanes.length) return null
  // `maxActive` fora da faixa seria ajustado em silêncio: deixa o validador explicar.
  return { ...parsed, maxActive: v['maxActive'] }
}

export function registerOrchestratorIpc(
  ipc: Pick<IpcMain, 'handle'>,
  service: OrchestratorService,
  isTrustedSender: SenderGuard,
  ready: Promise<void> = Promise.resolve()
): void {
  const ch = IPC_CHANNELS.agents
  function guarded(
    channel: string,
    run: (...args: unknown[]) => Promise<ClaudeResult<OrchestratorState>>
  ): void {
    ipc.handle(channel, async (event, ...args: unknown[]) => {
      if (!isTrustedSender(event)) throw new Error('Origem de IPC não autorizada')
      try {
        await ready
        return await run(...args)
      } catch (error) {
        if (error instanceof OrchestratorError) {
          return { ok: false, error: { code: error.code, message: error.message } }
        }
        console.error(`[orkio] falha inesperada em ${channel}: ${errorName(error)}`)
        return GENERIC
      }
    })
  }
  const ok = (value: OrchestratorState): ClaudeResult<OrchestratorState> => ({ ok: true, value })

  guarded(ch.orchestrator, async (projectId) =>
    isId(projectId) ? ok(await service.state(projectId)) : INVALID
  )
  guarded(ch.saveOrchestrator, async (projectId, raw) => {
    const config = toOrchestratorConfig(raw)
    if (!isId(projectId) || !config) return INVALID
    return ok(await service.save(projectId, config))
  })
  guarded(ch.runOrchestrator, async (projectId) => {
    if (!isId(projectId)) return INVALID
    await service.tick(projectId)
    return ok(await service.state(projectId))
  })
}
