import type { IpcMain } from 'electron'
import type { ClaudeResult } from '../../shared/agent-run'
import { IPC_CHANNELS } from '../../shared/ipc-contract'
import type { Flow, FlowRunView } from '../../shared/task-flow'
import { parseFlowDef } from '../config/orkio-config'
import type { FlowRunner } from '../flows/flow-runner'
import type { FlowsService } from '../flows/flows.service'
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
  ready: Promise<void> = Promise.resolve()
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
  act(ch.approve, (id) => runner.approveGate(id))
  act(ch.reject, (id) => runner.rejectGate(id))
  act(ch.resume, (id) => runner.resume(id))
  act(ch.skip, (id) => runner.skip(id))
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
