import { describe, expect, it } from 'vitest'
import {
  branchTreeUrl,
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

describe('branchTreeUrl', () => {
  const repo = {
    host: 'github.com',
    owner: 'acme',
    name: 'api',
    remoteName: 'origin',
    defaultBranch: 'main',
    visibility: 'unknown',
    canPush: null,
    archived: false,
    verified: false
  } as const
  it('projeto só git local também tem o link da branch', () => {
    expect(branchTreeUrl({ repo: { ...repo, access: 'git' } }, 'feat/ORK-1-a b')).toBe(
      'https://github.com/acme/api/tree/feat/ORK-1-a%20b'
    )
  })
  it('verificado pela API: link; não verificado sem modo git ou Enterprise: nenhum', () => {
    expect(branchTreeUrl({ repo: { ...repo, verified: true } }, 'x')).toBe(
      'https://github.com/acme/api/tree/x'
    )
    expect(branchTreeUrl({ repo }, 'x')).toBeNull()
    expect(branchTreeUrl({ repo: { ...repo, host: 'ghe.acme.com', access: 'git' } }, 'x')).toBeNull()
  })
})
