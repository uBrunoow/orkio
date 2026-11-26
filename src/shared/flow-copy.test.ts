import { describe, expect, it } from 'vitest'
import type { AutomationRule } from './automation'
import type { StatusOption } from './board'
import type { FlowStageDraft } from './flow'
import { copyFlowFrom } from './flow-copy'
import type { Flow } from './task-flow'

const opt = (id: string, name: string): StatusOption => ({ id, name, color: 'default' })
const SRC_OPTIONS = [opt('a1', 'Prioridades'), opt('a2', 'Em andamento'), opt('a3', 'Finalizadas')]
const DST_OPTIONS = [opt('b1', 'Prioridades'), opt('b2', 'Em andamento'), opt('b3', 'Concluídas')]

const SRC_STAGES: FlowStageDraft[] = [
  { id: 's-queue', name: 'Prioridades', role: 'queue', notionStatusId: 'a1' },
  { id: 's-work', name: 'Em andamento', role: 'work', notionStatusId: 'a2' },
  { id: 's-review', name: 'Revisando', role: 'review', notionStatusId: 'a2' },
  { id: 's-done', name: 'Finalizada', role: 'done', notionStatusId: 'a3' }
]
const RULES: AutomationRule[] = [
  {
    id: 'r1',
    name: 'PR aberta vai para revisão',
    enabled: true,
    trigger: 'pr.opened',
    conditions: { fromStages: ['s-work'], notBlocked: true },
    action: { type: 'move_to_stage', stageId: 's-review' }
  }
]
const FLOW: Flow = { id: 'meu-fluxo', name: 'Revisar', steps: [] }

const TARGET_STAGES: FlowStageDraft[] = [
  { id: 't-queue', name: 'Prioridades', role: 'queue', notionStatusId: 'b1' },
  { id: 't-work', name: 'Em andamento', role: 'work', notionStatusId: 'b2' }
]

let n = 0
const newId = (): string => `novo-${++n}`

function copy() {
  n = 0
  return copyFlowFrom({
    source: {
      draft: { stages: SRC_STAGES, rules: RULES },
      options: SRC_OPTIONS,
      bindings: [{ stageId: 's-review', flowId: 'meu-fluxo', enabled: true, mode: 'on_enter' }],
      flows: [FLOW, { id: 'nao-usado', name: 'Sobra', steps: [] }],
      setups: [{ stageId: 's-work', setup: { mode: 'quick' } }]
    },
    target: { stages: TARGET_STAGES, options: DST_OPTIONS, flows: [] },
    newId
  })
}

describe('copiar o fluxo de outro projeto', () => {
  it('reaproveita as colunas do destino pelo papel (as tarefas ficam onde estão)', () => {
    const r = copy()
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.draft.stages.map((s) => s.id)).toEqual(['t-queue', 't-work', 'novo-3', 'novo-4'])
    expect(r.reused).toBe(2)
    // Status casados pelo nome no Notion do destino.
    expect(r.draft.stages.map((s) => s.notionStatusId)).toEqual(['b1', 'b2', 'b2', null])
    expect(r.draft.removals).toEqual({})
  })

  it('automações, ligações, fluxos usados e modos das colunas apontam para as colunas do destino', () => {
    const r = copy()
    if (!r.ok) throw new Error('falhou')
    expect(r.draft.rules[0]).toMatchObject({
      conditions: { fromStages: ['t-work'] },
      action: { type: 'move_to_stage', stageId: 'novo-3' }
    })
    expect(r.draft.bindings).toEqual([
      { stageId: 'novo-3', flowId: 'meu-fluxo', enabled: true, mode: 'on_enter' }
    ])
    expect(r.flowsToAdd.map((f) => f.id)).toEqual(['meu-fluxo'])
    expect(r.setups).toEqual([{ stageId: 't-work', setup: { mode: 'quick' } }])
  })

  it('avisa o status que não existe no Notion do destino; coluna do destino sem par sai', () => {
    n = 0
    const r = copyFlowFrom({
      source: {
        draft: { stages: SRC_STAGES, rules: [] },
        options: SRC_OPTIONS,
        bindings: [],
        flows: [],
        setups: []
      },
      target: {
        stages: [...TARGET_STAGES, { id: 't-x', name: 'Outra', notionStatusId: 'b3' }],
        options: DST_OPTIONS,
        flows: [FLOW]
      },
      newId
    })
    if (!r.ok) throw new Error('falhou')
    expect(r.warnings.join(' ')).toContain('Finalizadas')
    expect(r.draft.removals).toEqual({ 't-x': null })
    expect(r.flowsToAdd).toEqual([])
  })
})
