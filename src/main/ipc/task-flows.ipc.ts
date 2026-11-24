import type { IpcMain } from 'electron'
import type { ClaudeResult } from '../../shared/agent-run'
import { IPC_CHANNELS, type OpenPrResult } from '../../shared/ipc-contract'
import { MAX_PROMPT_CHARS, type Flow, type FlowRunView } from '../../shared/task-flow'
import { parseFlowDef } from '../config/orkio-config'
import { FlowError, type FlowRunner } from '../flows/flow-runner'
import type { FlowsService } from '../flows/flows.service'
import { DeliveryError } from '../delivery/delivery.service'
import { openPr, type OpenPrDeps } from '../flows/open-pr'
import { errorName } from './payload'
import { isId } from './projects.ipc'
import type { SenderGuard } from './trusted-sender'

const INVALID: ClaudeResult<never> = {
  ok: false,
  error: { code: 'invalid', message: 'Pedido inválido. Atualize a tela e tente de novo.' }
}
const GENERIC: ClaudeResult<never> = {
  ok: false,
  error: { code: 'unexpected', message: 'Algo deu errado no fluxo. Tente novamente.' }
}

/** Lista de fluxos vinda do editor: normalizada pelo mesmo parser da config. */
export function parseFlows(value: unknown): Flow[] | null {
  if (!Array.isArray(value) || value.length > 50) return null
  const flows = value.map(parseFlowDef)
  if (!flows.every((f): f is Flow => f !== null)) return null
  if (flows.some((f) => f.steps.length > 60 || f.id.length > 100)) return null
  return flows
}

export function registerTaskFlowsIpc(
  ipc: Pick<IpcMain, 'handle'>,
  service: FlowsService,
  runner: FlowRunner,
  isTrustedSender: SenderGuard,
  ready: Promise<void> = Promise.resolve(),
  openPrDeps: OpenPrDeps | null = null
): void {
  const ch = IPC_CHANNELS.taskFlows
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
  const act = (channel: string, fn: (id: string) => Promise<FlowRunView>): void =>
    guarded<ClaudeResult<FlowRunView>>(channel, GENERIC, async (id) =>
      isId(id) ? service.act(() => fn(id)) : INVALID
    )

  guarded(ch.getProject, GENERIC, async (projectId) =>
    isId(projectId) ? service.getProject(projectId) : INVALID
  )
  guarded(ch.saveFlows, GENERIC, async (projectId, flows) => {
    const parsed = parseFlows(flows)
    return isId(projectId) && parsed ? service.saveFlows(projectId, parsed) : INVALID
  })
  guarded<FlowRunView[]>(ch.runs, [], async (taskId) => (isId(taskId) ? service.runs(taskId) : []))
  guarded<Record<string, 'running' | 'needs_you'>>(ch.active, {}, async (projectId) =>
    isId(projectId) ? service.active(projectId) : {}
  )
  guarded(ch.start, GENERIC, async (projectId, taskId) =>
    isId(projectId) && isId(taskId)
      ? service.act(() => runner.startManual(projectId, taskId))
      : INVALID
  )
  guarded(ch.approve, GENERIC, async (id, values) => {
    if (!isId(id)) return INVALID
    if (values === undefined || values === null) {
      return service.act(() => runner.approveGate(id))
    }
    // Valores de uma escolha (ex.: revisores): logins ou `team:<slug>`, poucos e curtos.
    if (
      !Array.isArray(values) ||
      values.length > 20 ||
      !values.every(
        (v) => typeof v === 'string' && /^(team:)?[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(v)
      )
    ) {
      return INVALID
    }
    return service.act(() => runner.approveGate(id, values as string[]))
  })
  guarded(ch.setDelivery, GENERIC, async (projectId, settings) =>
    isId(projectId) &&
    typeof settings === 'object' &&
    settings !== null &&
    typeof (settings as Record<string, unknown>)['requirePushApproval'] === 'boolean'
      ? service.setDelivery(projectId, {
          requirePushApproval: (settings as { requirePushApproval: boolean }).requirePushApproval
        })
      : INVALID
  )
  guarded(ch.startById, GENERIC, async (projectId, taskId, flowId) =>
    isId(projectId) && isId(taskId) && isId(flowId)
      ? service.act(() => runner.startById(projectId, taskId, flowId))
      : INVALID
  )
  guarded<ClaudeResult<OpenPrResult>>(ch.openPr, GENERIC, async (projectId, taskId) => {
    if (!openPrDeps || !isId(projectId) || !isId(taskId)) return INVALID
    try {
      return { ok: true, value: await openPr(openPrDeps, projectId, taskId) }
    } catch (error) {
      if (error instanceof FlowError || error instanceof DeliveryError) {
        return { ok: false, error: { code: error.code, message: error.message } }
      }
      throw error
    }
  })
  act(ch.reject, (id) => runner.rejectGate(id))
  act(ch.resume, (id) => runner.resume(id))
  act(ch.skip, (id) => runner.skip(id))
  guarded(ch.rerunFrom, GENERIC, async (id, stepId) =>
    isId(id) && typeof stepId === 'string' && stepId.length > 0 && stepId.length <= 100
      ? service.act(() => runner.rerunFrom(id, stepId))
      : INVALID
  )
  guarded(ch.resumeWithReply, GENERIC, async (id, text) =>
    isId(id) && typeof text === 'string' && text.length <= 10_000
      ? service.act(() => runner.resumeWithReply(id, text))
      : INVALID
  )
  guarded(ch.reviseGate, GENERIC, async (projectId, taskId, text) =>
    isId(projectId) &&
    isId(taskId) &&
    typeof text === 'string' &&
    text.trim().length > 0 &&
    text.length <= MAX_PROMPT_CHARS
      ? service.act(() => runner.reviseGate(taskId, text, projectId))
      : INVALID
  )
  act(ch.cancel, (id) => runner.cancel(id))
  guarded(ch.choose, GENERIC, async (id, value) =>
    isId(id) && typeof value === 'string' && value.length <= 200
      ? service.act(() => runner.choose(id, value))
      : INVALID
  )
  guarded(ch.decideLeft, GENERIC, async (id, choice) =>
    isId(id) && (choice === 'cancel' || choice === 'continue')
      ? service.act(() => runner.decideLeft(id, choice))
      : INVALID
  )
}
