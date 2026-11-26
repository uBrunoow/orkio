/**
 * "Copiar de outro projeto…" (Fluxo do projeto): o fluxo de um projeto (colunas, automações,
 * fluxo de cada coluna, os fluxos de tarefa usados e o "Como as colunas rodam") trazido para o
 * rascunho de outro. Usa o mesmo caminho do exportar/importar (status casados pelo NOME no Notion
 * do destino) e reaproveita as colunas do destino com o mesmo papel (ou o mesmo nome), para as
 * tarefas ficarem onde estão. Puro: quem chama mostra o resumo, põe no rascunho e salva.
 */
import type { StatusOption } from './board'
import { exportFlow, importFlow, type FlowDraft, type FlowStageDraft } from './flow'
import type { RunSetup } from './task-setup'
import type { Flow, StageFlow } from './task-flow'
import { normalizeLabel } from './text'

export interface FlowCopySource {
  draft: Pick<FlowDraft, 'stages' | 'rules'>
  options: readonly StatusOption[]
  bindings: readonly StageFlow[]
  flows: readonly Flow[]
  setups: readonly { stageId: string; setup: RunSetup }[]
}

export interface FlowCopyTarget {
  /** Colunas salvas do destino. */
  stages: readonly FlowStageDraft[]
  options: readonly StatusOption[]
  flows: readonly Flow[]
}

export type FlowCopyResult =
  | {
      ok: true
      draft: FlowDraft
      /** Fluxos de tarefa ligados a colunas da origem que o destino ainda não tem (pelo id). */
      flowsToAdd: Flow[]
      /** "Como as colunas rodam" da origem, nas colunas do destino. */
      setups: { stageId: string; setup: RunSetup }[]
      /** Colunas do destino reaproveitadas (as tarefas delas não mudam de coluna). */
      reused: number
      warnings: string[]
    }
  | { ok: false; error: string }

export function copyFlowFrom(input: {
  source: FlowCopySource
  target: FlowCopyTarget
  newId: () => string
}): FlowCopyResult {
  const { source, target } = input
  const file = exportFlow(source.draft, source.options, new Date(0).toISOString())
  const parsed = importFlow(file, target.options, input.newId)
  if (!parsed.ok) return parsed

  // Coluna importada → coluna do destino com o mesmo papel, ou o mesmo nome (sem acento/caixa).
  const used = new Set<string>()
  const remap = new Map<string, string>()
  for (const stage of parsed.draft.stages) {
    const match =
      (stage.role && target.stages.find((t) => t.role === stage.role && !used.has(t.id))) ||
      target.stages.find(
        (t) => !used.has(t.id) && normalizeLabel(t.name) === normalizeLabel(stage.name)
      )
    if (match) {
      used.add(match.id)
      remap.set(stage.id, match.id)
    }
  }
  const id = (x: string): string => remap.get(x) ?? x
  const stages = parsed.draft.stages.map((s) => ({ ...s, id: id(s.id) }))
  const rules = parsed.draft.rules.map((r) => ({
    ...r,
    ...(r.conditions
      ? {
          conditions: {
            ...r.conditions,
            ...(r.conditions.fromStages ? { fromStages: r.conditions.fromStages.map(id) } : {})
          }
        }
      : {}),
    action:
      r.action.type === 'move_to_stage' ? { ...r.action, stageId: id(r.action.stageId) } : r.action
  }))
  const removals = Object.fromEntries(
    target.stages.filter((t) => !used.has(t.id)).map((t) => [t.id, null])
  ) as Record<string, string | null>

  // Coluna da origem → coluna final, pela posição (o exportar mantém a ordem).
  const finalId = new Map(source.draft.stages.map((s, i) => [s.id, stages[i]?.id ?? null]))
  const bindings = source.bindings.flatMap((b) => {
    const stageId = finalId.get(b.stageId)
    return stageId ? [{ ...b, stageId }] : []
  })
  const known = new Set(target.flows.map((f) => f.id))
  const flowsToAdd = source.flows.filter(
    (f) => !known.has(f.id) && bindings.some((b) => b.flowId === f.id)
  )
  const setups = source.setups.flatMap((s) => {
    const stageId = finalId.get(s.stageId)
    return stageId && Object.keys(s.setup).length > 0 ? [{ stageId, setup: s.setup }] : []
  })

  return {
    ok: true,
    draft: { stages, rules, removals, bindings },
    flowsToAdd: flowsToAdd.map((f) => structuredClone(f)),
    setups,
    reused: used.size,
    warnings: parsed.warnings
  }
}
