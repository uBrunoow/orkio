import { describe, expect, it } from 'vitest'
import { decideRound, idSet, parseReviewRound, roundFile, roundSummary } from './review-rounds'

const ANSWER = `Revisei o diff.

## Bloqueios
- [B-1] src/a.ts:10 — quebra com lista vazia
  (continua aqui)
- **B2**: falta o teste pedido

## Detalhes
- [D-1] src/b.ts:3 — nome confuso
- Nenhum outro

## Evidência
Li o diff e rodei os testes.
Não conferi o build.`

describe('revisão até ficar limpo: leitura da rodada', () => {
  it('lê bloqueios e detalhes com ID estável, continuação e evidência', () => {
    const r = parseReviewRound(ANSWER)!
    expect(r.blockers).toEqual([
      { id: 'B-1', text: 'src/a.ts:10 — quebra com lista vazia (continua aqui)' },
      { id: 'B-2', text: 'falta o teste pedido' }
    ])
    expect(r.details.map((d) => d.id)).toEqual(['D-1'])
    expect(r.evidence).toBe('Li o diff e rodei os testes.\nNão conferi o build.')
  })

  it('"Nenhum" não é achado; sem a seção Bloqueios = fora do formato', () => {
    expect(parseReviewRound('## Bloqueios\n- Nenhum\n\n## Detalhes\n- Nenhum')).toEqual({
      blockers: [],
      details: [],
      evidence: ''
    })
    expect(parseReviewRound('Tudo certo, pode seguir.')).toBeNull()
  })

  it('achado sem ID ganha um ID do texto (o mesmo texto, o mesmo ID)', () => {
    const a = parseReviewRound('## Bloqueios\n- Falta tratar o erro de rede')!
    const b = parseReviewRound('## Bloqueios\n- falta tratar o erro de rede')!
    expect(a.blockers[0]!.id).toMatch(/^B-/)
    expect(a.blockers[0]!.id).toBe(b.blockers[0]!.id)
  })

  it('decide: limpo, corrigir, travado (mesmos IDs) e esgotado (limite)', () => {
    expect(decideRound({ round: 1, max: 3, blockerIds: [], previousIds: '' })).toBe('limpo')
    expect(decideRound({ round: 1, max: 3, blockerIds: ['B-1'], previousIds: '' })).toBe('corrigir')
    expect(
      decideRound({
        round: 2,
        max: 3,
        blockerIds: ['B-2', 'B-1'],
        previousIds: idSet(['B-1', 'B-2'])
      })
    ).toBe('travado')
    expect(decideRound({ round: 2, max: 3, blockerIds: ['B-3'], previousIds: 'B-1' })).toBe(
      'corrigir'
    )
    expect(decideRound({ round: 3, max: 3, blockerIds: ['B-3'], previousIds: 'B-1' })).toBe(
      'esgotado'
    )
  })

  it('resumo da rodada e arquivo com o cabeçalho do Orkio', () => {
    const r = parseReviewRound(ANSWER)!
    expect(roundSummary(2, r, 'corrigir')).toBe(
      'Rodada 2: 2 bloqueios (B-1, B-2), 1 detalhe · volta para correção'
    )
    expect(roundFile(1, 'Revisor', 'texto')).toBe(
      '<!-- Gravado pelo Orkio: revisão, rodada 1 · Revisor. -->\n\ntexto\n'
    )
  })
})
