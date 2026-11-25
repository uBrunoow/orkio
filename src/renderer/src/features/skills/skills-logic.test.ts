import { describe, expect, it } from 'vitest'
import type { SkillEntry } from '../../../../shared/preferences'
import { groupSkills, groupState, nextDisabled, nextDisabledMany } from './skills-logic'

const skill = (name: string, origin: string, disabled = false): SkillEntry => ({
  name,
  description: `faz ${name}`,
  source: 'user',
  origin,
  disabled
})

describe('groupSkills', () => {
  const list = [skill('a', 'Seu usuário'), skill('b', 'Plugin x'), skill('ção', 'Seu usuário')]
  it('agrupa por origem na ordem em que aparecem', () => {
    expect(groupSkills(list, '').map((g) => [g.origin, g.skills.map((s) => s.name)])).toEqual([
      ['Seu usuário', ['a', 'ção']],
      ['Plugin x', ['b']]
    ])
  })
  it('busca sem acento/caixa por nome, descrição e origem', () => {
    expect(groupSkills(list, 'CAO').flatMap((g) => g.skills.map((s) => s.name))).toEqual(['ção'])
    expect(groupSkills(list, 'plugin').map((g) => g.origin)).toEqual(['Plugin x'])
    expect(groupSkills(list, 'nada')).toEqual([])
  })
})

describe('nextDisabled', () => {
  const list = [skill('a', 'o', true), skill('b', 'o')]
  it('desligar soma à lista completa (com as que sumiram)', () => {
    expect(nextDisabled(list, ['velha'], 'b', false)).toEqual(['a', 'velha', 'b'])
  })
  it('ligar tira da lista; religar uma que sumiu também', () => {
    expect(nextDisabled(list, ['velha'], 'a', true)).toEqual(['velha'])
    expect(nextDisabled(list, ['velha'], 'velha', true)).toEqual(['a'])
  })
  it('não repete', () => {
    expect(nextDisabled(list, [], 'a', false)).toEqual(['a'])
  })
})

describe('origem inteira', () => {
  const s = (name: string, disabled: boolean): SkillEntry => ({
    name,
    description: '',
    source: 'user',
    origin: 'Seu usuário',
    disabled
  })
  it('estado da origem', () => {
    expect(groupState({ origin: 'x', skills: [s('a', false), s('b', false)] })).toBe('on')
    expect(groupState({ origin: 'x', skills: [s('a', true), s('b', false)] })).toBe('partial')
    expect(groupState({ origin: 'x', skills: [s('a', true), s('b', true)] })).toBe('off')
  })
  it('desliga e liga todas, mantendo as outras e as que sumiram', () => {
    const all = [s('a', false), s('b', true), s('c', false)]
    expect(nextDisabledMany(all, ['z'], ['a', 'c'], false)).toEqual(['b', 'z', 'a', 'c'])
    expect(nextDisabledMany(all, ['z'], ['a', 'b'], true)).toEqual(['z'])
  })
})
