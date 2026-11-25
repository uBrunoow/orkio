import { describe, expect, it } from 'vitest'
import { BUILTIN_AGENT_KEYS } from './agent-presets'
import {
  NO_REVIEWER,
  parseColumnSetups,
  parseRunSetup,
  resolveRunSetup,
  reviewerProblem,
  setupOriginText
} from './task-setup'

describe('configuração da tarefa', () => {
  it('a tarefa vence a coluna, que vence o Orkio; cada item diz de onde veio', () => {
    const r = resolveRunSetup({ mode: 'quick' }, { mode: 'approval', evidence: true })
    expect(r.values).toEqual({
      mode: 'quick',
      model: null,
      reviewer: BUILTIN_AGENT_KEYS.reviewer,
      evidence: true
    })
    expect(r.from).toEqual({ mode: 'task', model: 'app', reviewer: 'app', evidence: 'column' })
    expect(setupOriginText(r.from.evidence, 'Em andamento')).toBe('Herdado da coluna Em andamento')
    expect(setupOriginText('task', null)).toBe('Escolhido para esta tarefa')
    expect(setupOriginText('app', 'X')).toBe('Padrão do Orkio')
  })

  it('"ninguém" desliga a revisão; a tarefa pode religar', () => {
    expect(resolveRunSetup(null, { reviewer: NO_REVIEWER }).values.reviewer).toBeNull()
    expect(
      resolveRunSetup({ reviewer: 'repo:ana' }, { reviewer: NO_REVIEWER }).values.reviewer
    ).toBe('repo:ana')
  })

  it('o autor nunca revisa a si mesmo', () => {
    expect(reviewerProblem('repo:ana', 'repo:ana')).toMatch(/não pode revisar/)
    expect(reviewerProblem('repo:ana', 'builtin:revisor')).toBeNull()
    expect(reviewerProblem(null, 'builtin:revisor')).toBeNull()
  })

  it('valida campo a campo (modelo pela mesma regex, agente pela chave)', () => {
    expect(parseRunSetup({})).toEqual({})
    expect(
      parseRunSetup({ mode: 'steps', model: 'opus', reviewer: 'none', evidence: false })
    ).toEqual({
      mode: 'steps',
      model: 'opus',
      reviewer: 'none',
      evidence: false
    })
    expect(parseRunSetup({ mode: 'turbo' })).toBeNull()
    expect(parseRunSetup({ model: 'opus; rm -rf' })).toBeNull()
    expect(parseRunSetup({ reviewer: 'qualquer' })).toBeNull()
    expect(parseRunSetup({ evidence: 'sim' })).toBeNull()
    expect(parseRunSetup('x')).toBeNull()
  })

  it('padrões por coluna: entradas inválidas e vazias somem', () => {
    expect(parseColumnSetups({ a: { mode: 'quick' }, b: { mode: 'nope' }, c: {}, d: 'x' })).toEqual(
      { a: { mode: 'quick' } }
    )
    expect(parseColumnSetups(null)).toEqual({})
  })
})
