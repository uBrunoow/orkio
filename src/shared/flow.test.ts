import { describe, expect, it } from 'vitest'
import { defaultRules, type AutomationRule } from './automation'
import { suggestStages, type StatusOption } from './board'
import {
  describeRule,
  diffFlow,
  exportFlow,
  fromBoardStages,
  importFlow,
  restoreDefaultFlow,
  simulate,
  toBoardStages,
  validateFlow,
  type FlowDraft
} from './flow'

const OPTIONS: StatusOption[] = [
  { id: 'o-prio', name: 'Prioridades', color: 'gray' },
  { id: 'o-and', name: 'Em andamento', color: 'blue' },
  { id: 'o-fin', name: 'Finalizadas', color: 'green' }
]
const BOARD = suggestStages(OPTIONS)
const [PRIO, AND, REV, REVD, FIN] = BOARD.map((s) => s.id) as [
  string,
  string,
  string,
  string,
  string
]
const RULES = defaultRules(BOARD).rules

function draft(over: Partial<FlowDraft> = {}): FlowDraft {
  return {
    stages: fromBoardStages(BOARD),
    rules: RULES.map((r) => ({ ...r })),
    removals: {},
    ...over
  }
}
const ctx = (over: Partial<Parameters<typeof validateFlow>[1]> = {}) => ({
  statusOptions: OPTIONS,
  savedStageIds: BOARD.map((s) => s.id),
  taskCounts: {},
  ...over
})
const move = (
  id: string,
  trigger: AutomationRule['trigger'],
  to: string,
  from?: string[]
): AutomationRule => ({
  id,
  name: id,
  enabled: true,
  trigger,
  conditions: from ? { fromStages: from } : {},
  action: { type: 'move_to_stage', stageId: to }
})
const kinds = (d: FlowDraft, c = ctx()) => validateFlow(d, c).map((i) => [i.level, i.kind])

describe('describeRule', () => {
  it('frase em pt-BR com gatilho, origem, destino e extras', () => {
    expect(
      describeRule(
        RULES.find((r) => r.id === 'default-pr-opened')!,
        BOARD
      )
    ).toBe(
      'Quando a PR é aberta e a tarefa está em Prioridades ou Em andamento, mover para Revisando. Ignora bloqueadas.'
    )
    expect(
      describeRule(
        RULES.find((r) => r.id === 'default-merged')!,
        BOARD
      )
    ).toBe('Quando a PR é mergeada, mover para Finalizada. Ignora bloqueadas.')
    expect(
      describeRule(
        { ...move('n', 'pr.approved', AND), action: { type: 'notify', message: 'Aprovou!' } },
        BOARD
      )
    ).toBe('Quando a PR é aprovada, notificar: “Aprovou!”.')
    expect(describeRule(move('x', 'pr.merged', 'sumiu'), BOARD)).toContain(
      'mover para etapa removida'
    )
  })
})

describe('validateFlow', () => {
  it('fluxo padrão é válido', () => {
    expect(validateFlow(draft(), ctx())).toEqual([])
  })

  it('etapa sem status do Notion válido (vazio ou inexistente)', () => {
    const stages = fromBoardStages(BOARD)
    stages[0] = { ...stages[0]!, notionStatusId: null, missingStatusName: 'Backlog' }
    stages[1] = { ...stages[1]!, notionStatusId: 'nao-existe' }
    const issues = validateFlow(draft({ stages }), ctx())
    expect(issues.filter((i) => i.kind === 'stage_status')).toHaveLength(2)
    expect(issues[0]?.message).toContain('“Backlog”')
  })

  it('nome vazio ou repetido', () => {
    const stages = fromBoardStages(BOARD)
    stages[2] = { ...stages[2]!, name: ' ' }
    stages[3] = { ...stages[3]!, name: 'em andamento' }
    expect(kinds(draft({ stages }))).toEqual([
      ['error', 'stage_name'],
      ['error', 'stage_name']
    ])
  })

  it('regra apontando para etapa removida (destino ou origem)', () => {
    const stages = fromBoardStages(BOARD).filter((s) => s.id !== REVD)
    const issues = validateFlow(draft({ stages, removals: { [REVD]: null } }), ctx())
    expect(issues.filter((i) => i.kind === 'rule_missing_stage').map((i) => i.ruleId)).toEqual([
      'default-changes',
      'default-comments',
      'default-rerequest'
    ])
  })

  it('remover etapa com tarefas sem escolher destino', () => {
    const stages = fromBoardStages(BOARD).filter((s) => s.id !== REV)
    const rules = RULES.filter(
      (r) => r.action.type !== 'move_to_stage' || r.action.stageId !== REV
    ).map((r) => ({
      ...r,
      conditions: {
        ...r.conditions,
        fromStages: (r.conditions?.fromStages ?? []).filter((id) => id !== REV)
      }
    }))
    const base = { stages, rules }
    expect(kinds({ ...base, removals: {} }, ctx({ taskCounts: { [REV]: 3 } }))).toContainEqual([
      'error',
      'removal_destination'
    ])
    expect(
      kinds({ ...base, removals: { [REV]: REV } }, ctx({ taskCounts: { [REV]: 3 } }))
    ).toContainEqual(['error', 'removal_destination'])
    expect(
      kinds({ ...base, removals: { [REV]: AND } }, ctx({ taskCounts: { [REV]: 3 } }))
    ).not.toContainEqual(['error', 'removal_destination'])
    // Sem tarefas: não precisa de destino.
    expect(kinds({ ...base, removals: {} })).not.toContainEqual(['error', 'removal_destination'])
  })

  it('notificação sem mensagem é incompleta', () => {
    const rules = [
      { ...move('n', 'pr.merged', FIN), action: { type: 'notify' as const, message: ' ' } }
    ]
    expect(kinds(draft({ rules }))).toEqual([['error', 'rule_incomplete']])
  })

  it('conflito: mesmo gatilho e origem, destinos diferentes → diz qual vence pela ordem', () => {
    const rules = [move('a', 'pr.approved', FIN, [REV]), move('b', 'pr.approved', REVD, [REV, AND])]
    const issues = validateFlow(draft({ rules }), ctx())
    const conflict = issues.find((i) => i.kind === 'conflict')!
    expect(conflict.level).toBe('warning')
    expect(conflict.message).toBe(
      'Conflito: quando a PR é aprovada em Revisando, a regra 1ª (→ Finalizada) vence a 2ª (→ Revisado) pela ordem.'
    )
    // Origens disjuntas ou mesmo destino: sem conflito.
    expect(
      kinds(
        draft({
          rules: [move('a', 'pr.approved', FIN, [REV]), move('b', 'pr.approved', REVD, [AND])]
        })
      )
    ).toEqual([])
    expect(
      kinds(
        draft({
          rules: [move('a', 'pr.approved', FIN, [REV]), move('b', 'pr.approved', FIN, [AND])]
        })
      )
    ).toEqual([])
    // Regra desativada não conflita.
    expect(
      kinds(
        draft({
          rules: [
            move('a', 'pr.approved', FIN, [REV]),
            { ...move('b', 'pr.approved', REVD, [REV]), enabled: false }
          ]
        })
      )
    ).toEqual([])
  })

  it('ciclo instantâneo A → B e B → A pelo mesmo gatilho', () => {
    const rules = [
      move('a', 'pr.review_requested', REV, [REVD]),
      move('b', 'pr.review_requested', REVD, [REV])
    ]
    const issues = validateFlow(draft({ rules }), ctx())
    expect(issues.map((i) => i.kind)).toEqual(['cycle'])
    expect(issues[0]?.message).toContain('Revisado → Revisando')
    // Gatilhos diferentes (o ciclo de correções padrão) não é ciclo instantâneo.
    expect(
      kinds(
        draft({
          rules: [
            move('a', 'pr.review_requested', REV, [REVD]),
            move('b', 'pr.changes_requested', REVD, [REV])
          ]
        })
      )
    ).toEqual([])
  })

  it('regra inalcançável (todas as origens já tratadas antes)', () => {
    const rules = [move('a', 'pr.merged', FIN), move('b', 'pr.merged', FIN, [REV])]
    expect(kinds(draft({ rules }))).toEqual([['warning', 'unreachable']])
  })
})

describe('simulate', () => {
  const task = (stageId: string, over: Partial<Parameters<typeof simulate>[2]> = {}) => ({
    stageId,
    blocked: false,
    paused: false,
    globallyPaused: false,
    notionStatus: { id: 'o-and', name: 'Em andamento' },
    ...over
  })

  it('regra que casa, de → para e Notion que muda', () => {
    const r = simulate(draft(), OPTIONS, task(REV), 'pr.merged')
    expect(r.decision).toMatchObject({
      outcome: 'move',
      ruleId: 'default-merged',
      from: REV,
      to: FIN
    })
    expect(r.notion).toEqual({ changes: true, from: 'Em andamento', to: 'Finalizadas' })
  })

  it('etapa fina não muda o Notion', () => {
    const r = simulate(draft(), OPTIONS, task(REV), 'pr.changes_requested')
    expect(r.decision).toMatchObject({ outcome: 'move', to: REVD })
    expect(r.notion).toEqual({ changes: false, from: 'Em andamento', to: 'Em andamento' })
  })

  it('nenhuma regra, bloqueada e pausada', () => {
    expect(simulate(draft(), OPTIONS, task(FIN), 'pr.opened').decision.outcome).toBe('no_rule')
    expect(
      simulate(draft(), OPTIONS, task(REV, { blocked: true }), 'pr.merged').decision
    ).toMatchObject({
      outcome: 'skipped',
      reason: 'tarefa bloqueada'
    })
    expect(
      simulate(draft(), OPTIONS, task(REV, { globallyPaused: true }), 'pr.merged').decision.outcome
    ).toBe('skipped')
  })

  it('usa o rascunho (etapa nova QA ainda não salva)', () => {
    const stages = fromBoardStages(BOARD)
    stages.splice(4, 0, { id: 'qa', name: 'QA', notionStatusId: 'o-and' })
    const rules = [move('qa-rule', 'pr.approved', 'qa', [REV]), ...RULES]
    const r = simulate({ stages, rules }, OPTIONS, task(REV), 'pr.approved')
    expect(r.decision).toMatchObject({ ruleId: 'qa-rule', to: 'qa' })
    expect(r.notion.changes).toBe(false)
  })
})

describe('diffFlow', () => {
  it('descreve criações, renomeações, remoções, status e regras', () => {
    const after = toBoardStages(fromBoardStages(BOARD), OPTIONS)
    after.splice(4, 0, {
      id: 'qa',
      name: 'QA',
      order: 4,
      notionStatus: { id: 'o-and', name: 'Em andamento' }
    })
    after[0] = { ...after[0]!, name: 'Backlog' }
    const rules = RULES.filter((r) => r.id !== 'default-closed').map((r) =>
      r.id === 'default-branch' ? { ...r, enabled: false } : r
    )
    rules.unshift(move('qa-rule', 'pr.approved', 'qa', [REV]))
    expect(diffFlow({ stages: BOARD, rules: RULES }, { stages: after, rules })).toEqual([
      'Etapa “Prioridades” renomeada para “Backlog”',
      'Etapa “QA” criada entre Revisado e Finalizada (Notion: Em andamento)',
      'Automação criada: Quando a PR é aprovada e a tarefa está em Revisando, mover para QA.',
      'Automação “Branch criada inicia a tarefa” desativada',
      'Automação “PR fechada sem merge volta para andamento” removida'
    ])
    expect(diffFlow({ stages: BOARD, rules: RULES }, { stages: BOARD, rules: RULES })).toEqual([])
  })
})

describe('restoreDefaultFlow', () => {
  it('5 etapas e regras padrão, reaproveitando ids por nome', () => {
    let n = 0
    const current = fromBoardStages(BOARD).filter((s) => s.id !== REVD)
    current.push({ id: 'qa', name: 'QA', notionStatusId: 'o-and' })
    const restored = restoreDefaultFlow(current, OPTIONS, () => `novo-${++n}`)
    expect(restored.stages.map((s) => [s.id, s.name])).toEqual([
      [PRIO, 'Prioridades'],
      [AND, 'Em andamento'],
      [REV, 'Revisando'],
      ['novo-1', 'Revisado'],
      [FIN, 'Finalizada']
    ])
    expect(restored.rules).toHaveLength(8)
    expect(restored.rules.every((r) => r.enabled)).toBe(true)
  })
})

describe('exportFlow / importFlow', () => {
  it('ida e volta mantém etapas, status (por nome) e regras com novas ids', () => {
    const file = exportFlow(draft(), OPTIONS, '2026-11-19T00:00:00Z')
    expect(file).toMatchObject({ format: 'orkio-flow', version: 1 })
    expect(JSON.stringify(file)).not.toContain(PRIO)
    let n = 0
    const result = importFlow(JSON.parse(JSON.stringify(file)), OPTIONS, () => `id-${++n}`)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.warnings).toEqual([])
    expect(result.draft.stages.map((s) => [s.name, s.notionStatusId])).toEqual([
      ['Prioridades', 'o-prio'],
      ['Em andamento', 'o-and'],
      ['Revisando', 'o-and'],
      ['Revisado', 'o-and'],
      ['Finalizada', 'o-fin']
    ])
    const merged = result.draft.rules.find((r) => r.trigger === 'pr.merged')!
    expect(merged.action).toEqual({ type: 'move_to_stage', stageId: 'id-5' })
    expect(validateFlow({ ...result.draft, removals: {} }, ctx({ savedStageIds: [] }))).toEqual([])
  })

  it('status que não existe no outro projeto vira etapa a corrigir (com aviso)', () => {
    const file = exportFlow(draft(), OPTIONS, 'x')
    const other: StatusOption[] = [{ id: 'z', name: 'Prioridades', color: 'gray' }]
    const result = importFlow(file, other, () => Math.random().toString(36))
    expect(result.ok && result.warnings.length).toBe(4)
    if (result.ok)
      expect(result.draft.stages[1]).toMatchObject({
        notionStatusId: null,
        missingStatusName: 'Em andamento'
      })
  })

  it('formato errado, versão futura, regra com etapa desconhecida', () => {
    expect(importFlow({ format: 'outro' }, OPTIONS, () => 'x')).toMatchObject({ ok: false })
    expect(importFlow('nada', OPTIONS, () => 'x')).toMatchObject({ ok: false })
    const file = exportFlow(draft(), OPTIONS, 'x')
    expect(importFlow({ ...file, version: 2 }, OPTIONS, () => 'x')).toMatchObject({
      ok: false,
      error: expect.stringContaining('versão mais nova')
    })
    const broken = {
      ...file,
      rules: [{ ...file.rules[0], action: { type: 'move_to_stage', stage: 's99' } }]
    }
    expect(importFlow(broken, OPTIONS, () => `${Math.random()}`)).toMatchObject({ ok: false })
    expect(
      importFlow(
        { ...file, rules: [{ ...file.rules[0], trigger: 'pr.hack' }] },
        OPTIONS,
        () => `${Math.random()}`
      )
    ).toMatchObject({ ok: false })
  })
})
