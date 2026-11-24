import { describe, expect, it, vi } from 'vitest'
import type { TaskPullRequest } from '../../shared/task-signals'
import { ORKIO_ACTIONS } from '../../shared/orkio-actions'
import { SIGNALS_FAILURE } from './action-helpers'
import { createDeliveryActions, DELIVERY_ACTION_MESSAGES } from './delivery-actions'
import { DeliveryError, type DeliveryService, type PushPreview } from './delivery.service'
import { ApiError } from '../net/http'

const TARGET = {
  owner: 'acme',
  repo: 'app',
  remote: 'origin',
  branch: 'ORK-1/x',
  defaultBranch: 'main',
  displayId: 'ORK-1'
}
const HEAD = 'a'.repeat(40)

function pr(over: Partial<TaskPullRequest> = {}): TaskPullRequest {
  return {
    number: 12,
    title: 't',
    url: 'https://github.com/acme/app/pull/12',
    state: 'open',
    merged: false,
    headRef: 'ORK-1/x',
    headSha: HEAD,
    updatedAt: '2026-11-20T00:00:00Z',
    reviewDecision: 'changes_requested',
    unresolvedComments: 0,
    checks: 'success',
    reviews: [{ id: 'R1', state: 'changes_requested', at: 'x', author: 'ana' }],
    reviewRequests: [{ id: 'Q1', at: 'x', reviewer: 'team:core' }],
    ...over
  }
}

function setup(
  over: {
    preview?: Partial<PushPreview>
    requirePushApproval?: boolean
    pull?: TaskPullRequest | null
    signalsOk?: boolean
    requestReviewers?: () => Promise<void>
  } = {}
) {
  const events: Record<string, unknown>[] = []
  const automation = vi.fn()
  const requestReviewers = vi.fn(over.requestReviewers ?? (async () => undefined))
  const push = vi.fn(async () => ({ commits: 2, branchUrl: 'u', target: TARGET }))
  const delivery = {
    preview: vi.fn(async () => ({
      target: TARGET,
      commits: [{ hash: 'abc1234', subject: 'feat: a' }],
      stat: ' a | 1 +',
      remoteExists: false,
      pending: [],
      problem: null,
      branchUrl: 'u',
      ...over.preview
    })),
    push,
    settings: () => ({ requirePushApproval: over.requirePushApproval ?? true }),
    head: async () => HEAD,
    target: () => ({ ...TARGET, worktree: {} })
  } as unknown as DeliveryService
  const actions = createDeliveryActions({
    delivery,
    signals: async () =>
      over.signalsOk === false
        ? { ok: false, error: { code: 'network', message: 'x' } }
        : {
            ok: true,
            value: {
              signals: {
                t1: {
                  taskId: 't1',
                  displayId: 'ORK-1',
                  localBranches: [],
                  remoteBranches: [],
                  pr: over.pull === undefined ? pr() : over.pull,
                  otherPrs: 0
                }
              },
              github: 'ok',
              local: true,
              messages: [],
              tasksWithoutPrefix: 0,
              fetchedAt: 'x'
            }
          },
    github: { requestReviewers, listCollaborators: async () => ['bia', 'ana'] },
    store: { addEvent: (e) => events.push(e as unknown as Record<string, unknown>) },
    runAutomation: automation
  })
  const get = (id: string) => actions.find((a) => a.id === id)!
  const ctx = { projectId: 'p1', taskId: 't1', vars: {} }
  return { get, ctx, events, automation, requestReviewers, push }
}

describe('ações de entrega', () => {
  it('push: confirmação com commits/stat/destino; sem o ajuste, age direto; histórico com a branch', async () => {
    const s = setup()
    const info = await s.get('push').confirm!(s.ctx)
    expect(info).toMatchObject({
      approveLabel: 'Fazer push',
      details: expect.arrayContaining([{ label: 'Destino', value: 'origin → ORK-1/x' }]),
      commits: [{ hash: 'abc1234', subject: 'feat: a' }],
      stat: ' a | 1 +'
    })
    expect(await setup({ requirePushApproval: false }).get('push').confirm!(s.ctx)).toBeNull()
    expect(await s.get('push').run(s.ctx)).toEqual({ ok: true })
    expect(s.events[0]).toMatchObject({
      kind: 'delivery',
      detail: { action: 'push', by: 'orkio', branch: 'ORK-1/x', owner: 'acme', repo: 'app' }
    })
  })

  it('push: problema na prévia vira falha; erro do git vira mensagem (sem detalhes crus)', async () => {
    const nothing = { code: 'nothing' as const, message: 'Não há commits novos para enviar.' }
    const s = setup({ preview: { problem: nothing } })
    expect(await s.get('push').confirm!(s.ctx)).toEqual({ problem: nothing })
    s.push.mockRejectedValueOnce(new DeliveryError('credentials', 'O git pediu credenciais.'))
    expect(await s.get('push').run(s.ctx)).toEqual({
      ok: false,
      code: 'credentials',
      message: 'O git pediu credenciais.'
    })
    s.push.mockRejectedValueOnce(new Error('stderr cru com https://token@github.com'))
    expect(await s.get('push').run(s.ctx)).toEqual({
      ok: false,
      code: 'push_failed',
      message: DELIVERY_ACTION_MESSAGES.generic
    })
    expect(s.events).toEqual([])
  })

  it('conferir push: compara head.sha da PR com o HEAD do worktree', async () => {
    expect(await setup().get('verify_pushed').run(setup().ctx)).toEqual({
      ok: true,
      vars: { 'pr.exists': 'sim', 'pr.number': '12', 'pr.pushed': 'sim' }
    })
    const old = setup({ pull: pr({ headSha: 'b'.repeat(40) }) })
    expect(await old.get('verify_pushed').run(old.ctx)).toMatchObject({
      vars: { 'pr.pushed': 'nao' }
    })
    const none = setup({ pull: null })
    expect(await none.get('verify_pushed').run(none.ctx)).toMatchObject({
      vars: { 'pr.exists': 'nao', 'pr.pushed': 'nao' }
    })
    const down = setup({ signalsOk: false })
    expect(await down.get('verify_pushed').run(down.ctx)).toEqual({
      ok: false,
      ...SIGNALS_FAILURE
    })
  })

  it('pedir review: quem revisou/foi pedido já vem marcado; POST; histórico com a PR; automação roda', async () => {
    const s = setup()
    const info = await s.get('request_review').confirm!(s.ctx)
    expect(info).toMatchObject({
      input: { options: ['ana', 'team:core', 'bia'], selected: ['ana', 'team:core'] },
      link: { url: 'https://github.com/acme/app/pull/12' }
    })
    expect(await s.get('request_review').run({ ...s.ctx, input: ['ana', 'team:core'] })).toEqual({
      ok: true
    })
    expect(s.requestReviewers).toHaveBeenCalledWith('acme', 'app', 12, {
      users: ['ana'],
      teams: ['core']
    })
    expect(s.events[0]).toMatchObject({
      detail: { action: 'review_request', pr: { number: 12, owner: 'acme', repo: 'app' } }
    })
    expect(s.automation).toHaveBeenCalledWith('p1')
  })

  it('pedir review: ninguém ainda → você escolhe; sem PR → falha clara; 422 → mensagem', async () => {
    const fresh = setup({ pull: pr({ reviews: [], reviewRequests: [] }) })
    const info = await fresh.get('request_review').confirm!(fresh.ctx)
    expect(info).toMatchObject({ input: { selected: [], options: ['bia', 'ana'] } })
    expect(await fresh.get('request_review').run(fresh.ctx)).toEqual({
      ok: false,
      code: 'no_reviewers',
      message: DELIVERY_ACTION_MESSAGES.noReviewers
    })
    const none = setup({ pull: null })
    expect(await none.get('request_review').confirm!(none.ctx)).toEqual({
      problem: { code: 'no_pr', message: DELIVERY_ACTION_MESSAGES.noPr }
    })
    const refused = setup({
      requestReviewers: async () => {
        throw new ApiError('github', 'invalid', 'O GitHub recusou o pedido de review.', 422)
      }
    })
    expect(await refused.get('request_review').run({ ...refused.ctx, input: ['x'] })).toEqual({
      ok: false,
      code: 'github_invalid',
      message: 'O GitHub recusou o pedido de review.'
    })
    expect(refused.automation).not.toHaveBeenCalled()
  })

  it('as variáveis gravadas são só as saídas declaradas da ação (o validador e os modelos usam)', async () => {
    const s = setup()
    for (const action of ['push', 'verify_pushed'] as const) {
      const r = await s.get(action).run(s.ctx)
      const declared = new Set(ORKIO_ACTIONS[action].outputs.map((o) => o.key))
      for (const key of Object.keys(r.ok ? (r.vars ?? {}) : {})) expect(declared).toContain(key)
    }
  })
})
