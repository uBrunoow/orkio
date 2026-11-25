/**
 * Texto amigável do atalho global (acelerador do Electron, ex.: `CommandOrControl+Shift+O`) no
 * mesmo jeito dos atalhos do app (`keys.ts`): "Ctrl Shift O" / "⌘ ⇧ O".
 */
export function globalShortcutText(accelerator: string, isMac: boolean): string {
  return accelerator
    .split('+')
    .map((part) => {
      switch (part) {
        case 'CommandOrControl':
        case 'CmdOrCtrl':
          return isMac ? '⌘' : 'Ctrl'
        case 'Control':
        case 'Ctrl':
          return isMac ? '⌃' : 'Ctrl'
        case 'Alt':
        case 'Option':
          return isMac ? '⌥' : 'Alt'
        case 'Shift':
          return isMac ? '⇧' : 'Shift'
        case 'Space':
          return 'Espaço'
        default:
          return part.length === 1 ? part.toUpperCase() : part
      }
    })
    .join(' ')
}
