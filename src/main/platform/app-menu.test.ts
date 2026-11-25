import { describe, expect, it } from 'vitest'
import { appMenuTemplate } from './app-menu'

const accelerators = (items: ReturnType<typeof appMenuTemplate>): string[] =>
  items.flatMap((i) => [
    ...(typeof i.accelerator === 'string' ? [i.accelerator] : []),
    ...(Array.isArray(i.submenu) ? accelerators(i.submenu) : [])
  ])

describe('appMenuTemplate', () => {
  it('sem o menu padrão: nada de fechar janela nem recarregar fora do dev', () => {
    for (const platform of ['linux', 'win32', 'darwin'] as const) {
      const items = appMenuTemplate({ platform, dev: false })
      const roles = JSON.stringify(items)
      expect(roles).not.toContain('"close"')
      expect(roles).not.toContain('viewMenu')
      expect(roles).not.toContain('windowMenu')
      expect(accelerators(items)).toEqual([])
    }
  })
  it('macOS mantém o menu do app e Editar (copiar/colar); dev ganha Exibir', () => {
    const mac = appMenuTemplate({ platform: 'darwin', dev: false }).map((i) => i.role ?? i.label)
    expect(mac).toEqual(['appMenu', 'editMenu', 'Janela'])
    expect(appMenuTemplate({ platform: 'linux', dev: true }).map((i) => i.role)).toEqual([
      'editMenu',
      'viewMenu'
    ])
  })
})
