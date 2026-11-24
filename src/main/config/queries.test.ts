import { describe, expect, it } from 'vitest'
import { emptyConfig, type OrkioConfig, type StoredProject } from './orkio-config'
import { automationProjectIds, projectById } from './queries'

const project = (id: string, notion: boolean): StoredProject => ({
  id,
  name: id,
  localPath: `/code/${id}`,
  repo: null,
  createdAt: 'x',
  updatedAt: 'x',
  notionProject: notion ? { id: `n-${id}`, name: id } : null
})

describe('consultas da config', () => {
  it('automações: só projeto com vínculo no Notion E quadro', () => {
    const config: OrkioConfig = {
      ...emptyConfig(),
      projects: [project('a', true), project('b', false), project('c', true)],
      boards: { a: {} as never, b: {} as never }
    }
    expect(automationProjectIds(config)).toEqual(['a'])
    expect(projectById(config, 'c')?.name).toBe('c')
    expect(projectById(config, 'zz')).toBeNull()
  })
})
