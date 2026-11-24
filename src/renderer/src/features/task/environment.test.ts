import { describe, expect, it } from 'vitest'
import { contextTone, folderName, latestContextPercent } from './environment'

describe('painel Ambiente', () => {
  it('nome curto da pasta', () => {
    expect(folderName('/home/u/.config/orkio/worktrees/p1/ORK-142')).toBe('ORK-142')
    expect(folderName('C:\\u\\wt\\ORK-1\\')).toBe('ORK-1')
  })
  it('contexto vem do último usage; log antigo = escondido', () => {
    expect(
      latestContextPercent([
        { kind: 'usage', inputTokens: 20_000, contextWindow: 200_000 },
        { kind: 'text', text: 'oi' },
        { kind: 'usage', inputTokens: 82_000, contextWindow: 200_000 }
      ])
    ).toBe(41)
    expect(latestContextPercent([{ kind: 'text', text: 'oi' }])).toBeNull()
  })
  it('tom da barra', () => {
    expect([10, 70, 95].map(contextTone)).toEqual(['ok', 'warn', 'danger'])
  })
})
