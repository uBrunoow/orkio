import { describe, expect, it } from 'vitest'
import { DEFAULT_APPEARANCE, applyAppearance, parseAppearance } from './appearance'

describe('appearance', () => {
  it('lê o salvo e cai no padrão com lixo', () => {
    expect(parseAppearance(null)).toEqual(DEFAULT_APPEARANCE)
    expect(parseAppearance('{')).toEqual(DEFAULT_APPEARANCE)
    expect(parseAppearance('{"motion":"reduce","text":"larger"}')).toEqual({
      motion: 'reduce',
      text: 'larger'
    })
    expect(parseAppearance('{"motion":"fast","text":"huge"}')).toEqual(DEFAULT_APPEARANCE)
  })

  it('aplica no <html> e o padrão tira os atributos', () => {
    const root = { dataset: {} as Record<string, string> } as unknown as HTMLElement
    applyAppearance({ motion: 'reduce', text: 'large' }, root)
    expect(root.dataset).toEqual({ motion: 'reduce', textSize: 'large' })
    applyAppearance(DEFAULT_APPEARANCE, root)
    expect(root.dataset).toEqual({})
  })
})
