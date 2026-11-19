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

describe('orkio-config v2/v3', () => {
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
    expect(data).toEqual({
      projects: [{ ...PROJECT, notionProject: null }],
      notion: null,
      boards: {},
      automation: { paused: false }
    })
    const saved = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>
    expect(saved['schemaVersion']).toBe(ORKIO_CONFIG_VERSION)
    expect(saved['notion']).toBeNull()
  })

  it('migra v2 → v3: acrescenta boards vazio sem mexer no resto', async () => {
    await writeFile(
      file,
      JSON.stringify({
        schemaVersion: 2,
        projects: [{ ...PROJECT, notionProject: null }],
        notion: NOTION
      })
    )
    const { data, warning } = await createOrkioConfigStore(file).load()
    expect(warning).toBeUndefined()
    expect(data.boards).toEqual({})
    expect(data.notion).toEqual(NOTION)
    const saved = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>
    expect(saved['schemaVersion']).toBe(4)
  })

  it('migra v3 → v4: quadros ganham as regras padrão e a pausa global começa desligada', async () => {
    const stage = (id: string, name: string, status: string) => ({
      id,
      name,
      order: 0,
      notionStatus: { id: status, name: status }
    })
    const board = {
      stages: [
        stage('s1', 'Prioridades', 'Prioridades'),
        stage('s2', 'Em andamento', 'Em andamento'),
        stage('s3', 'Revisando', 'Em andamento'),
        stage('s4', 'Revisado', 'Em andamento'),
        stage('s5', 'Finalizada', 'Finalizadas')
      ],
      orkioStageProperty: null,
      blockedProperty: null,
      updatedAt: 'x'
    }
    await writeFile(
      file,
      JSON.stringify({
        schemaVersion: 3,
        projects: [PROJECT],
        notion: NOTION,
        boards: { p1: board }
      })
    )
    const { data, warning } = await createOrkioConfigStore(file).load()
    expect(warning).toBeUndefined()
    expect(data.automation).toEqual({ paused: false })
    const rules = data.boards['p1']!.rules
    expect(rules.map((r) => [r.trigger, r.action])).toContainEqual([
      'pr.merged',
      { type: 'move_to_stage', stageId: 's5' }
    ])
    expect(rules.find((r) => r.id === 'default-rerequest')?.conditions?.fromStages).toEqual(['s4'])
    const saved = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>
    expect(saved['schemaVersion']).toBe(4)
  })

  it('regra inválida é descartada sem perder o quadro', () => {
    const result = validateConfig({
      projects: [],
      notion: null,
      boards: {
        p1: {
          stages: [{ id: 's1', name: 'A', notionStatus: { id: 'o', name: 'A' } }],
          rules: [
            {
              id: 'ok',
              name: 'ok',
              enabled: true,
              trigger: 'pr.merged',
              action: { type: 'move_to_stage', stageId: 's1' }
            },
            {
              id: 'x',
              name: 'x',
              enabled: true,
              trigger: 'pr.hacked',
              action: { type: 'move_to_stage', stageId: 's1' }
            },
            {
              id: 'y',
              name: 'y',
              enabled: true,
              trigger: 'pr.merged',
              action: { type: 'exec', cmd: 'rm' }
            }
          ]
        }
      },
      automation: { paused: true }
    })
    expect(result?.value.boards['p1']?.rules.map((r) => r.id)).toEqual(['ok'])
    expect(result?.value.automation.paused).toBe(true)
  })

  it('quadros: válido é lido; inválido é descartado com aviso', () => {
    const board = {
      stages: [
        {
          id: 's1',
          name: 'Prioridades',
          order: 9,
          notionStatus: { id: 'o1', name: 'Prioridades' },
          color: 'gray'
        },
        {
          id: 's2',
          name: 'Revisando',
          order: 0,
          notionStatus: { id: null, name: 'Em andamento' },
          color: 'neon'
        }
      ],
      orkioStageProperty: { id: 'eo', name: 'Etapa Orkio' },
      blockedProperty: null,
      updatedAt: 'x'
    }
    const result = validateConfig({
      projects: [PROJECT],
      notion: null,
      boards: { p1: board, p2: { stages: [] }, p3: { stages: [{ id: 'a', name: 'x' }] } }
    })
    expect(result?.value.boards['p1']?.stages.map((s) => [s.order, s.color])).toEqual([
      [0, 'gray'],
      [1, undefined]
    ])
    expect(result?.value.boards['p1']?.orkioStageProperty).toEqual({
      id: 'eo',
      name: 'Etapa Orkio'
    })
    expect(Object.keys(result?.value.boards ?? {})).toEqual(['p1'])
    expect(result?.warning).toMatch(/quadro .* descartado/)
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
