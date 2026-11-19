import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ORKIO_CONFIG_VERSION, createOrkioConfigStore, validateConfig } from './orkio-config'

const PROJECT = {
  id: 'p1',
  name: 'orkio',
  localPath: '/code/orkio',
  repo: null,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z'
}

const NOTION = {
  projectsDataSource: { id: 'ds-proj', name: 'Projetos' },
  tasksDataSource: { id: 'ds-tasks', name: 'Tarefas' },
  mapping: {
    title: { id: 'title', name: 'Nome', type: 'title' },
    status: { id: 'st', name: 'Status', type: 'status' },
    uniqueId: { id: 'uid', name: 'ID', type: 'unique_id' },
    project: { id: 'rel', name: 'Projeto', type: 'relation' },
    priority: { id: 'pri', name: 'Prioridade', type: 'select' }
  },
  updatedAt: '2026-11-19T00:00:00.000Z'
}

describe('orkio-config v2', () => {
  let dir: string
  let file: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'orkio-config-'))
    file = join(dir, 'orkio-config.json')
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('migra v1 → v2: notion null e projetos sem vínculo, mantendo os dados', async () => {
    await writeFile(file, JSON.stringify({ schemaVersion: 1, projects: [PROJECT] }))
    const store = createOrkioConfigStore(file)
    const { data, warning } = await store.load()
    expect(warning).toBeUndefined()
    expect(data).toEqual({ projects: [{ ...PROJECT, notionProject: null }], notion: null })
    const saved = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>
    expect(saved['schemaVersion']).toBe(ORKIO_CONFIG_VERSION)
    expect(saved['notion']).toBeNull()
  })

  it('lê a configuração do Notion e o vínculo do projeto', async () => {
    const linked = { ...PROJECT, notionProject: { id: 'page-1', name: 'Orkio' } }
    await writeFile(file, JSON.stringify({ schemaVersion: 2, projects: [linked], notion: NOTION }))
    const { data } = await createOrkioConfigStore(file).load()
    expect(data.notion).toEqual(NOTION)
    expect(data.projects[0]?.notionProject).toEqual({ id: 'page-1', name: 'Orkio' })
  })

  it('configuração do Notion quebrada vira "não configurado" com aviso, sem perder projetos', () => {
    const broken = { ...NOTION, mapping: { ...NOTION.mapping, uniqueId: { id: 'uid' } } }
    const result = validateConfig({ projects: [PROJECT], notion: broken })
    expect(result?.value.notion).toBeNull()
    expect(result?.value.projects).toHaveLength(1)
    expect(result?.warning).toMatch(/bancos do Notion .* refeita/)
  })

  it('opcional inválido é ignorado; vínculo inválido vira null', () => {
    const result = validateConfig({
      projects: [{ ...PROJECT, notionProject: { id: 42 } }],
      notion: { ...NOTION, mapping: { ...NOTION.mapping, priority: 'x' } }
    })
    expect(result?.value.notion?.mapping.priority).toBeUndefined()
    expect(result?.value.projects[0]?.notionProject).toBeNull()
    expect(result?.warning).toBeUndefined()
  })
})
