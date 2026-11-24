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
    expect(EFFORTS.every(isEffort)).toBe(true)
    expect(isEffort('ultra')).toBe(false)
    expect(isEffort(undefined)).toBe(false)
  })

  it('cada nível tem um rótulo próprio', () => {
    const labels = EFFORTS.map((e) => EFFORT_LABELS[e])
    expect(labels.every((l) => l.trim() !== '')).toBe(true)
    expect(new Set(labels).size).toBe(EFFORTS.length)
  })
})

describe('CLAUDE_MODELS e versão', () => {
  it('sugestões: "default" (vira sem --model) e nomes que o próprio Orkio aceita, sem repetir', () => {
    const ids = CLAUDE_MODELS.map((m) => m.id)
    expect(ids).toContain('default')
    expect(ids.filter((id) => id !== 'default').every(isModelName)).toBe(true)
    expect(new Set(ids).size).toBe(ids.length)
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
