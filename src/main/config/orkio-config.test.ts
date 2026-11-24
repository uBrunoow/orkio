import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ALVA_TEMPLATE_IDS,
  alvaReviewedFlow,
  alvaReviewPublishFlow
} from '../../shared/alva-templates'
import { parseStep } from '../../shared/task-flow'
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
      flows: {},
      delivery: {},
      agents: {},
      orchestrator: {},
      updates: { channel: 'stable', lastSeenVersion: null, lastCheckAt: null }
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
    const broken = { ...NOTION, mapping: { ...NOTION.mapping, status: { id: 'st' } } }
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

  it('migra v12 → v13: o contexto do projeto do Claude Code (sem leitor) sai do arquivo', async () => {
    await writeFile(
      file,
      JSON.stringify({
        schemaVersion: 12,
        projects: [{ ...PROJECT, notionProject: null }],
        notion: NOTION,
        boards: {},
        automation: { paused: true },
        claudeContexts: {
          p1: { instructions: 'Use pnpm', notionPages: [{ id: 'p1', name: 'Arquitetura' }] }
        },
        flows: {},
        delivery: {},
        agents: {},
        orchestrator: {},
        updates: { channel: 'stable', lastSeenVersion: null, lastCheckAt: null }
      })
    )
    const { data } = await createOrkioConfigStore(file).load()
    expect(data).not.toHaveProperty('claudeContexts')
    expect(data.automation.paused).toBe(true)
    const saved = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>
    expect(saved['schemaVersion']).toBe(13)
    expect(saved).not.toHaveProperty('claudeContexts')
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
    expect(saved['schemaVersion']).toBe(ORKIO_CONFIG_VERSION)
  })

  it('v7 → v8: ajustes de entrega vazios (padrão: aprovação para push); inválidos ignorados', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'orkio-cfg-v8-'))
    const file = join(dir, 'orkio-config.json')
    await writeFile(
      file,
      JSON.stringify({
        schemaVersion: 7,
        projects: [{ ...PROJECT, notionProject: null }],
        notion: null,
        boards: {},
        automation: { paused: false },
        claudeContexts: {},
        flows: {}
      })
    )
    const { data } = await createOrkioConfigStore(file).load()
    expect(data.delivery).toEqual({})
    const saved = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>
    expect(saved['schemaVersion']).toBe(ORKIO_CONFIG_VERSION)
    expect(saved['delivery']).toEqual({})

    await writeFile(
      file,
      JSON.stringify({
        ...saved,
        delivery: { p1: { requirePushApproval: false }, p2: { requirePushApproval: 'nao' } }
      })
    )
    const again = await createOrkioConfigStore(file).load()
    expect(again.data.delivery).toEqual({ p1: { requirePushApproval: false } })
  })

  it('v8 → v9: canal Estável e nenhuma versão vista ainda', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'orkio-cfg-v9-'))
    const file = join(dir, 'orkio-config.json')
    const v8 = {
      schemaVersion: 8,
      projects: [{ ...PROJECT, notionProject: null }],
      notion: null,
      boards: {},
      automation: { paused: false },
      claudeContexts: {},
      flows: {},
      delivery: { p1: { requirePushApproval: false } }
    }
    await writeFile(file, JSON.stringify(v8))
    const { data } = await createOrkioConfigStore(file).load()
    expect(data.updates).toEqual({ channel: 'stable', lastSeenVersion: null, lastCheckAt: null })
    expect(data.delivery).toEqual(v8.delivery)
    expect(data.projects).toHaveLength(1)
    const saved = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>
    expect(saved['schemaVersion']).toBe(ORKIO_CONFIG_VERSION)
    expect(data.agents).toEqual({})

    // Inválido volta ao padrão sem derrubar o resto.
    await writeFile(
      file,
      JSON.stringify({ ...saved, updates: { channel: 'nightly', lastSeenVersion: 3 } })
    )
    const again = await createOrkioConfigStore(file).load()
    expect(again.data.updates).toEqual({
      channel: 'stable',
      lastSeenVersion: null,
      lastCheckAt: null
    })
    expect(again.data.projects).toHaveLength(1)
  })

  it('instalação nova começa sem versão vista (nada a mostrar no "O que há de novo")', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'orkio-cfg-new-'))
    const { data } = await createOrkioConfigStore(join(dir, 'orkio-config.json')).load()
    expect(data.updates.lastSeenVersion).toBeNull()
  })

  it('v9 → v10: regras de agentes vazias; regras inválidas ou repetidas são ignoradas', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'orkio-cfg-v10-'))
    const file = join(dir, 'orkio-config.json')
    await writeFile(
      file,
      JSON.stringify({
        schemaVersion: 9,
        projects: [{ ...PROJECT, notionProject: null }],
        notion: null,
        boards: {},
        automation: { paused: false },
        claudeContexts: {},
        flows: {},
        delivery: {},
        updates: { channel: 'stable', lastSeenVersion: null, lastCheckAt: null }
      })
    )
    const { data } = await createOrkioConfigStore(file).load()
    expect(data.agents).toEqual({})
    const saved = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>
    expect(saved['schemaVersion']).toBe(ORKIO_CONFIG_VERSION)
    expect(saved['agents']).toEqual({})

    await writeFile(
      file,
      JSON.stringify({
        ...saved,
        agents: {
          p1: {
            assignOnEnter: [
              { stageId: 's1', agentKey: 'repo:ana' },
              { stageId: 's1', agentKey: 'local:bob' },
              { stageId: 's2', agentKey: 'nuvem:x' },
              { stageId: 's3', agentKey: 'local:bob' }
            ]
          },
          p2: 'quebrado'
        }
      })
    )
    const again = await createOrkioConfigStore(file).load()
    expect(again.data.agents).toEqual({
      p1: {
        assignOnEnter: [
          { stageId: 's1', agentKey: 'repo:ana' },
          { stageId: 's3', agentKey: 'local:bob' }
        ]
      }
    })
  })

  it('v10 → v11: orquestrador desligado; config inválida volta ao padrão sem derrubar o resto', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'orkio-cfg-v11-'))
    const file = join(dir, 'orkio-config.json')
    await writeFile(
      file,
      JSON.stringify({
        schemaVersion: 10,
        projects: [{ ...PROJECT, notionProject: null }],
        notion: null,
        boards: {},
        automation: { paused: false },
        claudeContexts: {},
        flows: {},
        delivery: {},
        agents: { p1: { assignOnEnter: [{ stageId: 's1', agentKey: 'repo:ana' }] } },
        updates: { channel: 'stable', lastSeenVersion: null, lastCheckAt: null }
      })
    )
    const { data } = await createOrkioConfigStore(file).load()
    expect(data.orchestrator).toEqual({})
    expect(data.agents['p1']?.assignOnEnter).toHaveLength(1)
    const saved = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>
    expect(saved['schemaVersion']).toBe(ORKIO_CONFIG_VERSION)
    expect(saved['orchestrator']).toEqual({})

    await writeFile(
      file,
      JSON.stringify({
        ...saved,
        orchestrator: {
          p1: {
            enabled: true,
            queueStageId: 'fila',
            maxActive: 99,
            lanes: [
              { stageId: 'dev', agents: ['builtin:implementador', 'nuvem:x'], next: 'rev' },
              { stageId: 'dev', agents: ['repo:ana'], next: null },
              { stageId: 'rev', agents: ['builtin:revisor'], next: null }
            ]
          },
          p2: 'quebrado'
        }
      })
    )
    const again = await createOrkioConfigStore(file).load()
    expect(again.data.orchestrator).toEqual({
      p1: {
        enabled: true,
        enabledSince: null,
        queueStageId: 'fila',
        maxActive: 10,
        lanes: [
          { stageId: 'dev', agents: ['builtin:implementador'], next: 'rev' },
          { stageId: 'rev', agents: ['builtin:revisor'], next: null }
        ]
      }
    })
    expect(again.data.projects).toHaveLength(1)
  })
})

describe('v11 → v12: modelos Alva e ligações padrão (Task 18)', () => {
  const STAGES = [
    {
      id: 's-dev',
      name: 'Em andamento',
      order: 0,
      notionStatus: { id: 'o1', name: 'Em andamento' }
    },
    { id: 's-rev', name: 'Revisando', order: 1, notionStatus: { id: 'o1', name: 'Em andamento' } },
    { id: 's-ok', name: 'Revisado', order: 2, notionStatus: { id: 'o1', name: 'Em andamento' } }
  ]
  const board = { stages: STAGES, orkioStageProperty: null, blockedProperty: null, rules: [] }
  const v11 = (flows: Record<string, unknown>): string =>
    JSON.stringify({
      schemaVersion: 11,
      projects: [
        { ...PROJECT, notionProject: null },
        { ...PROJECT, id: 'p2', notionProject: null }
      ],
      notion: null,
      boards: { p1: board, p2: board },
      automation: { paused: false },
      flows,
      delivery: {},
      agents: {},
      orchestrator: {},
      updates: { channel: 'stable', lastSeenVersion: null, lastCheckAt: null }
    })

  it('com modelos Alva: acrescenta os novos, atualiza as cópias e liga só colunas vazias; avisa as mudanças', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'orkio-cfg-v12-'))
    const file = join(dir, 'orkio-config.json')
    const userFlow = {
      id: 'meu',
      name: 'Meu',
      steps: [{ id: 'a', name: 'A', type: 'orkio_action', action: 'noop' }]
    }
    const oldReviewed = { ...alvaReviewedFlow(), steps: alvaReviewedFlow().steps.slice(0, 1) }
    await writeFile(
      file,
      v11({
        p1: {
          flows: [oldReviewed, userFlow],
          // Revisado já tem um fluxo do usuário: fica como está.
          bindings: [{ stageId: 's-ok', flowId: 'meu', enabled: true, mode: 'manual' }]
        },
        // Sem modelos Alva: nada muda.
        p2: { flows: [userFlow], bindings: [] }
      })
    )
    const notes: { projectId: string; changes: string[] }[] = []
    const { data } = await createOrkioConfigStore(file, {
      onMigrationNote: (n) => notes.push(n)
    }).load()
    const p1 = data.flows['p1']!
    expect(p1.flows.find((f) => f.id === 'meu')).toEqual(userFlow)
    expect(p1.flows.find((f) => f.id === ALVA_TEMPLATE_IDS.reviewed)).toEqual(alvaReviewedFlow())
    expect(p1.flows.find((f) => f.id === ALVA_TEMPLATE_IDS.review)).toEqual(alvaReviewPublishFlow())
    // A cópia antiga (diferente do modelo) foi guardada, sem coluna, antes da troca.
    expect(p1.flows.find((f) => f.id === 'alva-revisado-anterior')).toEqual({
      ...oldReviewed,
      id: 'alva-revisado-anterior',
      name: 'Alva: comentários da PR (cópia anterior)'
    })
    expect(p1.bindings.some((b) => b.flowId === 'alva-revisado-anterior')).toBe(false)
    expect(p1.bindings).toEqual([
      { stageId: 's-ok', flowId: 'meu', enabled: true, mode: 'manual' },
      { stageId: 's-rev', flowId: ALVA_TEMPLATE_IDS.review, enabled: true, mode: 'on_enter' }
    ])
    expect(data.flows['p2']).toEqual({ flows: [userFlow], bindings: [] })
    expect(notes).toHaveLength(1)
    expect(notes[0]!.projectId).toBe('p1')
    expect(notes[0]!.changes).toContain(
      'Coluna “Revisando” ganhou o fluxo “Alva: revisão publicada” (ao entrar)'
    )
    expect(notes[0]!.changes).toContain(
      'Fluxo “Alva: comentários da PR” atualizado para a versão nova do modelo Alva'
    )
    expect(notes[0]!.changes).toContain(
      'Cópia anterior de “Alva: comentários da PR” guardada como “Alva: comentários da PR (cópia anterior)” (sem coluna)'
    )
    const saved = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>
    expect(saved['schemaVersion']).toBe(ORKIO_CONFIG_VERSION)
    // Já na versão atual: abrir de novo não migra nem avisa.
    const again: unknown[] = []
    await createOrkioConfigStore(file, { onMigrationNote: (n) => again.push(n) }).load()
    expect(again).toEqual([])
  })
})

describe('keepAwake (campo opcional, sem migração)', () => {
  const base = { schemaVersion: ORKIO_CONFIG_VERSION, projects: [], notion: null }
  it('ausente ou inválido = desligado; true é mantido', () => {
    expect(validateConfig({ ...base })?.value.keepAwake).toBeUndefined()
    expect(validateConfig({ ...base, keepAwake: 'sim' })?.value.keepAwake).toBeUndefined()
    expect(validateConfig({ ...base, keepAwake: true })?.value.keepAwake).toBe(true)
  })
})

describe('parseStep: modelo e raciocínio do passo', () => {
  const step = {
    id: 'a',
    name: 'A',
    type: 'claude_command',
    command: 'x',
    args: '',
    timeoutMin: 5
  }
  it('preserva os campos válidos; sem eles, objeto igual ao de antes; inválidos somem', () => {
    expect(parseStep({ ...step, model: 'opus', effort: 'low' })).toEqual({
      ...step,
      model: 'opus',
      effort: 'low'
    })
    expect(parseStep(step)).toEqual(step)
    expect(parseStep({ ...step, model: '--x', effort: 'ultra' })).toEqual(step)
  })
})

describe('parseStep: pedido em texto, só leitura e "Pedir ajustes"', () => {
  it('preserva prompt/readOnly e o gate com show result e revise; inválidos somem', () => {
    const plan = {
      id: 'plano',
      name: 'Plano',
      type: 'claude_command',
      command: '',
      args: '',
      prompt: 'Leia .orkio/revisao.md',
      readOnly: true,
      timeoutMin: 30
    }
    expect(parseStep(plan)).toEqual(plan)
    expect(parseStep({ ...plan, readOnly: 'sim', prompt: 7 })).toEqual({
      id: 'plano',
      name: 'Plano',
      type: 'claude_command',
      command: '',
      args: '',
      timeoutMin: 30
    })
    const gate = {
      id: 'ok',
      name: 'Aprovar',
      type: 'gate',
      message: 'Aprovar correções da PR #{{review.pr}}',
      show: 'result',
      onReject: 'stop',
      timeoutMin: null,
      revise: { step: 'plano', max: 3 }
    }
    expect(parseStep(gate)).toEqual(gate)
    const plain: Record<string, unknown> = { ...gate }
    delete plain['revise']
    expect(parseStep({ ...gate, revise: { step: 'plano' } })).toEqual(plain)
    expect(parseStep({ ...gate, show: 'tudo' })).toBeNull()
  })
})
