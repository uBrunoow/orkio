import { describe, expect, it } from 'vitest'
import {
  compareEvents,
  defaultRules,
  deriveEvents,
  evaluate,
  mergeSnapshot,
  toSnapshot,
  type AutomationEvent,
  type PrSnapshot,
  type TaskSnapshot
} from './automation'
import { suggestStages } from './board'

const STAGES = suggestStages([
  { id: 'o-prio', name: 'Prioridades', color: 'gray' },
  { id: 'o-and', name: 'Em andamento', color: 'blue' },
  { id: 'o-fin', name: 'Finalizadas', color: 'green' }
])
const [PRIO, AND, REV, REVD, FIN] = STAGES.map((s) => s.id) as [
  string,
  string,
  string,
  string,
  string
]
const { rules: RULES } = defaultRules(STAGES)

const pr = (over: Partial<PrSnapshot> = {}): PrSnapshot => ({
  number: 7,
  state: 'open',
  updatedAt: '2026-11-19T10:00:00Z',
  closedAt: null,
  reviewRequests: [],
  reviews: [],
  unresolvedThreadIds: [],
  ...over
})
const snap = (
  over: { local?: string[] | null; remote?: string[]; pr?: PrSnapshot | null; github?: false } = {}
): TaskSnapshot => ({
  localBranches: over.local === undefined ? [] : over.local,
  github:
    over.github === false
      ? null
      : { remoteBranches: over.remote ?? [], pr: over.pr === undefined ? null : over.pr }
})
const kinds = (events: AutomationEvent[]) => events.map((e) => [e.kind, e.key])

describe('deriveEvents', () => {
  it('primeira observação é só linha de base', () => {
    expect(deriveEvents('t', null, snap({ local: ['ORK-1/x'], pr: pr() }))).toEqual([])
  })

  it('branch local e remota novas', () => {
    expect(
      kinds(deriveEvents('t', snap(), snap({ local: ['ORK-1/x'], remote: ['ORK-1/x'] })))
    ).toEqual([
      ['branch.created', 'branch:local:ORK-1/x'],
      ['branch.created', 'branch:remote:ORK-1/x']
    ])
  })

  it('PR aberta (não rascunho) e rascunho → pronta', () => {
    expect(kinds(deriveEvents('t', snap(), snap({ pr: pr() })))).toEqual([
      ['pr.opened', 'pr#7:opened']
    ])
    expect(deriveEvents('t', snap(), snap({ pr: pr({ state: 'draft' }) }))).toEqual([])
    expect(
      kinds(deriveEvents('t', snap({ pr: pr({ state: 'draft' }) }), snap({ pr: pr() })))
    ).toEqual([['pr.ready_for_review', 'pr#7:ready']])
  })

  it('pedido de review, alterações pedidas, aprovação e threads não resolvidas (ids novos)', () => {
    const before = snap({ pr: pr({ reviewRequests: [{ id: 'rr1', at: '2026-11-19T09:00:00Z' }] }) })
    const after = snap({
      pr: pr({
        reviewRequests: [
          { id: 'rr1', at: '2026-11-19T09:00:00Z' },
          { id: 'rr2', at: '2026-11-19T12:00:00Z' }
        ],
        reviews: [
          { id: 'rv1', state: 'changes_requested', at: '2026-11-19T11:00:00Z' },
          { id: 'rv2', state: 'approved', at: '2026-11-19T13:00:00Z' }
        ],
        unresolvedThreadIds: ['th1', 'th2'],
        updatedAt: '2026-11-19T13:30:00Z'
      })
    })
    expect(kinds(deriveEvents('t', before, after))).toEqual([
      ['pr.changes_requested', 'pr#7:review:rv1'],
      ['pr.review_requested', 'pr#7:review_request:rr2'],
      ['pr.approved', 'pr#7:review:rv2'],
      ['pr.review_comments_unresolved', 'pr#7:threads:th1,th2']
    ])
  })

  it('threads: só dispara quando aparece thread não resolvida nova', () => {
    const one = snap({ pr: pr({ unresolvedThreadIds: ['a'] }) })
    expect(deriveEvents('t', one, snap({ pr: pr({ unresolvedThreadIds: ['a'] }) }))).toEqual([])
    expect(deriveEvents('t', one, snap({ pr: pr({ unresolvedThreadIds: [] }) }))).toEqual([])
    expect(
      kinds(deriveEvents('t', one, snap({ pr: pr({ unresolvedThreadIds: ['a', 'b'] }) })))
    ).toEqual([['pr.review_comments_unresolved', 'pr#7:threads:b']])
  })

  it('merge e fechamento sem merge (reabrir e fechar de novo dispara de novo)', () => {
    expect(
      kinds(
        deriveEvents('t', snap({ pr: pr() }), snap({ pr: pr({ state: 'merged', closedAt: 'T1' }) }))
      )
    ).toEqual([['pr.merged', 'pr#7:merged']])
    const closed1 = snap({ pr: pr({ state: 'closed', closedAt: 'T1' }) })
    expect(kinds(deriveEvents('t', snap({ pr: pr() }), closed1))).toEqual([
      ['pr.closed_unmerged', 'pr#7:closed:T1']
    ])
    expect(deriveEvents('t', closed1, closed1)).toEqual([])
    const closed2 = snap({ pr: pr({ state: 'closed', closedAt: 'T2' }) })
    expect(kinds(deriveEvents('t', snap({ pr: pr() }), closed2))).toEqual([
      ['pr.closed_unmerged', 'pr#7:closed:T2']
    ])
  })

  it('GitHub indisponível de qualquer lado não gera eventos (nada "some" e "volta")', () => {
    expect(deriveEvents('t', snap({ pr: pr() }), snap({ github: false }))).toEqual([])
    expect(
      deriveEvents('t', snap({ github: false }), snap({ pr: pr({ state: 'merged' }) }))
    ).toEqual([])
    expect(deriveEvents('t', snap({ local: null }), snap({ local: ['ORK-1'] }))).toEqual([])
  })

  it('detalhes desconhecidos (GraphQL falhou) não geram eventos de review', () => {
    const before = snap({ pr: pr({ reviews: null }) })
    const after = snap({ pr: pr({ reviews: [{ id: 'rv', state: 'approved', at: 'x' }] }) })
    expect(deriveEvents('t', before, after)).toEqual([])
  })

  it('PR principal nova (outro número): abertura e reviews dela contam como novos', () => {
    const after = snap({
      pr: pr({
        number: 9,
        reviews: [{ id: 'rv9', state: 'changes_requested', at: '2026-11-19T12:00:00Z' }]
      })
    })
    expect(
      kinds(deriveEvents('t', snap({ pr: pr({ state: 'closed', closedAt: 'T' }) }), after))
    ).toEqual([
      ['pr.opened', 'pr#9:opened'],
      ['pr.changes_requested', 'pr#9:review:rv9']
    ])
  })

  it('ordem: ciclo de vida sem horário primeiro, depois por horário, merge por último', () => {
    const events: AutomationEvent[] = [
      { key: 'm', kind: 'pr.merged', taskId: 't', at: '2026-01-01T00:00:00Z' },
      { key: 'r', kind: 'pr.review_requested', taskId: 't', at: '2026-01-03T00:00:00Z' },
      { key: 'c', kind: 'pr.changes_requested', taskId: 't', at: '2026-01-02T00:00:00Z' },
      { key: 'o', kind: 'pr.opened', taskId: 't', at: null },
      { key: 'b', kind: 'branch.created', taskId: 't', at: null }
    ]
    expect([...events].sort(compareEvents).map((e) => e.key)).toEqual(['b', 'o', 'c', 'r', 'm'])
  })
})

describe('toSnapshot / mergeSnapshot', () => {
  it('guarda só dados técnicos e marca fontes indisponíveis', () => {
    const s = toSnapshot(
      {
        taskId: 't',
        displayId: 'ORK-1',
        localBranches: ['b', 'a'],
        remoteBranches: ['a'],
        pr: {
          number: 3,
          title: 'TÍTULO QUE NÃO PODE IR PARA O BANCO',
          url: 'https://github.com/a/b/pull/3',
          state: 'open',
          merged: false,
          headRef: 'a',
          updatedAt: 'U',
          closedAt: null,
          reviewDecision: null,
          unresolvedComments: 0,
          checks: null
        },
        otherPrs: 0
      },
      { local: true, github: true }
    )
    expect(JSON.stringify(s)).not.toContain('TÍTULO')
    expect(s).toMatchObject({
      localBranches: ['a', 'b'],
      github: { pr: { number: 3, reviews: null } }
    })
    expect(toSnapshot(undefined, { local: false, github: false })).toEqual({
      localBranches: null,
      github: null
    })
  })

  it('parte desconhecida mantém o último valor conhecido', () => {
    const prev = snap({
      local: ['x'],
      pr: pr({ reviews: [{ id: 'r', state: 'approved', at: 'a' }] })
    })
    expect(mergeSnapshot(prev, { localBranches: null, github: null })).toEqual(prev)
    const merged = mergeSnapshot(prev, snap({ local: ['x'], pr: pr({ reviews: null }) }))
    expect(merged.github?.pr?.reviews).toEqual([{ id: 'r', state: 'approved', at: 'a' }])
  })
})

describe('evaluate (regras padrão)', () => {
  const state = (stageId: string, over: Partial<Parameters<typeof evaluate>[2]> = {}) => ({
    stageId,
    blocked: false,
    paused: false,
    lastManualMoveAt: null,
    ...over
  })
  const ev = (kind: AutomationEvent['kind'], at: string | null = null): AutomationEvent => ({
    key: kind,
    kind,
    taskId: 't',
    at
  })

  it('regras padrão completas e ligadas', () => {
    expect(RULES).toHaveLength(8)
    expect(RULES.every((r) => r.enabled)).toBe(true)
    expect(defaultRules(STAGES.filter((s) => s.name !== 'Revisado')).warnings).toHaveLength(3)
  })

  it('regras padrão acham a etapa com espaço duplo no nome, como o quadro', () => {
    const spaced = STAGES.map((s) => (s.id === AND ? { ...s, name: 'Em  Andamento' } : s))
    const { rules, warnings } = defaultRules(spaced)
    expect(warnings).toEqual([])
    expect(rules.find((r) => r.id === 'default-branch')).toMatchObject({ enabled: true })
  })

  it('branch → Em andamento só a partir de Prioridades', () => {
    expect(evaluate([ev('branch.created')], RULES, state(PRIO), STAGES)[0]).toMatchObject({
      outcome: 'move',
      from: PRIO,
      to: AND,
      ruleId: 'default-branch'
    })
    expect(evaluate([ev('branch.created')], RULES, state(REV), STAGES)[0]).toMatchObject({
      outcome: 'no_rule'
    })
  })

  it('ciclo completo: aberta → Revisando → alterações → Revisado → novo pedido → Revisando → merge', () => {
    const decisions = evaluate(
      [
        ev('pr.opened'),
        ev('pr.changes_requested', '2026-11-19T10:00:00Z'),
        ev('pr.review_requested', '2026-11-19T11:00:00Z'),
        ev('pr.merged', '2026-11-19T12:00:00Z')
      ],
      RULES,
      state(AND),
      STAGES
    )
    expect(decisions.map((d) => [d.outcome, d.from, d.to])).toEqual([
      ['move', AND, REV],
      ['move', REV, REVD],
      ['move', REVD, REV],
      ['move', REV, FIN]
    ])
  })

  it('pr.review_requested fora de Revisado não move (primeiro pedido não é ciclo)', () => {
    expect(evaluate([ev('pr.review_requested')], RULES, state(REV), STAGES)[0]?.outcome).toBe(
      'no_rule'
    )
  })

  it('merge vale de qualquer etapa; já em Finalizada vira noop', () => {
    expect(evaluate([ev('pr.merged')], RULES, state(PRIO), STAGES)[0]?.to).toBe(FIN)
    expect(evaluate([ev('pr.merged')], RULES, state(FIN), STAGES)[0]?.outcome).toBe('noop')
  })

  it('fechada sem merge → Em andamento com notificação', () => {
    expect(evaluate([ev('pr.closed_unmerged')], RULES, state(REV), STAGES)[0]).toMatchObject({
      outcome: 'move',
      to: AND,
      notify: true
    })
  })

  it('bloqueada, pausada (tarefa ou global) → ignorada com motivo, sem mover', () => {
    expect(
      evaluate([ev('pr.merged')], RULES, state(REV, { blocked: true }), STAGES)[0]
    ).toMatchObject({
      outcome: 'skipped',
      reason: 'tarefa bloqueada',
      to: FIN
    })
    expect(
      evaluate([ev('pr.merged')], RULES, state(REV, { paused: true }), STAGES)[0]?.reason
    ).toBe('automações pausadas nesta tarefa')
    expect(
      evaluate([ev('pr.merged')], RULES, state(REV), STAGES, { globallyPaused: true })[0]?.outcome
    ).toBe('skipped')
  })

  it('conflito: movimento manual depois do evento vence', () => {
    const d = evaluate(
      [ev('pr.merged', '2026-11-19T10:00:00Z')],
      RULES,
      state(REV, { lastManualMoveAt: '2026-11-19T10:05:00Z' }),
      STAGES
    )
    expect(d[0]).toMatchObject({
      outcome: 'skipped',
      reason: expect.stringContaining('manualmente')
    })
    const later = evaluate(
      [ev('pr.merged', '2026-11-19T10:10:00Z')],
      RULES,
      state(REV, { lastManualMoveAt: '2026-11-19T10:05:00Z' }),
      STAGES
    )
    expect(later[0]?.outcome).toBe('move')
  })

  it('primeira regra que casa vence; onlyForward; regra desligada é ignorada; notify', () => {
    const custom = [
      {
        id: 'off',
        name: 'off',
        enabled: false,
        trigger: 'pr.opened' as const,
        action: { type: 'move_to_stage' as const, stageId: FIN }
      },
      {
        id: 'fwd',
        name: 'fwd',
        enabled: true,
        trigger: 'pr.opened' as const,
        conditions: { onlyForward: true },
        action: { type: 'move_to_stage' as const, stageId: AND }
      },
      {
        id: 'n',
        name: 'n',
        enabled: true,
        trigger: 'pr.opened' as const,
        action: { type: 'notify' as const, message: 'Oi' }
      }
    ]
    expect(evaluate([ev('pr.opened')], custom, state(PRIO), STAGES)[0]).toMatchObject({
      ruleId: 'fwd',
      outcome: 'move'
    })
    expect(evaluate([ev('pr.opened')], custom, state(REV), STAGES)[0]).toMatchObject({
      ruleId: 'n',
      outcome: 'notify',
      message: 'Oi'
    })
  })
})
