import { describe, expect, it } from 'vitest'
import type { AlvaPrecheck } from '../../../../shared/alva'
import { missingSteps, projectChecks } from './project-checks'
import type { ProjectView } from '../../../../shared/projects'

const project = (patch: Partial<ProjectView> = {}): ProjectView => ({
  id: 'p1',
  name: 'orkio',
  localPath: '/repo',
  repo: {
    host: 'github.com',
    owner: 'acme',
    name: 'orkio',
    remoteName: 'origin',
    defaultBranch: 'main',
    visibility: 'private',
    canPush: true,
    archived: false,
    verified: true
  } as ProjectView['repo'],
  createdAt: '',
  updatedAt: '',
  local: { branch: 'main', dirty: false },
  health: { state: 'ok' },
  notices: [],
  notionProject: { id: 'n1', name: 'Orkio' },
  ...patch
})

const precheck = (ready: boolean, gh: 'ok' | 'missing'): AlvaPrecheck => ({
  ready,
  pluginVersion: '1.0.25',
  hasDocker: false,
  checkedAt: '',
  items: [{ id: 'gh', label: 'GitHub CLI', state: gh, detail: 'x' }]
})

describe('projectChecks', () => {
  it('projeto pronto', () => {
    const checks = projectChecks({
      project: project(),
      boardStages: 5,
      precheck: precheck(true, 'ok')
    })
    expect(checks.map((c) => [c.id, c.state])).toEqual([
      ['folder', 'ok'],
      ['github', 'ok'],
      ['notion', 'ok'],
      ['board', 'ok'],
      ['alva', 'ok'],
      ['gh', 'ok']
    ])
    expect(checks.find((c) => c.id === 'notion')?.label).toBe('Notion: página "Orkio"')
    expect(checks.find((c) => c.id === 'board')?.label).toBe('Quadro: 5 colunas')
    expect(missingSteps(checks)).toBe(0)
  })

  it('sem Notion e sem quadro faltam 2', () => {
    const checks = projectChecks({
      project: project({ notionProject: null }),
      boardStages: null,
      precheck: null
    })
    expect(checks.find((c) => c.id === 'notion')).toEqual({
      id: 'notion',
      label: 'Sem página no Notion',
      state: 'warning'
    })
    expect(checks.find((c) => c.id === 'board')?.label).toBe('Sem quadro')
    expect(missingSteps(checks)).toBe(2)
  })

  it('pasta sumida é problema', () => {
    const checks = projectChecks({
      project: project({ local: null, health: { state: 'missing_folder' } }),
      boardStages: 5,
      precheck: null
    })
    expect(checks[0]).toEqual({ id: 'folder', label: 'Pasta não encontrada', state: 'problem' })
  })

  it('sem push no GitHub é aviso', () => {
    const p = project()
    const checks = projectChecks({
      project: { ...p, repo: { ...p.repo!, canPush: false } },
      boardStages: 5,
      precheck: null
    })
    expect(checks.find((c) => c.id === 'github')?.state).toBe('warning')
  })

  it('sem precheck não mostra alva nem gh', () => {
    const ids = projectChecks({ project: project(), boardStages: 5, precheck: null }).map(
      (c) => c.id
    )
    expect(ids).toEqual(['folder', 'github', 'notion', 'board'])
  })
})
