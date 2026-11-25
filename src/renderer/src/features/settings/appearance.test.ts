import { describe, expect, it } from 'vitest'
import { DEFAULT_APPEARANCE, applyAppearance, parseAppearance, resolvedTheme } from './appearance'

function fakeRoot(): HTMLElement {
  const classes = new Set<string>()
  return {
    dataset: {} as Record<string, string>,
    classList: {
      toggle: (c: string, on: boolean) => (on ? classes.add(c) : classes.delete(c)),
      contains: (c: string) => classes.has(c)
    }
  } as unknown as HTMLElement
}

describe('appearance', () => {
  it('lê o salvo e cai no padrão com lixo, campo a campo', () => {
    expect(parseAppearance(null)).toEqual(DEFAULT_APPEARANCE)
    expect(parseAppearance('{')).toEqual(DEFAULT_APPEARANCE)
    // O formato antigo (só movimento e texto) continua valendo.
    expect(parseAppearance('{"motion":"reduce","text":"larger"}')).toEqual({
      ...DEFAULT_APPEARANCE,
      motion: 'reduce',
      text: 'larger'
    })
    expect(parseAppearance('{"motion":"fast","text":"huge","theme":"neon"}')).toEqual(
      DEFAULT_APPEARANCE
    )
    expect(parseAppearance('{"theme":"light","wallpaper":"ember","tracking":"wide"}')).toEqual({
      ...DEFAULT_APPEARANCE,
      theme: 'light',
      wallpaper: 'ember',
      tracking: 'wide'
    })
  })

  it('aplica no <html>; o padrão tira os atributos e deixa a classe dark', () => {
    const root = fakeRoot()
    applyAppearance(
      {
        ...DEFAULT_APPEARANCE,
        motion: 'reduce',
        text: 'large',
        theme: 'light',
        uiFont: 'geist',
        wallpaper: 'mesh'
      },
      root
    )
    expect(root.dataset).toEqual({
      theme: 'light',
      motion: 'reduce',
      textSize: 'large',
      uiFont: 'geist',
      wallpaper: 'mesh'
    })
    expect(root.classList.contains('dark')).toBe(false)
    applyAppearance(DEFAULT_APPEARANCE, root)
    expect(root.dataset).toEqual({})
    expect(root.classList.contains('dark')).toBe(true)
  })

  it('"Sistema" segue a preferência do sistema', () => {
    expect(resolvedTheme('system', () => true)).toBe('light')
    expect(resolvedTheme('system', () => false)).toBe('dark')
    expect(resolvedTheme('light', () => false)).toBe('light')
  })
})
