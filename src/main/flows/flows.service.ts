/**
 * Configuração dos fluxos de tarefa (5A) e fachada do FlowRunner para o IPC. O main valida de
 * novo com `validateTaskFlow` (a mesma função do editor); erros bloqueiam, avisos não.
 */
import type { ClaudeResult } from '../../shared/agent-run'
import {
  validateTaskFlow,
  type Flow,
  type FlowRunView,
  type ProjectFlows
} from '../../shared/task-flow'
import type { BoardStore } from '../board/board.store'
import type { ConfigStore } from '../storage/config-store'
import type { OrkioConfig } from '../config/orkio-config'
import { errorName } from '../ipc/payload'
import { FlowError, type FlowExtractor, type FlowRunner, type OrkioAction } from './flow-runner'

export interface FlowsProjectView extends ProjectFlows {
  extractors: { id: string; label: string }[]
  actions: { id: string; label: string }[]
}

export class FlowsService {
  constructor(
    private readonly deps: {
      config: ConfigStore<OrkioConfig>
      store: BoardStore
      runner: FlowRunner
      extractors: readonly FlowExtractor[]
      actions: readonly OrkioAction[]
      actor: () => string
      now?: () => Date
    }
  ) {}

  getProject(projectId: string): ClaudeResult<FlowsProjectView> {
    const pf = this.deps.config.get().flows[projectId] ?? { flows: [], bindings: [] }
    return {
      ok: true,
      value: {
        ...pf,
        extractors: this.deps.extractors.map((e) => ({ id: e.id, label: e.label })),
        actions: this.deps.actions.map((a) => ({ id: a.id, label: a.label }))
      }
    }
  }

  async saveFlows(projectId: string, flows: Flow[]): Promise<ClaudeResult<FlowsProjectView>> {
    if (!this.deps.config.get().projects.some((p) => p.id === projectId)) {
      return fail('not_found', 'Projeto não encontrado. Atualize a lista.')
    }
    const ids = new Set<string>()
    for (const flow of flows) {
      if (ids.has(flow.id)) return fail('invalid', 'Dois fluxos com o mesmo id.')
      ids.add(flow.id)
      const errors = validateTaskFlow(flow, {
        commands: null,
        extractors: this.deps.extractors.map((e) => e.id),
        actions: this.deps.actions.map((a) => a.id)
      }).filter((i) => i.level === 'error')
      if (errors.length > 0) {
        return fail(
          'invalid',
          `“${flow.name || flow.id}”: ${errors.map((e) => e.message).join(' ')}`
        )
      }
    }
    const before = this.deps.config.get().flows[projectId] ?? { flows: [], bindings: [] }
    // Fluxo removido: some a ligação da coluna (execuções em curso usam a própria cópia).
    const bindings = before.bindings.filter((b) => ids.has(b.flowId))
    try {
      await this.deps.config.update((c) => ({
        ...c,
        flows: { ...c.flows, [projectId]: { flows, bindings } }
      }))
    } catch (error) {
      console.error(`[orkio] salvar fluxos: ${errorName(error)}`)
      return fail('storage', 'Não foi possível salvar os fluxos. Tente novamente.')
    }
    const changes = diffFlows(before.flows, flows)
    if (changes.length > 0) {
      this.deps.store.addConfigEvent(
        projectId,
        (this.deps.now?.() ?? new Date()).toISOString(),
        this.deps.actor(),
        changes
      )
    }
    return this.getProject(projectId)
  }

  runs(taskId: string): FlowRunView[] {
    return this.deps.runner.list(taskId)
  }

  active(projectId: string): Record<string, 'running' | 'needs_you'> {
    return this.deps.runner.activeForProject(projectId)
  }

  act(fn: () => Promise<FlowRunView>): Promise<ClaudeResult<FlowRunView>> {
    return fn().then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => {
        if (error instanceof FlowError) return fail<FlowRunView>(error.code, error.message)
        console.error(`[orkio] fluxo: ${errorName(error)}`)
        return fail<FlowRunView>('unexpected', 'Algo deu errado no fluxo. Tente novamente.')
      }
    )
  }
}

function fail<T>(code: string, message: string): ClaudeResult<T> {
  return { ok: false, error: { code, message } }
}

function diffFlows(before: readonly Flow[], after: readonly Flow[]): string[] {
  const out: string[] = []
  for (const f of after) {
    const old = before.find((b) => b.id === f.id)
    if (!old) out.push(`Fluxo de tarefa criado: “${f.name}” (${f.steps.length} passo(s))`)
    else if (JSON.stringify(old) !== JSON.stringify(f)) {
      out.push(`Fluxo de tarefa alterado: “${f.name}”`)
    }
  }
  for (const f of before) {
    if (!after.some((a) => a.id === f.id)) out.push(`Fluxo de tarefa removido: “${f.name}”`)
  }
  return out
}
