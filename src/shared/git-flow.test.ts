import { describe, expect, it } from 'vitest'
import type { AutomationEvent, EventKind } from './automation'
import {
  checkGitFlow,
  countsAsTarget,
  gitFlowBackfill,
  gitFlowForEvents,
  nextGitStage,
  suggestGitFlow,
  type GitFlowConfig,
  type GitFlowPr
} from './git-flow'
import type { NotionPropertySummary } from './notion'

const names = [
  'Branch criada',
  'PR aguardando review',
  'Ajustes solicitados',
  'Mergeada na dev',
  'PR para main aberta',
  'Em produção'
]
const order = names.map((name, i) => ({ id: `o${i}`, name }))
const props: NotionPropertySummary[] = [
  { id: 'title', name: 'Nome', type: 'title' },
  {
    id: 'st',
    name: 'Etapa Git',
    type: 'select',
    options: order.map((o) => ({ ...o, color: 'default' as const }))
  },
  { id: 'pr', name: 'PR', type: 'url' },
  { id: 'dt', name: 'Merge na dev', type: 'date' }
]
const config: GitFlowConfig = {
  stage: { id: 'st', name: 'Etapa Git', type: 'select' },
  options: {
    branch: { id: 'o0', name: names[0]! },
    review: { id: 'o1', name: names[1]! },
    changes: { id: 'o2', name: names[2]! },
    merged: { id: 'o3', name: names[3]! }
  },
  prUrl: { id: 'pr', name: 'PR' },
  mergedAt: { id: 'dt', name: 'Merge na dev' }
}
const withOptions = (
  p: NotionPropertySummary,
  fn: (
    os: NonNullable<NotionPropertySummary['options']>
  ) => NonNullable<NotionPropertySummary['options']>
): NotionPropertySummary => ({ ...p, options: fn(p.options ?? []) })
const at = (name: string | null) => (name ? { name } : null)
const repo = { owner: 'acme', name: 'app' }
const pr = (over: Partial<GitFlowPr> = {}): GitFlowPr => ({
  number: 7,
  url: 'https://github.com/acme/app/pull/7',
  baseRef: 'dev',
  state: 'open',
  closedAt: null,
  changesRequested: false,
  ...over
})
const ev = (kind: EventKind): AutomationEvent => ({ key: kind, kind, taskId: 't', at: null })
const task = (stage: string | null, prUrl: string | null = null) => ({ stage: at(stage), prUrl })

describe('git-flow', () => {
  it('countsAsTarget', () => {
    expect(countsAsTarget('dev')).toBe(true)
    expect(countsAsTarget('main')).toBe(false)
    expect(countsAsTarget('Master')).toBe(false)
    expect(countsAsTarget(null)).toBe(false)
  })

  it('suggestGitFlow', () => {
    expect(suggestGitFlow(props)).toEqual(config)
    expect(suggestGitFlow([props[0]!])).toBeNull()
  })

  it('checkGitFlow', () => {
    const gone = props.map((p) =>
      p.id === 'st' ? withOptions(p, (os) => os.filter((o) => o.id !== 'o2')) : p
    )
    const r = checkGitFlow(config, gone)
    expect(r.config?.options.changes).toBeUndefined()
    expect(r.warnings).toEqual(['A opção "Ajustes solicitados" da Etapa Git não existe mais.'])
    expect(checkGitFlow(config, [props[0]!]).config).toBeNull()
    expect(checkGitFlow(config, [{ id: 'st', name: 'Etapa Git', type: 'text' }]).config).toBeNull()
    const renamed = props.map((p) =>
      p.id === 'st'
        ? withOptions(p, (os) => os.map((o) => (o.id === 'o1' ? { ...o, name: 'Em review' } : o)))
        : p
    )
    const rr = checkGitFlow(config, renamed)
    expect(rr.config?.options.review?.name).toBe('Em review')
    expect(rr.warnings).toEqual([])
  })

  it('nextGitStage', () => {
    const n = (c: string | null, t: Parameters<typeof nextGitStage>[1]) =>
      nextGitStage(at(c), t, config, order)
    expect(n(null, 'branch')).toBe('branch')
    expect(n('PR aguardando review', 'branch')).toBeNull()
    expect(n('PR aguardando review', 'changes')).toBe('changes')
    expect(n('Ajustes solicitados', 'review')).toBe('review')
    expect(n('Mergeada na dev', 'changes')).toBeNull()
    expect(n('Em produção', 'merged')).toBeNull()
    expect(n('Outra coisa', 'merged')).toBeNull()
    expect(nextGitStage(null, 'review', { ...config, options: {} }, order)).toBeNull()
    expect(nextGitStage({ id: 'o1', name: 'x', color: 'red' }, 'merged', config, order)).toBe(
      'merged'
    )
  })

  it('gitFlowForEvents', () => {
    const f = (events: EventKind[], t = task('Branch criada'), p: GitFlowPr | null = pr()) =>
      gitFlowForEvents(events.map(ev), t, p, repo, config, order)
    expect(f(['pr.opened', 'pr.changes_requested', 'pr.review_requested'])).toEqual({
      stage: 'review',
      prUrl: pr().url,
      mergedAt: null
    })
    expect(
      f(['pr.merged'], task('PR aguardando review'), pr({ closedAt: '2026-01-01T10:00:00Z' }))
    ).toEqual({
      stage: 'merged',
      prUrl: pr().url,
      mergedAt: '2026-01-01T10:00:00Z'
    })
    expect(f(['pr.opened', 'pr.merged'], task(null), pr({ baseRef: 'main' }))).toBeNull()
    expect(f(['branch.created'], task(null), null)).toEqual({
      stage: 'branch',
      prUrl: null,
      mergedAt: null
    })
    const other = task('PR aguardando review', 'https://github.com/acme/app/pull/3')
    expect(f(['pr.ready_for_review'], other)?.prUrl).toBe(pr().url)
    const foreign = task('Branch criada', 'https://exemplo.com/x')
    expect(f(['pr.opened'], foreign)).toEqual({ stage: 'review', prUrl: null, mergedAt: null })
    expect(f(['pr.review_requested'], task('PR aguardando review'))).toBeNull()
  })

  it('gitFlowBackfill', () => {
    const b = (p: GitFlowPr | null, hasBranch: boolean, t = task(null)) =>
      gitFlowBackfill(t, p, hasBranch, repo, config, order)
    expect(b(pr({ changesRequested: true }), true)?.stage).toBe('changes')
    expect(b(pr(), true)?.stage).toBe('review')
    expect(b(pr({ state: 'merged', closedAt: 'D' }), true)).toMatchObject({
      stage: 'merged',
      mergedAt: 'D'
    })
    expect(b(pr({ state: 'draft' }), true)?.stage).toBe('branch')
    expect(b(null, true)?.stage).toBe('branch')
    expect(b(null, false)).toBeNull()
    expect(b(null, true, task('PR aguardando review'))).toBeNull()
  })

  it('net change, prUrl independente e bordas', () => {
    const f = (events: EventKind[], t: ReturnType<typeof task>, p: GitFlowPr = pr()) =>
      gitFlowForEvents(events.map(ev), t, p, repo, config, order)
    const same = task('PR aguardando review', pr().url)
    expect(f(['pr.changes_requested', 'pr.review_requested'], same)).toBeNull()
    expect(f(['pr.opened'], task('Em produção'))).toEqual({
      stage: null,
      prUrl: pr().url,
      mergedAt: null
    })
    expect(f(['pr.merged'], task('PR aguardando review', pr().url))).toEqual({
      stage: 'merged',
      prUrl: null,
      mergedAt: null
    })
    expect(
      gitFlowBackfill(task('Ajustes solicitados', pr().url), pr(), true, repo, config, order)
    ).toBeNull()
    expect(gitFlowBackfill(task(null), pr({ state: 'draft' }), true, repo, config, order)).toEqual({
      stage: 'branch',
      prUrl: null,
      mergedAt: null
    })
    const noOptional = props.filter((p) => p.id !== 'pr' && p.id !== 'dt')
    const r = checkGitFlow(config, noOptional)
    expect(r.config?.prUrl).toBeUndefined()
    expect(r.config?.mergedAt).toBeUndefined()
    expect(r.warnings).toHaveLength(2)
  })
})
