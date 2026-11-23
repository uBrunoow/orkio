import { describe, expect, it } from 'vitest'
import {
  buildTaskSignals,
  diffSignals,
  type PullRequestSummary,
  type SignalSources,
  type TaskSignals
} from './task-signals'

const pr = (n: number, over: Partial<PullRequestSummary> = {}): PullRequestSummary => ({
  number: n,
  title: `PR ${n}`,
  url: `https://github.com/acme/app/pull/${n}`,
  state: 'open',
  merged: false,
  headRef: `branch-${n}`,
  updatedAt: '2026-11-10T00:00:00Z',
  ...over
})

const TASKS = [
  { id: 't142', displayId: 'ORK-142' },
  { id: 't14', displayId: 'ORK-14' },
  { id: 't1', displayId: 'ORK-1' },
  { id: 'tnum', displayId: '7' },
  { id: 'tnull', displayId: null }
]

function sources(over: Partial<SignalSources> = {}): SignalSources {
  return { localBranches: [], remoteBranches: [], pulls: [], details: new Map(), ...over }
}

describe('buildTaskSignals', () => {
  it('branches locais e remotas na tarefa certa, sem confundir IDs parecidos', () => {
    const s = buildTaskSignals(
      TASKS,
      sources({
        localBranches: ['ORK-142/sync', 'feat/ORK-14-login', 'main', '7-fix'],
        remoteBranches: ['ORK-142/sync', 'ork-1-docs']
      })
    )
    expect(s['t142']).toMatchObject({
      localBranches: ['ORK-142/sync'],
      remoteBranches: ['ORK-142/sync']
    })
    expect(s['t14']).toMatchObject({ localBranches: ['feat/ORK-14-login'], remoteBranches: [] })
    expect(s['t1']).toMatchObject({ localBranches: [], remoteBranches: ['ork-1-docs'] })
    // Sem prefixo no ID → sem sinais.
    expect(s['tnum']).toBeUndefined()
    expect(s['tnull']).toBeUndefined()
  })

  it('PR casa pelo título ou pela branch; principal = aberta > rascunho > mergeada > fechada', () => {
    const s = buildTaskSignals(
      TASKS,
      sources({
        pulls: [
          pr(1, { title: 'ORK-142 primeira tentativa', state: 'closed' }),
          pr(2, { title: 'Sync', headRef: 'feat/ORK-142-sync', state: 'merged', merged: true }),
          pr(3, { title: '[ORK-142] nova', state: 'draft' }),
          pr(4, { title: 'ORK-14 login' })
        ],
        details: new Map([[3, { reviewDecision: null, unresolvedComments: 2, checks: 'pending' }]])
      })
    )
    expect(s['t142']?.pr).toMatchObject({
      number: 3,
      state: 'draft',
      unresolvedComments: 2,
      checks: 'pending'
    })
    expect(s['t142']?.otherPrs).toBe(2)
    expect(s['t14']?.pr?.number).toBe(4)
    expect(s['t14']?.pr?.reviewDecision).toBeNull()
    expect(s['t1']?.pr).toBeNull()
  })

  it('empate de estado → atualizada mais recentemente', () => {
    const s = buildTaskSignals(
      TASKS,
      sources({
        pulls: [
          pr(10, { title: 'ORK-1 a', state: 'merged', updatedAt: '2026-11-01T00:00:00Z' }),
          pr(11, { title: 'ORK-1 b', state: 'merged', updatedAt: '2026-11-05T00:00:00Z' })
        ]
      })
    )
    expect(s['t1']?.pr?.number).toBe(11)
  })

  it('fontes indisponíveis (null) viram listas vazias', () => {
    const s = buildTaskSignals(
      TASKS,
      sources({ remoteBranches: null, pulls: null, localBranches: ['ORK-1'] })
    )
    expect(s['t1']).toMatchObject({ localBranches: ['ORK-1'], remoteBranches: [], pr: null })
  })

  it('PR que cita duas tarefas aparece nas duas', () => {
    const s = buildTaskSignals(TASKS, sources({ pulls: [pr(5, { title: 'ORK-1 e ORK-14' })] }))
    expect(s['t1']?.pr?.number).toBe(5)
    expect(s['t14']?.pr?.number).toBe(5)
    expect(s['t142']?.pr).toBeNull()
  })
})

describe('diffSignals', () => {
  const base = (over: Partial<TaskSignals> = {}): TaskSignals => ({
    taskId: 't',
    displayId: 'ORK-1',
    localBranches: [],
    remoteBranches: [],
    pr: null,
    otherPrs: 0,
    ...over
  })
  const withPr = (over: Partial<NonNullable<TaskSignals['pr']>> = {}) =>
    base({
      pr: {
        ...pr(1),
        reviewDecision: 'review_required',
        unresolvedComments: 0,
        checks: 'pending',
        ...over
      }
    })

  it('primeira observação não gera eventos', () => {
    expect(diffSignals({}, { t: withPr() })).toEqual([])
  })

  it('branches criadas e apagadas', () => {
    expect(
      diffSignals(
        { t: base({ localBranches: ['a'] }) },
        { t: base({ localBranches: ['b'], remoteBranches: ['b'] }) }
      )
    ).toEqual([
      { kind: 'branch_created', taskId: 't', branch: 'b', where: 'local' },
      { kind: 'branch_deleted', taskId: 't', branch: 'a', where: 'local' },
      { kind: 'branch_created', taskId: 't', branch: 'b', where: 'remote' }
    ])
  })

  it('ciclo da PR: aberta, pronta para review, revisão, checks, merge', () => {
    expect(diffSignals({ t: base() }, { t: withPr({ state: 'draft' }) })).toEqual([
      { kind: 'pr_opened', taskId: 't', number: 1, draft: true }
    ])
    expect(diffSignals({ t: withPr({ state: 'draft' }) }, { t: withPr() })).toEqual([
      { kind: 'pr_ready_for_review', taskId: 't', number: 1 }
    ])
    expect(
      diffSignals({ t: withPr() }, { t: withPr({ reviewDecision: 'approved', checks: 'success' }) })
    ).toEqual([
      { kind: 'review_changed', taskId: 't', number: 1, from: 'review_required', to: 'approved' },
      { kind: 'checks_changed', taskId: 't', number: 1, from: 'pending', to: 'success' }
    ])
    expect(diffSignals({ t: withPr() }, { t: withPr({ state: 'merged', merged: true }) })).toEqual([
      { kind: 'pr_merged', taskId: 't', number: 1 }
    ])
    expect(diffSignals({ t: withPr() }, { t: withPr({ state: 'closed' }) })).toEqual([
      { kind: 'pr_closed', taskId: 't', number: 1 }
    ])
    expect(diffSignals({ t: withPr({ state: 'closed' }) }, { t: withPr() })).toEqual([
      { kind: 'pr_reopened', taskId: 't', number: 1 }
    ])
  })

  it('detalhe indisponível (null) não conta como mudança', () => {
    expect(
      diffSignals(
        { t: withPr({ reviewDecision: null }) },
        { t: withPr({ reviewDecision: 'approved' }) }
      )
    ).toEqual([])
  })

  it('PR principal trocada por uma já mergeada', () => {
    expect(
      diffSignals({ t: withPr({ number: 1 }) }, { t: withPr({ number: 2, state: 'merged' }) })
    ).toEqual([{ kind: 'pr_merged', taskId: 't', number: 2 }])
  })
})

describe('buildTaskSignals: tarefa sem ID no nome da branch', () => {
  const PAGE = '1a2b3c4d-5e6f-4071-8293-a4b5c6d7e8f9'
  const none = { localBranches: [], remoteBranches: [], pulls: [], details: new Map() }

  it('branch registrada para a tarefa casa pelo nome exato, e a PR dela também', () => {
    const r = buildTaskSignals([{ id: PAGE, displayId: null, branches: ['feat/listar-pedidos'] }], {
      ...none,
      localBranches: ['feat/listar-pedidos', 'feat/listar-pedidos-2', 'main'],
      remoteBranches: ['feat/listar-pedidos'],
      pulls: [pr(9, { headRef: 'feat/listar-pedidos', title: 'Listar pedidos' })]
    })
    expect(r[PAGE]).toMatchObject({
      displayId: null,
      localBranches: ['feat/listar-pedidos'],
      remoteBranches: ['feat/listar-pedidos'],
      pr: { number: 9 }
    })
  })

  it('PR com o link da página do Notion no corpo casa mesmo sem branch registrada', () => {
    const r = buildTaskSignals([{ id: PAGE, displayId: null }], {
      ...none,
      pulls: [
        pr(12, { headRef: 'qualquer-coisa', notionPageIds: ['1a2b3c4d5e6f40718293a4b5c6d7e8f9'] })
      ]
    })
    expect(r[PAGE]?.pr?.number).toBe(12)
  })

  it('sem ID, sem branch registrada e sem link: nada (não adivinha)', () => {
    const r = buildTaskSignals([{ id: PAGE, displayId: null }], {
      ...none,
      localBranches: ['feat/listar-pedidos'],
      pulls: [pr(3, { headRef: 'feat/listar-pedidos' })]
    })
    expect(r[PAGE]).toBeUndefined()
  })

  it('com ID, os três caminhos somam sem repetir a PR', () => {
    const r = buildTaskSignals([{ id: 'p1', displayId: 'ORK-7', branches: ['feat/sem-id'] }], {
      ...none,
      localBranches: ['feat/ORK-7-x', 'feat/sem-id'],
      pulls: [pr(4, { headRef: 'feat/sem-id', title: 'ORK-7 x' })]
    })
    expect(r['p1']?.localBranches).toEqual(['feat/ORK-7-x', 'feat/sem-id'])
    expect(r['p1']?.otherPrs).toBe(0)
  })
})
