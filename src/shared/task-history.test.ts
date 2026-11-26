import { describe, expect, it } from 'vitest'
import { activityGroup, parseTaskEvent } from './task-events'
import { describeEvent, prUrl } from './task-history'

/** Como lido do banco (o `detail` passa pelo parser do catálogo). */
const review = (detail: Record<string, unknown>) =>
  parseTaskEvent({
    kind: 'delivery',
    source: 'system',
    fromStage: null,
    toStage: null,
    detail: {
      by: 'orkio',
      action: 'review_post',
      owner: 'acme',
      repo: 'app',
      pr: { number: 7, owner: 'acme', repo: 'app' },
      ...detail
    }
  })!

describe('revisão publicada como orkio[bot] no histórico (Task 18)', () => {
  it('texto com o tipo e link direto para a revisão na PR', () => {
    const e = review({ reviewEvent: 'REQUEST_CHANGES', reviewId: 42 })
    expect(describeEvent(e, () => '')).toBe(
      'Revisão publicada na PR #7 como orkio[bot] (pedir alterações)'
    )
    expect(prUrl(e)).toBe('https://github.com/acme/app/pull/7#pullrequestreview-42')
  })

  it('comentário; sem id válido, o link é o da PR', () => {
    const e = review({ reviewEvent: 'COMMENT', reviewId: 'x' })
    expect(describeEvent(e, () => '')).toContain('(comentário)')
    expect(prUrl(e)).toBe('https://github.com/acme/app/pull/7')
  })
})

describe('revisão pelo gh (projeto só com git local)', () => {
  it('a revisão aparece com o usuário do gh, não como orkio[bot]', () => {
    const e = review({ reviewEvent: 'COMMENT', via: 'gh' })
    expect(describeEvent(e, () => '')).toBe(
      'Revisão publicada na PR #7 com o seu usuário do GitHub (gh) (comentário)'
    )
  })
  it('autor da PR: o Orkio move para Revisado e diz por quê', () => {
    const e = parseTaskEvent({
      kind: 'moved',
      source: 'automation',
      fromStage: 'Revisando',
      toStage: 'Revisado',
      detail: { flow: 'review_self' }
    })!
    expect(describeEvent(e, () => '')).toContain('Revisão com alterações (autor da PR, pelo gh)')
  })
})

describe('Fluxo Git no histórico', () => {
  const gitFlow = (detail: Record<string, unknown>) =>
    parseTaskEvent({
      kind: 'git_flow',
      source: 'automation',
      fromStage: null,
      toStage: null,
      detail
    })!

  it('etapa escrita, recusa e evento sem mudança', () => {
    const wrote = gitFlow({ event: 'pr.merged', stage: 'Mergeada na dev', prNumber: 5 })
    expect(describeEvent(wrote, () => '')).toBe('Etapa Git → Mergeada na dev')
    expect(activityGroup(wrote)).toBe('automation')
    const rejected = gitFlow({ stage: 'Mergeada na dev', rejected: 'o Notion recusou o valor' })
    expect(describeEvent(rejected, () => '')).toBe(
      'O Notion recusou a Etapa Git: o Notion recusou o valor'
    )
    const same = gitFlow({ event: 'pr.opened', reason: 'já estava assim' })
    expect(describeEvent(same, () => '')).toContain('Etapa Git sem mudança (já estava assim)')
    expect(activityGroup(same)).toBeNull()
  })
})
