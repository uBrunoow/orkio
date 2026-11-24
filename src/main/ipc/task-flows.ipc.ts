import type { ORKIO_API } from '../../shared/ipc/api'
import type { FlowRunner } from '../flows/flow-runner'
import type { FlowsService } from '../flows/flows.service'
import { openPr, type OpenPrDeps } from '../flows/open-pr'
import type { Impl } from './register'

/**
 * Fluxos de tarefa (5A). `FlowError`/`DeliveryError` viram `Result` de falha no registro do IPC
 * (erros de domínio); o resto vira a mensagem genérica do grupo.
 */
export function taskFlowsHandlers(
  service: FlowsService,
  runner: FlowRunner,
  openPrDeps: OpenPrDeps
): Impl<typeof ORKIO_API.taskFlows> {
  const ok = async <T>(value: Promise<T>): Promise<{ ok: true; value: T }> => ({
    ok: true,
    value: await value
  })
  return {
    getProject: (projectId) => service.getProject(projectId),
    saveFlows: (projectId, flows) => service.saveFlows(projectId, flows),
    runs: (taskId) => service.runs(taskId),
    active: (projectId) => service.active(projectId),
    start: (projectId, taskId) => ok(runner.startManual(projectId, taskId)),
    approve: (id, values) => ok(runner.approveGate(id, values)),
    setDelivery: (projectId, settings) => service.setDelivery(projectId, settings),
    startById: (projectId, taskId, flowId) => ok(runner.startById(projectId, taskId, flowId)),
    openPr: (projectId, taskId) => ok(openPr(openPrDeps, projectId, taskId)),
    reject: (id) => ok(runner.rejectGate(id)),
    resume: (id) => ok(runner.resume(id)),
    rerunFrom: (id, stepId) => ok(runner.rerunFrom(id, stepId)),
    resumeWithReply: (id, text) => ok(runner.resumeWithReply(id, text)),
    reviseGate: (projectId, taskId, text) => ok(runner.reviseGate(taskId, text, projectId)),
    skip: (id) => ok(runner.skip(id)),
    cancel: (id) => ok(runner.cancel(id)),
    decideLeft: (id, choice) => ok(runner.decideLeft(id, choice)),
    choose: (id, value) => ok(runner.choose(id, value))
  }
}
