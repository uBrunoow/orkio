import { describe, expect, it } from 'vitest'
import { SETTINGS_SECTIONS } from '../../app/routes'
import { SETTINGS_GROUPS, settingsScope, visibleSettingsGroups } from './settings-sections'

describe('settings-sections', () => {
  it('cada seção está em exatamente um grupo', () => {
    const all = SETTINGS_GROUPS.flatMap((g) => g.items)
    expect([...all].sort()).toEqual([...SETTINGS_SECTIONS].sort())
  })

  it('sem projeto vinculado, some o grupo do projeto; com projeto, leva o nome', () => {
    expect(visibleSettingsGroups(null, '').map((g) => g.id)).toEqual([
      'basic',
      'connections',
      'tools',
      'app'
    ])
    const withProject = visibleSettingsGroups('Acme', '')
    expect(withProject.find((g) => g.id === 'project')?.title).toBe('Por projeto')
  })

  it('busca por título e palavra-chave, sem acento nem caixa', () => {
    expect(visibleSettingsGroups(null, 'APARENCIA').flatMap((g) => g.items)).toEqual(['appearance'])
    expect(visibleSettingsGroups(null, 'som').flatMap((g) => g.items)).toContain('notifications')
    expect(visibleSettingsGroups(null, 'armazenamento').flatMap((g) => g.items)).toEqual([
      'diagnostics'
    ])
    // Seções do projeto não aparecem sem projeto, nem na busca.
    expect(visibleSettingsGroups(null, 'colunas')).toEqual([])
    expect(visibleSettingsGroups('Acme', 'colunas').flatMap((g) => g.items)).toEqual(['board'])
  })

  it('busca sem resultado = nenhum grupo', () => {
    expect(visibleSettingsGroups('Acme', 'xyzzy')).toEqual([])
  })

  it('escopo: projeto pelo nome; telas com cabeçalho próprio ficam sem', () => {
    expect(settingsScope('board', 'Acme')).toBe('o projeto Acme')
    expect(settingsScope('appearance', null)).toBe('este computador')
    expect(settingsScope('secrets', 'Acme')).toBeNull()
    for (const s of SETTINGS_SECTIONS) {
      if (s !== 'skills' && s !== 'mcp' && s !== 'secrets')
        expect(settingsScope(s, null)).toBeTruthy()
    }
  })
})
