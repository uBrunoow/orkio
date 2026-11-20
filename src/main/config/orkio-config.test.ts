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
      automation: { paused: false },
      claudeContexts: {},
      flows: {}
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
    expect(saved['schemaVersion']).toBe(ORKIO_CONFIG_VERSION)
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
    expect(saved['schemaVersion']).toBe(ORKIO_CONFIG_VERSION)
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

  it('migra v4 → v5: contextos do Claude Code começam vazios; inválido é descartado', async () => {
    await writeFile(
      file,
      JSON.stringify({
        schemaVersion: 4,
        projects: [{ ...PROJECT, notionProject: null }],
        notion: NOTION,
        boards: {},
        automation: { paused: true }
      })
    )
    const { data } = await createOrkioConfigStore(file).load()
    expect(data.claudeContexts).toEqual({})
    expect(data.automation.paused).toBe(true)
    const saved = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>
    expect(saved['schemaVersion']).toBe(ORKIO_CONFIG_VERSION)

    const parsed = validateConfig({
      projects: [],
      claudeContexts: {
        ok: {
          instructions: 'Use pnpm',
          notionPages: [{ id: 'p1', name: 'Arquitetura' }, { id: 7 }]
        },
        ruim: { notionPages: [] }
      }
    })
    expect(parsed?.value.claudeContexts).toEqual({
      ok: { instructions: 'Use pnpm', notionPages: [{ id: 'p1', name: 'Arquitetura' }] }
    })
  })

  it('migra v5 → v6: sem fluxos; fluxo inválido e ligação órfã são descartados', async () => {
    await writeFile(
      file,
      JSON.stringify({
        schemaVersion: 5,
        projects: [{ ...PROJECT, notionProject: null }],
        notion: NOTION,
        boards: {},
        automation: { paused: false },
        claudeContexts: {}
      })
    )
    const { data } = await createOrkioConfigStore(file).load()
    expect(data.flows).toEqual({})
    const saved = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>
    expect(saved['schemaVersion']).toBe(ORKIO_CONFIG_VERSION)

    const parsed = validateConfig({
      projects: [],
      flows: {
        p1: {
          flows: [
            {
              id: 'f1',
              name: 'Revisão',
              steps: [
                {
                  id: 'a',
                  name: 'A',
                  type: 'claude_command',
                  command: 'revisar',
                  args: '',
                  timeoutMin: 30
                },
                {
                  id: 'b',
                  name: 'B',
                  type: 'branch',
                  when: { type: 'all', of: [{ type: 'visits', step: 'a', lt: 2 }] },
                  then: 'a'
                }
              ]
            },
            { id: 'ruim', name: 'X', steps: [{ id: 'z', name: 'Z', type: 'teleporte' }] }
          ],
          bindings: [
            { stageId: 's1', flowId: 'f1', enabled: true, mode: 'on_enter' },
            { stageId: 's1', flowId: 'f1', enabled: false, mode: 'manual' },
            { stageId: 's2', flowId: 'ruim', enabled: true, mode: 'manual' }
          ]
        }
      }
    })
    expect(parsed?.value.flows['p1']?.flows.map((f) => f.id)).toEqual(['f1'])
    expect(parsed?.value.flows['p1']?.bindings).toEqual([
      { stageId: 's1', flowId: 'f1', enabled: true, mode: 'on_enter' }
    ])
    expect(parsed?.warning).toContain('1 fluxo(s) de tarefa inválido(s)')
  })

  it('migra v6 → v7: fluxos iguais; campos novos opcionais lidos (includeBriefing, tags, alva)', async () => {
    const flow = {
      id: 'f1',
      name: 'Alva',
      tags: ['alva', 'NÃO VALE'],
      steps: [
        {
          id: 'spec',
          name: 'Spec',
          type: 'claude_command',
          command: 'alva-flow:spec',
          args: '{{alva.spec_arg}}',
          timeoutMin: 60,
          includeBriefing: false
        }
      ]
    }
    await writeFile(
      file,
      JSON.stringify({
        schemaVersion: 6,
        projects: [{ ...PROJECT, notionProject: null }],
        notion: NOTION,
        boards: {},
        automation: { paused: false },
        claudeContexts: {},
        flows: { p1: { flows: [flow], bindings: [], alva: { maxParallel: 9 } } }
      })
    )
    const { data } = await createOrkioConfigStore(file).load()
    const pf = data.flows['p1']!
    expect(pf.flows[0]).toEqual({ ...flow, tags: ['alva'] })
    expect(pf.alva).toEqual({ maxParallel: 4 })
    const saved = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>
    expect(saved['schemaVersion']).toBe(7)
  })
})
