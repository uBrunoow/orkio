import { describe, expect, it } from 'vitest'
import { ALVA_TEMPLATE_IDS } from '../../../../shared/alva-templates'
import { suggestAlvaTargets } from './alva-targets'

const STAGES = [
  { id: 's-plan', name: 'Planejando' },
  { id: 's-dev', name: 'Em andamento' },
  { id: 's-rev', name: 'Revisando' },
  { id: 's-ok', name: 'Revisado' }
]

describe('suggestAlvaTargets', () => {
  it('sem nada ligado: as colunas pelo nome', () => {
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

  it('antes de saber o que está ligado: pelo nome', () => {
    expect(suggestAlvaTargets([{ id: 'x', name: 'revisando' }], null)).toMatchObject({
      review: 'x',
      plan: null
    })
  })
})
