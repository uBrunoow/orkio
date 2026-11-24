import { describe, expect, it } from 'vitest'
import { ALVA_TEMPLATE_IDS } from '../../../../shared/alva-templates'
import { suggestAlvaTargets } from './alva-targets'

const STAGES = [
  { id: 's-plan', name: 'Planejando', role: 'plan' as const },
  { id: 's-dev', name: 'Em andamento', role: 'work' as const },
  { id: 's-rev', name: 'Revisando', role: 'review' as const },
  { id: 's-ok', name: 'Revisado', role: 'reviewed' as const }
]

describe('suggestAlvaTargets', () => {
  it('sem nada ligado: as colunas pelo papel', () => {
    expect(suggestAlvaTargets(STAGES, { templates: [], boundStages: [] })).toEqual({
      plan: 's-plan',
      deliver: 's-dev',
      review: 's-rev',
      reviewed: 's-ok'
    })
  })

  it('coluna com fluxo de outro (ex.: seu "Alva: Revisar") fica sem sugestão', () => {
    expect(
      suggestAlvaTargets(STAGES, { templates: [], boundStages: ['s-rev', 's-ok'] })
    ).toMatchObject({ review: null, reviewed: null, deliver: 's-dev' })
  })

  it('modelo já ligado: continua na coluna dele (mesmo com outro nome)', () => {
    expect(
      suggestAlvaTargets(STAGES, {
        templates: [
          { id: ALVA_TEMPLATE_IDS.review, stageId: 's-ok' },
          { id: ALVA_TEMPLATE_IDS.deliver, stageId: null }
        ],
        boundStages: ['s-ok']
      })
    ).toMatchObject({ review: 's-ok', reviewed: null, deliver: 's-dev' })
  })

  it('antes de saber o que está ligado: pelo papel (o nome não conta)', () => {
    expect(
      suggestAlvaTargets([{ id: 'x', name: 'Code review', role: 'review' }], null)
    ).toMatchObject({ review: 'x', plan: null })
    expect(suggestAlvaTargets([{ id: 'y', name: 'Revisando' }], null).review).toBeNull()
  })
})
