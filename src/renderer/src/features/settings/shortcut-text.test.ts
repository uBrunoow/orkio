import { describe, expect, it } from 'vitest'
import { GLOBAL_SHORTCUTS } from '../../../../shared/preferences'
import { globalShortcutText } from './shortcut-text'

describe('globalShortcutText', () => {
  it('Ctrl no Windows/Linux, símbolos no macOS', () => {
    expect(globalShortcutText('CommandOrControl+Shift+O', false)).toBe('Ctrl Shift O')
    expect(globalShortcutText('CommandOrControl+Shift+O', true)).toBe('⌘ ⇧ O')
    expect(globalShortcutText('CommandOrControl+Alt+O', true)).toBe('⌘ ⌥ O')
    expect(globalShortcutText('CommandOrControl+Shift+Space', false)).toBe('Ctrl Shift Espaço')
  })

  it('toda opção da lista fechada tem texto sem o nome técnico', () => {
    for (const s of GLOBAL_SHORTCUTS) {
      expect(globalShortcutText(s, false)).not.toMatch(/CommandOrControl/)
    }
  })
})
