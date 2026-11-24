import { ALVA_FAILURES, ALVA_TAG, ALVA_VAR_PREFIX } from '../../shared/alva'
import type { FlowIntegration } from '../flows/flow-integration'
import type { AlvaFlowsService } from './alva-flows.service'
import { ALVA_MESSAGES, type AlvaService } from './alva.service'

export function createAlvaIntegration(deps: {
  alva: Pick<AlvaService, 'initialVars'>
  flows: Pick<AlvaFlowsService, 'blockReason' | 'concurrencyLimit'>
}): FlowIntegration {
  return {
    tag: ALVA_TAG,
    varPrefix: ALVA_VAR_PREFIX,
    missingVar: { code: ALVA_FAILURES.notLinked, message: ALVA_MESSAGES.notLinked },
    initialVars: (projectId, taskId) => deps.alva.initialVars(projectId, taskId),
    canStart: (projectId) => deps.flows.blockReason(projectId),
    concurrencyLimit: (projectId) => deps.flows.concurrencyLimit(projectId)
  }
}
