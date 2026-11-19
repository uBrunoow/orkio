import { describe, expect, it } from 'vitest'
import type { NotionMapping } from '../../../shared/ipc-contract'
import {
  checkMapping,
  nameSimilarity,
  parseDataSource,
  parseDataSourceSummary,
  parseProjectPage,
  parseTaskPage,
  sameId,
  suggestMapping
} from './notion.schema'

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

  it('sem propriedade unique_id → campo obrigatório faltando', () => {
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
    const { mapping, missing } = suggestMapping(schema, PROJECTS_DS)
    expect(missing).toEqual(['uniqueId'])
    expect(mapping.uniqueId).toBeUndefined()
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

  it('obrigatória apagada → erro', () => {
    const without = { ...schema, properties: schema.properties.filter((p) => p.id !== 'uid') }
    expect(checkMapping(mapping, without, PROJECTS_DS).errors).toEqual([
      'A propriedade ID (“ID”) não existe mais nas Tarefas do Notion.'
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
        Prioridade: { id: 'pri', type: 'select', select: { name: 'Alta', color: 'red' } }
      }
    }
    expect(parseTaskPage(page, mapping)).toEqual({
      id: 'page-1',
      url: 'https://www.notion.so/Sync-abc',
      displayId: 'ORK-142',
      title: 'Sincronizar Notion',
      status: { name: 'Em andamento', color: 'blue' },
      priority: { name: 'Alta', color: 'red' }
    })
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
