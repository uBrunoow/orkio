import { describe, expect, it } from 'vitest'
import {
  CLAUDE_MODELS,
  EFFORT_LABELS,
  EFFORTS,
  isEffort,
  isModelName,
  resolveRuntime,
  runtimeLabel
} from './agent-runtime'

describe('resolveRuntime', () => {
  it('o primeiro valor definido de cada campo vence', () => {
    expect(resolveRuntime({ model: 'opus' }, { model: 'sonnet', effort: 'high' })).toEqual({
      model: 'opus',
      effort: 'high'
    })
  })

  it("'default' vira null (não passa a flag)", () => {
    expect(resolveRuntime({ model: 'default' }, { model: 'sonnet' })).toEqual({
      model: null,
      effort: null
    })
  })

  it('camadas nulas ou ausentes resultam em padrão', () => {
    expect(resolveRuntime(null, undefined)).toEqual({ model: null, effort: null })
  })

  it('null em uma camada conta como valor definido (vence)', () => {
    expect(resolveRuntime({ model: null, effort: null }, { model: 'opus', effort: 'low' })).toEqual(
      {
        model: null,
        effort: null
      }
    )
  })
})

describe('isModelName', () => {
  it('aceita aliases e nomes com colchetes', () => {
    expect(isModelName('claude-sonnet-5-5[1m]')).toBe(true)
    expect(isModelName('default')).toBe(true)
    expect(isModelName('opus')).toBe(true)
  })

  it('recusa flags, espaços, shell e vazio', () => {
    expect(isModelName('--model')).toBe(false)
    expect(isModelName('--dangerously-skip-permissions')).toBe(false)
    expect(isModelName('a b')).toBe(false)
    expect(isModelName('x;rm')).toBe(false)
    expect(isModelName('')).toBe(false)
    expect(isModelName(42)).toBe(false)
  })

  it('recusa nomes com mais de 61 caracteres', () => {
    expect(isModelName('a'.repeat(61))).toBe(true)
    expect(isModelName('a'.repeat(62))).toBe(false)
  })
})

describe('isEffort', () => {
  it('aceita os cinco níveis e recusa o resto', () => {
    expect(isEffort('xhigh')).toBe(true)
    expect(EFFORTS).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
    expect(isEffort('ultra')).toBe(false)
    expect(isEffort(undefined)).toBe(false)
  })

  it('rótulos em pt-BR', () => {
    expect(EFFORT_LABELS).toEqual({
      low: 'Baixo',
      medium: 'Médio',
      high: 'Alto',
      xhigh: 'Muito alto',
      max: 'Máximo'
    })
  })
})

describe('CLAUDE_MODELS e versão', () => {
  it('lista os modelos sugeridos com rótulos', () => {
    expect(CLAUDE_MODELS).toEqual([
      { id: 'default', label: 'Padrão do Claude Code' },
      { id: 'fable', label: 'Fable' },
      { id: 'opus', label: 'Opus' },
      { id: 'sonnet', label: 'Sonnet' },
      { id: 'haiku', label: 'Haiku' }
    ])
  })
})

describe('runtimeLabel', () => {
  it('modelo e raciocínio', () => {
    expect(runtimeLabel({ model: 'opus', effort: 'high' })).toBe('Opus · Alto')
  })

  it('padrão do Claude Code sem nada', () => {
    expect(runtimeLabel({ model: null, effort: null })).toBe('Padrão do Claude Code')
  })

  it('só raciocínio usa o padrão de modelo', () => {
    expect(runtimeLabel({ model: null, effort: 'high' })).toBe('Padrão do Claude Code · Alto')
  })

  it('nome livre aparece como está', () => {
    expect(runtimeLabel({ model: 'claude-sonnet-5-5[1m]', effort: null })).toBe(
      'claude-sonnet-5-5[1m]'
    )
    expect(runtimeLabel({ model: 'claude-sonnet-5-5[1m]', effort: 'max' })).toBe(
      'claude-sonnet-5-5[1m] · Máximo'
    )
  })
})
