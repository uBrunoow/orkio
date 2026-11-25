import { describe, expect, it } from 'vitest'
import {
  contextTone,
  folderName,
  latestContextPercent,
  latestContextUsage,
  shortTokens,
  usageForModel
} from './environment'

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

describe('medidor de contexto do campo da sessão', () => {
  it('pega o último uso do log com os números', () => {
    expect(
      latestContextUsage([
        { kind: 'usage', inputTokens: 10_000, contextWindow: 200_000 },
        { kind: 'usage', inputTokens: 84_000, contextWindow: 200_000 }
      ])
    ).toEqual({ percent: 42, inputTokens: 84_000, contextWindow: 200_000 })
    expect(latestContextUsage([])).toBeNull()
  })

  it('escreve tokens curtos', () => {
    expect(shortTokens(850)).toBe('850')
    expect(shortTokens(84_300)).toBe('84k')
    expect(shortTokens(1_000_000)).toBe('1M')
    expect(shortTokens(1_250_000)).toBe('1,3M')
  })
})

describe('contexto com outro modelo', () => {
  it('mede a mesma conversa na janela do modelo escolhido', () => {
    const usage = { percent: 42, inputTokens: 84_000, contextWindow: 200_000 }
    expect(usageForModel(usage, 'opus[1m]')).toEqual({
      percent: 8,
      inputTokens: 84_000,
      contextWindow: 1_000_000
    })
    expect(usageForModel(usage, 'sonnet')).toEqual(usage)
  })
})
