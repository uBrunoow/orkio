import { describe, expect, it } from 'vitest'
import { globalShortcut, type KeyInput } from './shortcuts'

const key = (k: string, extra: Partial<KeyInput> = {}): KeyInput => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  inTextField: false,
  ...extra
})

describe('globalShortcut', () => {
  it('Ctrl+K abre a paleta (Cmd+K no Mac), mesmo dentro de um campo', () => {
    expect(globalShortcut(key('k', { ctrlKey: true, inTextField: true }), false)).toEqual({
      type: 'palette'
    })
    expect(globalShortcut(key('k', { metaKey: true }), true)).toEqual({ type: 'palette' })
    expect(globalShortcut(key('k', { metaKey: true }), false)).toBeNull()
  })

  it('Ctrl+número segue a ordem do menu', () => {
    const go = (n: string): unknown => globalShortcut(key(n, { ctrlKey: true }), false)
    expect(go('1')).toEqual({ type: 'navigate', route: { name: 'overview' } })
    expect(go('2')).toEqual({ type: 'navigate', route: { name: 'board' } })
    expect(go('3')).toEqual({ type: 'navigate', route: { name: 'automations' } })
    expect(go('6')).toEqual({ type: 'navigate', route: { name: 'projects' } })
    expect(go('7')).toEqual({ type: 'navigate', route: { name: 'integrations' } })
    expect(globalShortcut(key('9', { ctrlKey: true }), false)).toBeNull()
  })

  it('Voltar: Ctrl+[ sempre; Alt+← fora de campos de texto', () => {
    expect(globalShortcut(key('[', { ctrlKey: true }), false)).toEqual({ type: 'back' })
    expect(globalShortcut(key('ArrowLeft', { altKey: true }), false)).toEqual({ type: 'back' })
    expect(globalShortcut(key('ArrowLeft', { altKey: true, inTextField: true }), false)).toBeNull()
  })

  it('"?" abre a paleta, menos ao digitar', () => {
    expect(globalShortcut(key('?', { shiftKey: true }), false)).toEqual({ type: 'palette' })
    expect(globalShortcut(key('?', { shiftKey: true, inTextField: true }), false)).toBeNull()
  })
})
