import { describe, expect, it } from 'vitest'
import {
  parsePrWatch,
  prWakeDecision,
  prWakeEvent,
  prWatchOf,
  PR_WAKE_DEBOUNCE_MS,
  type PrWatch
} from './pr-wake'
import type { TaskPullRequest } from './task-signals'

const pr = (over: Partial<TaskPullRequest> = {}): TaskPullRequest => ({
  number: 7,
  title: 'x',
  url: 'https://github.com/a/b/pull/7',
  state: 'open',
  merged: false,
  headRef: 'feat/ORK-1',
  headSha: 'aaa',
  updatedAt: '2026-11-25T00:00:00Z',
  reviewDecision: 'review_required',
  unresolvedComments: 0,
  checks: 'pending',
  reviews: [],
  unresolvedThreadIds: [],
  ...over
})
const w = (over: Partial<TaskPullRequest> = {}): PrWatch => prWatchOf(pr(over))!

describe('a PR acorda o fluxo (puro)', () => {
  it('nada mudou: dorme', () => {
    expect(prWakeEvent(w(), w())).toBeNull()
    expect(prWakeEvent(w(), w({ checks: 'success' }))).toBeNull()
    expect(prWakeEvent(w(), null)).toBeNull()
  })

  it('merge e fechada', () => {
    expect(prWakeEvent(w(), w({ state: 'merged', merged: true }))).toBe('merge')
    expect(prWakeEvent(null, w({ merged: true }))).toBe('merge')
    expect(prWakeEvent(w(), w({ state: 'closed' }))).toBe('fechada')
  })

  it('CI falhou no commit de agora (a falha que já estava não acorda)', () => {
    expect(prWakeEvent(w(), w({ checks: 'failure' }))).toBe('ci_falhou')
    expect(prWakeEvent(w({ checks: 'failure' }), w({ checks: 'failure' }))).toBeNull()
    expect(prWakeEvent(w({ checks: 'failure' }), w({ checks: 'failure', headSha: 'bbb' }))).toBe(
      'ci_falhou'
    )
  })

  it('comentários: review pedindo mudança, thread nova, decisão nova', () => {
    const changes = w({
      reviewDecision: 'changes_requested',
      reviews: [{ id: 'r1', state: 'changes_requested', at: 'x' }]
    })
    expect(prWakeEvent(w(), changes)).toBe('comentarios')
    expect(prWakeEvent(w(), w({ unresolvedThreadIds: ['t1'], unresolvedComments: 1 }))).toBe(
      'comentarios'
    )
    // Sem foto (a PR ainda não estava nos sinais), comentários antigos não acordam.
    expect(prWakeEvent(null, changes)).toBeNull()
    // Comentários vencem o CI (o push da correção roda o CI de novo).
    expect(prWakeEvent(w(), w({ unresolvedThreadIds: ['t1'], checks: 'failure' }))).toBe(
      'comentarios'
    )
  })

  it('outra PR (número novo) compara com nada', () => {
    expect(prWakeEvent(w({ number: 1 }), w({ unresolvedThreadIds: ['t1'] }))).toBeNull()
  })

  it('debounce: acorda só depois de a PR ficar parada; merge acorda na hora', () => {
    const base = w({ checks: 'success' })
    const failing = w({ checks: 'failure' })
    const first = prWakeDecision({ baseline: base, now: failing, seen: null, at: 0 })
    expect(first.kind).toBe('sleep')
    const seen = first.kind === 'sleep' ? first.seen : null
    expect(prWakeDecision({ baseline: base, now: failing, seen, at: 60_000 }).kind).toBe('sleep')
    // Mudou de novo no meio: a contagem recomeça.
    const moved = w({ checks: 'failure', unresolvedComments: 0, headSha: 'ccc' })
    const again = prWakeDecision({ baseline: base, now: moved, seen, at: 90_000 })
    expect(again).toMatchObject({ kind: 'sleep', seen: { since: 90_000 } })
    expect(prWakeDecision({ baseline: base, now: failing, seen, at: PR_WAKE_DEBOUNCE_MS })).toEqual(
      { kind: 'wake', event: 'ci_falhou' }
    )
    expect(prWakeDecision({ baseline: base, now: w({ merged: true }), seen: null, at: 0 })).toEqual(
      { kind: 'wake', event: 'merge' }
    )
  })

  it('comentários com o CI rodando esperam o CI terminar', () => {
    const now = w({ unresolvedThreadIds: ['t1'], checks: 'pending' })
    const first = prWakeDecision({ baseline: w(), now, seen: null, at: 0 })
    const seen = first.kind === 'sleep' ? first.seen : null
    expect(prWakeDecision({ baseline: w(), now, seen, at: 10 * 60_000 }).kind).toBe('sleep')
  })

  it('foto lida do banco é validada', () => {
    expect(parsePrWatch(JSON.parse(JSON.stringify(w())))).toEqual(w())
    expect(parsePrWatch({ number: 'x' })).toBeNull()
    expect(parsePrWatch(null)).toBeNull()
  })
})
