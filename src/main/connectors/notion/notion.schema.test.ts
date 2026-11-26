import { describe, expect, it } from 'vitest'
import {
  applyPropertyWrites,
  checkMapping,
  decodePropertyWrites,
  encodePropertyWrites,
  nameSimilarity,
  propertyWritesKey,
  propertyWritesMatch,
  parseDataSource,
  parseDataSourceSummary,
  parseProjectPage,
  parseTaskPage,
  sameId,
  simplePropertyValues,
  suggestMapping
} from './notion.schema'
import type { GitFlowConfig } from '../../../shared/git-flow'
import type { NotionMapping } from '../../../shared/notion'

const PROJECTS_DS = '11111111-1111-1111-1111-111111111111'
const OTHER_DS = '99999999-9999-9999-9999-999999999999'

const rich = (text: string) => [{ type: 'text', plain_text: text }]

function dataSource(properties: Record<string, unknown>, title = 'Tarefas') {
  return {
    object: 'data_source',
    id: '22222222-2222-2222-2222-222222222222',
    title: rich(title),
    url: 'https://www.notion.so/tarefas',
    properties
  }
}

const TASKS_SCHEMA = dataSource({
  'Nome da tarefa': { id: 'title', name: 'Nome da tarefa', type: 'title', title: {} },
  Status: {
    id: 'st',
    name: 'Status',
    type: 'status',
    status: {
      options: [
        { id: 'o1', name: 'A fazer', color: 'gray' },
        { id: 'o2', name: 'Em andamento', color: 'blue' },
        { id: 'o3', name: 'Concluída', color: 'green' }
      ],
      groups: []
    }
  },
  ID: { id: 'uid', name: 'ID', type: 'unique_id', unique_id: { prefix: 'ORK' } },
  Projeto: {
    id: 'rel',
    name: 'Projeto',
    type: 'relation',
    relation: { data_source_id: PROJECTS_DS, database_id: 'db', type: 'dual_property' }
  },
  Prioridade: {
    id: 'pri',
    name: 'Prioridade',
    type: 'select',
    select: { options: [{ id: 'p1', name: 'Alta', color: 'red' }] }
  },
  Responsável: { id: 'ppl', name: 'Responsável', type: 'people', people: {} },
  Tags: { id: 'tags', name: 'Tags', type: 'multi_select', multi_select: { options: [] } }
})

describe('parseDataSource', () => {
  it('normaliza propriedades, opções com cor, relação e prefixo do ID', () => {
    const schema = parseDataSource(TASKS_SCHEMA)!
    expect(schema.title).toBe('Tarefas')
    expect(schema.properties.find((p) => p.id === 'st')).toEqual({
      id: 'st',
      name: 'Status',
      type: 'status',
      options: [
        { id: 'o1', name: 'A fazer', color: 'gray' },
        { id: 'o2', name: 'Em andamento', color: 'blue' },
        { id: 'o3', name: 'Concluída', color: 'green' }
      ]
    })
    expect(schema.properties.find((p) => p.id === 'rel')?.relationDataSourceId).toBe(PROJECTS_DS)
    expect(schema.properties.find((p) => p.id === 'uid')?.uniqueIdPrefix).toBe('ORK')
  })

  it('rejeita o que não é data source', () => {
    expect(parseDataSource({ object: 'database', id: 'x', properties: {} })).toBeNull()
    expect(parseDataSourceSummary({ object: 'data_source' })).toBeNull()
    expect(parseDataSourceSummary({ object: 'data_source', id: 'a', title: [] })).toEqual({
      id: 'a',
      title: 'Sem título',
      url: null
    })
  })
})

describe('suggestMapping', () => {
  it('cenário completo em pt-BR', () => {
    const { mapping, missing } = suggestMapping(parseDataSource(TASKS_SCHEMA)!, PROJECTS_DS)
    expect(missing).toEqual([])
    expect(mapping).toEqual({
      title: { id: 'title', name: 'Nome da tarefa', type: 'title' },
      uniqueId: { id: 'uid', name: 'ID', type: 'unique_id' },
      project: { id: 'rel', name: 'Projeto', type: 'relation' },
      status: { id: 'st', name: 'Status', type: 'status' },
      priority: { id: 'pri', name: 'Prioridade', type: 'select' },
      assignee: { id: 'ppl', name: 'Responsável', type: 'people' }
    })
  })

  it('nomes em inglês e status como select', () => {
    const schema = parseDataSource(
      dataSource({
        Name: { id: 't', name: 'Name', type: 'title' },
        Stage: { id: 's', name: 'Stage', type: 'select', select: { options: [] } },
        Key: { id: 'k', name: 'Key', type: 'unique_id', unique_id: { prefix: null } },
        Projects: {
          id: 'r',
          name: 'Projects',
          type: 'relation',
          relation: { data_source_id: PROJECTS_DS }
        },
        Priority: { id: 'p', name: 'Priority', type: 'select', select: { options: [] } },
        Owner: { id: 'o', name: 'Owner', type: 'people' }
      })
    )!
    const { mapping } = suggestMapping(schema, PROJECTS_DS)
    expect(mapping.status?.id).toBe('s')
    expect(mapping.priority?.id).toBe('p')
    expect(mapping.assignee?.id).toBe('o')
    expect(mapping.project?.id).toBe('r')
  })

  it('prefere a propriedade de tipo status a um select quando ambas existem', () => {
    const schema = parseDataSource(
      dataSource({
        Título: { id: 't', name: 'Título', type: 'title' },
        'Status antigo': {
          id: 'sel',
          name: 'Status antigo',
          type: 'select',
          select: { options: [] }
        },
        Situação: { id: 'sta', name: 'Situação', type: 'status', status: { options: [] } }
      })
    )!
    expect(suggestMapping(schema, PROJECTS_DS).mapping.status?.id).toBe('sta')
  })

  it('sem propriedade unique_id → nada faltando (o ID é opcional)', () => {
    const schema = parseDataSource(
      dataSource({
        Nome: { id: 't', name: 'Nome', type: 'title' },
        Status: { id: 's', name: 'Status', type: 'status', status: { options: [] } },
        Projeto: {
          id: 'r',
          name: 'Projeto',
          type: 'relation',
          relation: { data_source_id: PROJECTS_DS }
        },
        Pessoa: { id: 'p', name: 'Pessoa', type: 'people', people: {} }
      })
    )!
    const { mapping, missing } = suggestMapping(schema, PROJECTS_DS)
    expect(missing).toEqual([])
    expect(mapping.uniqueId).toBeUndefined()
    // Responsável é obrigatório: qualquer propriedade de pessoas serve na sugestão.
    expect(mapping.assignee?.id).toBe('p')
  })

  it('sem propriedade de pessoas → falta o Responsável', () => {
    const schema = parseDataSource(
      dataSource({
        Nome: { id: 't', name: 'Nome', type: 'title' },
        Status: { id: 's', name: 'Status', type: 'status', status: { options: [] } },
        Projeto: {
          id: 'r',
          name: 'Projeto',
          type: 'relation',
          relation: { data_source_id: PROJECTS_DS }
        }
      })
    )!
    expect(suggestMapping(schema, PROJECTS_DS).missing).toEqual(['assignee'])
  })

  it('relação para outro banco não serve como "Projeto"', () => {
    const schema = parseDataSource(
      dataSource({
        Nome: { id: 't', name: 'Nome', type: 'title' },
        Projeto: {
          id: 'r',
          name: 'Projeto',
          type: 'relation',
          relation: { data_source_id: OTHER_DS }
        }
      })
    )!
    expect(suggestMapping(schema, PROJECTS_DS).missing).toContain('project')
  })

  it('opcionais só são sugeridos com nome reconhecido', () => {
    const schema = parseDataSource(
      dataSource({
        Nome: { id: 't', name: 'Nome', type: 'title' },
        Status: { id: 's', name: 'Status', type: 'status', status: { options: [] } },
        Categoria: { id: 'c', name: 'Categoria', type: 'select', select: { options: [] } }
      })
    )!
    expect(suggestMapping(schema, PROJECTS_DS).mapping.priority).toBeUndefined()
  })
})

describe('checkMapping', () => {
  const schema = parseDataSource(TASKS_SCHEMA)!
  const mapping = suggestMapping(schema, PROJECTS_DS).mapping as NotionMapping

  it('tudo certo → sem erros nem avisos', () => {
    expect(checkMapping(mapping, schema, PROJECTS_DS)).toEqual({
      errors: [],
      warnings: [],
      mapping
    })
  })

  it('propriedade renomeada → aviso e nome atualizado', () => {
    const renamed = {
      ...schema,
      properties: schema.properties.map((p) => (p.id === 'st' ? { ...p, name: 'Etapa' } : p))
    }
    const check = checkMapping(mapping, renamed, PROJECTS_DS)
    expect(check.errors).toEqual([])
    expect(check.warnings).toEqual(['A propriedade Status (“Status”) foi renomeada para “Etapa”.'])
    expect(check.mapping.status.name).toBe('Etapa')
  })

  it('ID apagado → aviso e campo ignorado (o ID é opcional), não erro', () => {
    const without = { ...schema, properties: schema.properties.filter((p) => p.id !== 'uid') }
    const r = checkMapping(mapping, without, PROJECTS_DS)
    expect(r.errors).toEqual([])
    expect(r.warnings).toEqual([
      'A propriedade ID (“ID”) não existe mais nas Tarefas do Notion. O campo opcional foi ignorado.'
    ])
  })

  it('obrigatória mudou de tipo → erro; opcional mudou → aviso e campo ignorado', () => {
    const changed = {
      ...schema,
      properties: schema.properties.map((p) =>
        p.id === 'st'
          ? { ...p, type: 'rich_text' }
          : p.id === 'pri'
            ? { ...p, type: 'checkbox' }
            : p
      )
    }
    const check = checkMapping(mapping, changed, PROJECTS_DS)
    expect(check.errors).toEqual([
      'A propriedade Status (“Status”) mudou de tipo no Notion (agora é rich_text).'
    ])
    expect(check.warnings[0]).toMatch(/Prioridade .* mudou de tipo .* ignorado/)
    expect(check.mapping.priority).toBeUndefined()
  })

  it('relação passou a apontar para outro banco → erro', () => {
    const moved = {
      ...schema,
      properties: schema.properties.map((p) =>
        p.id === 'rel' ? { ...p, relationDataSourceId: OTHER_DS } : p
      )
    }
    expect(checkMapping(mapping, moved, PROJECTS_DS).errors[0]).toMatch(/não aponta mais/)
  })
})

describe('páginas', () => {
  const mapping = suggestMapping(parseDataSource(TASKS_SCHEMA)!, PROJECTS_DS)
    .mapping as NotionMapping

  it('parseTaskPage acha valores pelo id da propriedade (mesmo renomeada)', () => {
    const page = {
      object: 'page',
      id: 'page-1',
      url: 'https://www.notion.so/Sync-abc',
      properties: {
        'Nome renomeado': { id: 'title', type: 'title', title: rich('Sincronizar Notion') },
        Status: {
          id: 'st',
          type: 'status',
          status: { id: 'o2', name: 'Em andamento', color: 'blue' }
        },
        ID: { id: 'uid', type: 'unique_id', unique_id: { prefix: 'ORK', number: 142 } },
        Prioridade: { id: 'pri', type: 'select', select: { name: 'Alta', color: 'red' } },
        Dono: {
          id: 'ppl',
          type: 'people',
          people: [{ object: 'user', name: 'Ada Lovelace' }, { object: 'user' }]
        }
      }
    }
    expect(parseTaskPage(page, mapping)).toEqual({
      id: 'page-1',
      url: 'https://www.notion.so/Sync-abc',
      displayId: 'ORK-142',
      title: 'Sincronizar Notion',
      status: { id: 'o2', name: 'Em andamento', color: 'blue' },
      priority: { name: 'Alta', color: 'red' },
      assignees: ['Ada Lovelace'],
      gitStage: null,
      prUrl: null
    })
  })

  it('parseTaskPage com gitFlow lê a Etapa Git (select e status) e a URL da PR', () => {
    const base = { object: 'page', id: 'p', properties: {} as Record<string, unknown> }
    const flow = (type: 'select' | 'status', withUrl = true): GitFlowConfig => ({
      stage: { id: 'gs', name: 'Etapa Git', type },
      options: {},
      ...(withUrl ? { prUrl: { id: 'pr', name: 'PR' } } : {})
    })
    const props = (type: 'select' | 'status') => ({
      N: { id: 'title', type: 'title', title: [] },
      G: { id: 'gs', type, [type]: { id: 'g1', name: 'Branch criada', color: 'green' } },
      P: { id: 'pr', type: 'url', url: 'https://github.com/a/b/pull/1' }
    })
    for (const type of ['select', 'status'] as const) {
      const page = { ...base, properties: props(type) }
      expect(parseTaskPage(page, mapping, flow(type))).toMatchObject({
        gitStage: { id: 'g1', name: 'Branch criada', color: 'green' },
        prUrl: 'https://github.com/a/b/pull/1'
      })
      expect(parseTaskPage(page, mapping, flow(type, false))?.prUrl).toBeNull()
      expect(parseTaskPage(page, mapping)).toMatchObject({ gitStage: null, prUrl: null })
    }
    const bad = { ...base, properties: { P: { id: 'pr', type: 'url', url: 'http://x.com' } } }
    expect(parseTaskPage(bad, mapping, flow('select'))).toMatchObject({
      gitStage: null,
      prUrl: null
    })
  })

  it('url e date: ida e volta, chave estável, match e apply', () => {
    const writes = {
      pr: { type: 'url', url: 'https://github.com/a/b/pull/1' },
      dt: { type: 'date', start: '2026-11-26T14:03:00Z' }
    } as const
    const payload = encodePropertyWrites(writes)
    expect(payload).toEqual({
      dt: { date: { start: '2026-11-26T14:03:00Z' } },
      pr: { url: 'https://github.com/a/b/pull/1' }
    })
    expect(decodePropertyWrites(payload)).toEqual(writes)
    expect(propertyWritesKey(writes)).toBe(propertyWritesKey({ dt: writes.dt, pr: writes.pr }))
    const values = simplePropertyValues({
      properties: {
        A: { id: 'pr', type: 'url', url: 'https://github.com/a/b/pull/1' },
        B: { id: 'dt', type: 'date', date: { start: '2026-11-26T14:03:00Z' } }
      }
    })
    expect(propertyWritesMatch(values, writes)).toBe(true)
    expect(propertyWritesMatch(values, { pr: { type: 'url', url: 'https://x.com/' } })).toBe(false)
    expect(propertyWritesMatch(values, { dt: { type: 'date', start: '2026-11-27' } })).toBe(false)
    const known: typeof values = {}
    applyPropertyWrites(known, writes)
    expect(propertyWritesMatch(known, writes)).toBe(true)
  })

  it('valores vazios e páginas na lixeira', () => {
    const page = {
      object: 'page',
      id: 'p',
      properties: {
        N: { id: 'title', type: 'title', title: [] },
        S: { id: 'st', type: 'status', status: null },
        I: { id: 'uid', type: 'unique_id', unique_id: { prefix: null, number: 7 } }
      }
    }
    expect(parseTaskPage(page, mapping)).toMatchObject({
      displayId: '7',
      title: 'Sem título',
      status: null,
      priority: null
    })
    expect(parseTaskPage({ ...page, in_trash: true }, mapping)).toBeNull()
  })

  it('simplePropertyValues: select, status e checkbox por id', () => {
    expect(
      simplePropertyValues({
        properties: {
          A: { id: 'a', type: 'select', select: { id: 'x', name: 'Revisando' } },
          B: { id: 'b', type: 'checkbox', checkbox: true },
          C: { id: 'c', type: 'status', status: null },
          D: { id: 'd', type: 'title', title: [] }
        }
      })
    ).toEqual({
      a: { type: 'select', id: 'x', name: 'Revisando' },
      b: { type: 'checkbox', checked: true },
      c: { type: 'status', id: null, name: null }
    })
  })

  it('parseProjectPage usa a propriedade title', () => {
    expect(
      parseProjectPage({
        object: 'page',
        id: 'proj',
        url: 'https://www.notion.so/Orkio',
        properties: { Projeto: { id: 'title', type: 'title', title: rich('Orkio App') } }
      })
    ).toEqual({ id: 'proj', title: 'Orkio App', url: 'https://www.notion.so/Orkio' })
  })
})

describe('nameSimilarity e sameId', () => {
  it('repo × projeto do Notion', () => {
    expect(nameSimilarity('orkio', 'Orkio')).toBe(1)
    expect(nameSimilarity('orkio-app', 'Orkio App')).toBe(1)
    expect(nameSimilarity('orkio', 'Orkio Desktop')).toBeGreaterThan(0.5)
    expect(nameSimilarity('orkio', 'Site institucional')).toBeLessThan(0.3)
    expect(nameSimilarity('', 'x')).toBe(0)
  })

  it('ids com e sem hífen', () => {
    expect(sameId(PROJECTS_DS, PROJECTS_DS.replace(/-/g, ''))).toBe(true)
    expect(sameId(PROJECTS_DS, OTHER_DS)).toBe(false)
  })
})

describe('escrita de propriedades (formato da API só aqui)', () => {
  it('codifica o payload do PATCH e lê de volta, inclusive pendência salva antes', () => {
    const writes = {
      st: { type: 'status' as const, name: 'Finalizadas' },
      eo: { type: 'select' as const, name: 'Revisando' },
      blk: { type: 'checkbox' as const, checked: true }
    }
    const payload = encodePropertyWrites(writes)
    expect(payload).toEqual({
      st: { status: { name: 'Finalizadas' } },
      eo: { select: { name: 'Revisando' } },
      blk: { checkbox: true }
    })
    expect(decodePropertyWrites(payload)).toEqual(writes)
    expect(decodePropertyWrites({ x: { rich_text: [] }, y: 'z' })).toEqual({})
  })

  it('chave estável: a ordem das propriedades não muda a chave', () => {
    const a = propertyWritesKey({
      st: { type: 'status', name: 'A' },
      blk: { type: 'checkbox', checked: false }
    })
    const b = propertyWritesKey({
      blk: { type: 'checkbox', checked: false },
      st: { type: 'status', name: 'A' }
    })
    expect(a).toBe(b)
  })

  it('match e apply sobre os valores conhecidos', () => {
    const values = { st: { type: 'status' as const, id: 'o1', name: 'A' } }
    const writes = {
      st: { type: 'status' as const, name: 'B' },
      blk: { type: 'checkbox' as const, checked: true }
    }
    expect(propertyWritesMatch(values, writes)).toBe(false)
    applyPropertyWrites(values, writes)
    expect(values).toEqual({
      st: { type: 'status', id: null, name: 'B' },
      blk: { type: 'checkbox', checked: true }
    })
    expect(propertyWritesMatch(values, writes)).toBe(true)
    expect(propertyWritesMatch(undefined, writes)).toBe(false)
  })
})
