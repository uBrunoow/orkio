import { describe, expect, it } from 'vitest'
import { extractTaskNumbers, mentionsTask, parseDisplayId } from './task-id-match'

describe('extractTaskNumbers', () => {
  it.each([
    ['ORK-142/sync-notion', [142]],
    ['feat/ORK-142-sync', [142]],
    ['ork-142', [142]],
    ['Ork-142', [142]],
    ['fix(ORK-142): corrige sync', [142]],
    ['[ORK-142] Sincronizar', [142]],
    ['ORK-142', [142]],
    ['feature/ork-142_sync', [142]],
    ['ORK-142.ORK-7 e ORK-142', [142, 7]],
    ['merge ORK-1, ORK-2 e ORK-3', [1, 2, 3]],
    ['release/2026-11 ORK-9', [9]]
  ])('%s → %j', (text, expected) => {
    expect(extractTaskNumbers(text, 'ORK')).toEqual(expected)
  })

  it.each([
    'ORK142',
    'ORK_142',
    'ORK 142',
    'XORK-142',
    'ORK-142a',
    'ORK-0142',
    'ORK-',
    'ORKA-142',
    'WORK-142',
    'ork-142x/teste',
    '',
    'nada a ver'
  ])('não casa: %s', (text) => {
    expect(extractTaskNumbers(text, 'ORK')).toEqual([])
  })

  it('ORK-14 e ORK-142 nunca se confundem', () => {
    expect(mentionsTask('feat/ORK-142-sync', 'ORK', 14)).toBe(false)
    expect(mentionsTask('feat/ORK-14-sync', 'ORK', 142)).toBe(false)
    expect(mentionsTask('ORK-1420', 'ORK', 142)).toBe(false)
    expect(mentionsTask('ORK-142', 'ORK', 1)).toBe(false)
    expect(mentionsTask('ORK-14/ORK-142', 'ORK', 14)).toBe(true)
    expect(mentionsTask('ORK-14/ORK-142', 'ORK', 142)).toBe(true)
  })

  it('outro prefixo não casa; prefixo com caracteres especiais é escapado', () => {
    expect(extractTaskNumbers('DEV-142', 'ORK')).toEqual([])
    expect(extractTaskNumbers('A.B-3 AxB-3', 'A.B')).toEqual([3])
    expect(extractTaskNumbers('C++-4', 'C++')).toEqual([4])
    expect(extractTaskNumbers('ORK-1', '')).toEqual([])
    expect(extractTaskNumbers('ORK-1', '  ')).toEqual([])
  })

  it('prefixo em minúsculas no Notion casa com maiúsculas na branch', () => {
    expect(extractTaskNumbers('feat/ORK-5', 'ork')).toEqual([5])
  })

  it('letras acentuadas contam como palavra', () => {
    expect(extractTaskNumbers('éORK-5', 'ORK')).toEqual([])
    expect(extractTaskNumbers('ORK-5é', 'ORK')).toEqual([])
  })

  it('chamadas repetidas não sofrem com lastIndex da regex global', () => {
    for (let i = 0; i < 3; i++) expect(extractTaskNumbers('ORK-8', 'ORK')).toEqual([8])
  })
})

describe('parseDisplayId', () => {
  it('lê prefixo e número', () => {
    expect(parseDisplayId('ORK-142')).toEqual({ prefix: 'ORK', number: 142 })
    expect(parseDisplayId('MY-APP-7')).toEqual({ prefix: 'MY-APP', number: 7 })
  })
  it('sem prefixo ou inválido → null', () => {
    expect(parseDisplayId('142')).toBeNull()
    expect(parseDisplayId(null)).toBeNull()
    expect(parseDisplayId('ORK-')).toBeNull()
  })
})
