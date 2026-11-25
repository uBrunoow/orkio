import { describe, expect, it, vi } from 'vitest'
import { emptyConfig, validateConfig, type OrkioConfig } from '../config/orkio-config'
import { SkillsService } from './skills.service'
import { PreferencesService, notificationAllowed } from './preferences.service'
import { DEFAULT_PREFERENCES } from '../../shared/preferences'

function cfg(initial: Partial<OrkioConfig> = {}) {
  let config: OrkioConfig = {
    ...emptyConfig(),
    projects: [
      {
        id: 'p1',
        name: 'App',
        localPath: '/repo',
        repo: null,
        createdAt: 'x',
        updatedAt: 'x',
        notionProject: null
      }
    ],
    ...initial
  }
  return {
    readOnly: false,
    get: () => config,
    update: async (mutate: (c: OrkioConfig) => OrkioConfig) => (config = mutate(config))
  }
}

describe('SkillsService', () => {
  it('lista só as skills, marca as desligadas e mantém as que sumiram', async () => {
    const config = cfg()
    const catalog = vi.fn(async () => [
      {
        id: 'user',
        title: 'Seus comandos',
        source: 'user' as const,
        commands: [
          { name: 'revisar', description: 'cmd', kind: 'command' as const },
          { name: 'escrever', description: 'skill', kind: 'skill' as const }
        ]
      },
      {
        id: 'plugin:alva',
        title: 'alva',
        source: 'plugin' as const,
        commands: [{ name: 'alva:spec', description: 'spec', kind: 'skill' as const }]
      }
    ])
    const skills = new SkillsService({ config, catalog })
    const view = await skills.setDisabled('p1', ['alva:spec', 'velha'])
    expect(catalog).toHaveBeenCalledWith('/repo')
    expect(view.skills).toEqual([
      {
        name: 'escrever',
        description: 'skill',
        source: 'user',
        origin: 'Seu usuário',
        disabled: false
      },
      {
        name: 'alva:spec',
        description: 'spec',
        source: 'plugin',
        origin: 'Plugin alva',
        disabled: true
      }
    ])
    expect(view.missing).toEqual(['velha'])
    expect(skills.disabled('p1')).toEqual(['alva:spec', 'velha'])
    await skills.setDisabled('p1', [])
    expect(config.get()).not.toHaveProperty('skillsDisabled')
    await expect(skills.view('nope')).rejects.toThrow('Projeto não encontrado.')
    await expect(skills.setDisabled('p1', ['$(rm)'])).rejects.toThrow()
  })
})

describe('PreferencesService', () => {
  it('padrão sem nada salvo; salvar junta, normaliza e avisa', async () => {
    const config = cfg()
    const onChange = vi.fn()
    const prefs = new PreferencesService({ config, onChange })
    expect(prefs.get()).toEqual(DEFAULT_PREFERENCES)
    const next = await prefs.save({ autonomy: 'ask', globalShortcut: 'CommandOrControl+Shift+O' })
    expect(next.autonomy).toBe('ask')
    expect(onChange).toHaveBeenCalledWith(next)
    expect(config.get().preferences?.globalShortcut).toBe('CommandOrControl+Shift+O')
    // Acelerador fora da lista fechada não passa.
    const again = await prefs.save({ globalShortcut: 'Alt+F4' as never })
    expect(again.globalShortcut).toBeNull()
  })

  it('avisos: desligados, projeto silenciado e som', () => {
    const p = {
      ...DEFAULT_PREFERENCES,
      notifications: { system: true, sound: false, muted: ['p1'] }
    }
    expect(notificationAllowed(p, 'p1')).toEqual({ show: false, silent: true })
    expect(notificationAllowed(p, 'p2')).toEqual({ show: true, silent: true })
    expect(
      notificationAllowed({ ...p, notifications: { ...p.notifications, system: false } }, 'p2').show
    ).toBe(false)
  })
})

describe('config: campos da Fase 4 (opcionais, sem migração)', () => {
  const base = { projects: [] }
  it('lê o válido e descarta o inválido sem derrubar a config', () => {
    const v = validateConfig({
      ...base,
      vault: [
        {
          name: 'GITHUB_TOKEN',
          note: 'x',
          createdAt: 'a',
          updatedAt: 'b',
          uses: [{ kind: 'mcp', id: 'github' }]
        },
        { name: 'minusculo', createdAt: 'a', updatedAt: 'b' },
        { name: 'SEM_DATA' }
      ],
      mcpServers: [{ id: 'orkio', name: 'x' }, 'lixo'],
      skillsDisabled: { p1: ['a:b'], p2: 'x' },
      preferences: { autonomy: 'ask', globalShortcut: 'Alt+F4' }
    })!.value
    expect(v.vault?.map((s) => s.name)).toEqual(['GITHUB_TOKEN'])
    expect(v.mcpServers).toBeUndefined()
    expect(v.skillsDisabled).toEqual({ p1: ['a:b'] })
    expect(v.preferences?.autonomy).toBe('ask')
    expect(v.preferences?.globalShortcut).toBeNull()
    expect(validateConfig({ ...base })!.value).not.toHaveProperty('vault')
  })
})
