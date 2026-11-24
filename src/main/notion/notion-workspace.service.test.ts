import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createOrkioConfigStore, type OrkioConfig } from '../config/orkio-config'
import type { ConfigStore } from '../storage/config-store'
import {
  NOTION_READ_LIMIT,
  NotionWorkspaceService,
  WORKSPACE_MESSAGES,
  type NotionWorkspaceApi
} from './notion-workspace.service'
import { ApiError } from '../net/http'

const PROJECTS_DS = '11111111-1111-1111-1111-111111111111'
const TASKS_DS = '22222222-2222-2222-2222-222222222222'
const rich = (text: string) => [{ type: 'text', plain_text: text }]

function tasksSchema(overrides: Record<string, unknown> = {}, remove: string[] = []) {
  const properties: Record<string, unknown> = {
    Nome: { id: 'title', name: 'Nome', type: 'title' },
    Status: {
      id: 'st',
      name: 'Status',
      type: 'status',
      status: { options: [{ id: 'a', name: 'A fazer', color: 'gray' }] }
    },
    ID: { id: 'uid', name: 'ID', type: 'unique_id', unique_id: { prefix: 'ORK' } },
    Projeto: {
      id: 'rel',
      name: 'Projeto',
      type: 'relation',
      relation: { data_source_id: PROJECTS_DS }
    },
    Prioridade: { id: 'pri', name: 'Prioridade', type: 'select', select: { options: [] } },
    Responsável: { id: 'ppl', name: 'Responsável', type: 'people', people: {} },
    ...overrides
  }
  for (const key of remove) delete properties[key]
  return { object: 'data_source', id: TASKS_DS, title: rich('Tarefas'), properties }
}

const projectsSchema = {
  object: 'data_source',
  id: PROJECTS_DS,
  title: rich('Projetos'),
  properties: { Nome: { id: 'title', name: 'Nome', type: 'title' } }
}

const projectPage = (id: string, title: string) => ({
  object: 'page',
  id,
  url: `https://www.notion.so/${id}`,
  properties: { Nome: { id: 'title', type: 'title', title: rich(title) } }
})

const taskPage = (n: number, project: string) => ({
  object: 'page',
  id: `task-${n}`,
  url: `https://www.notion.so/task-${n}`,
  properties: {
    Nome: { id: 'title', type: 'title', title: rich(`Tarefa ${n}`) },
    Status: { id: 'st', type: 'status', status: { name: 'A fazer', color: 'gray' } },
    ID: { id: 'uid', type: 'unique_id', unique_id: { prefix: 'ORK', number: n } },
    Projeto: { id: 'rel', type: 'relation', relation: [{ id: project }] }
  }
})

const PROJECT = {
  id: 'local-1',
  name: 'orkio-desktop',
  localPath: '/code/orkio',
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
  },
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
  notionProject: null
}
const OTHER = { ...PROJECT, id: 'local-2', name: 'site', repo: null, localPath: '/code/site' }

const MAPPING_INPUT = {
  projectsDataSourceId: PROJECTS_DS,
  tasksDataSourceId: TASKS_DS,
  mapping: {
    title: 'title',
    status: 'st',
    uniqueId: 'uid',
    project: 'rel',
    priority: 'pri',
    assignee: 'ppl'
  }
}

describe('NotionWorkspaceService', () => {
  let dir: string
  let store: ConfigStore<OrkioConfig>
  let api: { [K in keyof NotionWorkspaceApi]: ReturnType<typeof vi.fn<NotionWorkspaceApi[K]>> }
  let schema: ReturnType<typeof tasksSchema>
  let clock: number
  let tasksByProject: Map<string, unknown[]>

  async function makeService(): Promise<NotionWorkspaceService> {
    await store.load()
    return new NotionWorkspaceService({ store, notion: api, now: () => new Date(clock) })
  }

  async function configured(): Promise<NotionWorkspaceService> {
    const service = await makeService()
    const saved = await service.saveConfig(MAPPING_INPUT)
    expect(saved).toMatchObject({ ok: true })
    return service
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'orkio-notion-ws-'))
    const file = join(dir, 'orkio-config.json')
    await writeFile(
      file,
      JSON.stringify({ schemaVersion: 2, projects: [PROJECT, OTHER], notion: null })
    )
    store = createOrkioConfigStore(file)
    schema = tasksSchema()
    clock = Date.parse('2026-11-19T12:00:00.000Z')
    tasksByProject = new Map()
    api = {
      connectionMethod: vi.fn<NotionWorkspaceApi['connectionMethod']>(async () => 'oauth'),
      searchDataSources: vi.fn<NotionWorkspaceApi['searchDataSources']>(async () => ({
        results: [
          { object: 'data_source', id: PROJECTS_DS, title: rich('Projetos'), url: null },
          { object: 'data_source', id: TASKS_DS, title: rich('Tarefas'), url: null }
        ],
        nextCursor: null
      })),
      getDataSource: vi.fn<NotionWorkspaceApi['getDataSource']>(async (id) =>
        id === PROJECTS_DS ? projectsSchema : schema
      ),
      currentPersonId: vi.fn<NotionWorkspaceApi['currentPersonId']>(async () => 'me'),
      queryDataSource: vi.fn<NotionWorkspaceApi['queryDataSource']>(async (id, options) => {
        if (id === PROJECTS_DS) {
          return {
            results: [
              projectPage('page-site', 'Site institucional'),
              projectPage('page-orkio', 'Orkio Desktop'),
              { ...projectPage('page-old', 'Orkio antigo'), in_trash: true }
            ],
            nextCursor: null
          }
        }
        const filter = options?.filter as {
          and: [{ relation: { contains: string } }, { people: { contains: string } }]
        }
        const [byProject, byPerson] = filter.and
        if (byPerson.people.contains !== 'me') return { results: [], nextCursor: null }
        return {
          results: tasksByProject.get(byProject.relation.contains) ?? [],
          nextCursor: null
        }
      })
    }
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  describe('assistente', () => {
    it('lista data sources paginando até o limite e informa truncamento', async () => {
      const service = await makeService()
      let n = 0
      api.searchDataSources.mockImplementation(async () => ({
        results: Array.from({ length: 100 }, () => ({
          object: 'data_source',
          id: `ds-${n++}`,
          title: rich('X')
        })),
        nextCursor: 'more'
      }))
      const result = await service.listDataSources('X')
      expect(result).toMatchObject({ ok: true, value: { truncated: true, connection: 'oauth' } })
      if (result.ok) expect(result.value.dataSources).toHaveLength(NOTION_READ_LIMIT)
      expect(api.searchDataSources).toHaveBeenCalledTimes(5)
      expect(api.searchDataSources).toHaveBeenNthCalledWith(2, { query: 'X', startCursor: 'more' })
    })

    it('schema das Tarefas com sugestão; sem unique_id aponta o campo faltando', async () => {
      const service = await makeService()
      const ok = await service.getTasksSchema(TASKS_DS, PROJECTS_DS)
      expect(ok).toMatchObject({ ok: true, value: { missing: [] } })
      if (ok.ok) expect(ok.value.suggestion.uniqueId?.id).toBe('uid')

      schema = tasksSchema({}, ['ID'])
      const missing = await service.getTasksSchema(TASKS_DS, PROJECTS_DS)
      // Sem a propriedade de ID nada falta: ela é opcional.
      expect(missing).toMatchObject({ ok: true, value: { missing: [] } })
    })

    it('mesmo banco para Projetos e Tarefas é recusado', async () => {
      const service = await makeService()
      expect(await service.getTasksSchema(TASKS_DS, TASKS_DS)).toMatchObject({
        ok: false,
        error: { message: WORKSPACE_MESSAGES.sameDataSource }
      })
    })

    it('salvar sem propriedade de ID funciona: a tarefa é identificada pela página', async () => {
      schema = tasksSchema({}, ['ID'])
      const service = await makeService()
      const result = await service.saveConfig({
        ...MAPPING_INPUT,
        mapping: { ...MAPPING_INPUT.mapping, uniqueId: null }
      })
      expect(result.ok).toBe(true)
      expect(store.get().notion?.mapping.uniqueId).toBeUndefined()
      expect(store.get().notion?.mapping.title).toBeDefined()
    })

    it('salvar valida tipos, campos obrigatórios e propriedades repetidas', async () => {
      const service = await makeService()
      const noStatus = await service.saveConfig({
        ...MAPPING_INPUT,
        mapping: { ...MAPPING_INPUT.mapping, status: null }
      })
      expect(noStatus).toMatchObject({ ok: false, error: { message: /Status/ } })

      const wrongType = await service.saveConfig({
        ...MAPPING_INPUT,
        mapping: { ...MAPPING_INPUT.mapping, status: 'title' }
      })
      expect(wrongType).toMatchObject({ ok: false, error: { code: 'invalid' } })
      expect(store.get().notion).toBeNull()
    })

    it('salva só ids e nomes', async () => {
      await configured()
      const notion = store.get().notion
      expect(notion).toEqual({
        projectsDataSource: { id: PROJECTS_DS, name: 'Projetos' },
        tasksDataSource: { id: TASKS_DS, name: 'Tarefas' },
        mapping: {
          title: { id: 'title', name: 'Nome', type: 'title' },
          status: { id: 'st', name: 'Status', type: 'status' },
          uniqueId: { id: 'uid', name: 'ID', type: 'unique_id' },
          project: { id: 'rel', name: 'Projeto', type: 'relation' },
          priority: { id: 'pri', name: 'Prioridade', type: 'select' },
          assignee: { id: 'ppl', name: 'Responsável', type: 'people' }
        },
        updatedAt: '2026-11-19T12:00:00.000Z'
      })
    })
  })

  describe('revalidação ao abrir', () => {
    it('renomeação → aviso e nome atualizado no arquivo', async () => {
      await configured()
      schema = tasksSchema({ Status: { ...tasksSchema().properties['Status']!, name: 'Etapa' } })
      const status = await (await makeService()).getStatus()
      expect(status.health).toBe('warning')
      expect(status.messages[0]).toMatch(/renomeada para “Etapa”/)
      expect(store.get().notion?.mapping.status.name).toBe('Etapa')
    })

    it('propriedade obrigatória apagada → broken e tarefas bloqueadas', async () => {
      await configured()
      await (await makeService()).link('local-1', 'page-orkio')
      schema = tasksSchema({}, ['Status'])
      const service = await makeService()
      const status = await service.getStatus()
      expect(status.health).toBe('broken')
      expect(status.messages).toEqual([
        'A propriedade Status (“Status”) não existe mais nas Tarefas do Notion.'
      ])
      const tasks = await service.listTasks('local-1')
      expect(tasks).toMatchObject({ ok: false, error: { code: 'broken' } })
      // A configuração não é apagada: dá para corrigir no Notion e revalidar.
      expect(store.get().notion).not.toBeNull()
    })

    it('sem rede → unverified, sem mexer na configuração', async () => {
      await configured()
      api.getDataSource.mockRejectedValue(new ApiError('notion', 'network', 'Sem conexão.'))
      const status = await (await makeService()).getStatus()
      expect(status).toMatchObject({ health: 'unverified', messages: ['Sem conexão.'] })
      expect(store.get().notion).not.toBeNull()
    })

    it('Notion desconectado → unverified com orientação', async () => {
      await configured()
      api.connectionMethod.mockResolvedValue(null)
      const status = await (await makeService()).revalidate()
      expect(status).toMatchObject({
        health: 'unverified',
        messages: [WORKSPACE_MESSAGES.notConnected],
        connection: null
      })
    })

    it('conectou depois da primeira leitura → getStatus revalida (não fica "Conecte o Notion")', async () => {
      await configured()
      api.connectionMethod.mockResolvedValue(null)
      const service = await makeService()
      expect(await service.getStatus()).toMatchObject({ health: 'unverified', connection: null })
      api.connectionMethod.mockResolvedValue('oauth')
      expect(await service.getStatus()).toMatchObject({ health: 'ok', connection: 'oauth' })
      // Sem mudança na conexão, não relê o Notion.
      api.getDataSource.mockClear()
      await service.getStatus()
      expect(api.getDataSource).not.toHaveBeenCalled()
    })

    it('revalidações simultâneas viram uma só', async () => {
      await configured()
      const service = await makeService()
      api.getDataSource.mockClear()
      await Promise.all([service.revalidate(), service.revalidate(), service.getStatus()])
      expect(api.getDataSource).toHaveBeenCalledTimes(2) // Projetos + Tarefas, uma vez
    })
  })

  describe('vínculo', () => {
    it('sugere pelo nome do projeto/repositório e ignora páginas na lixeira', async () => {
      const service = await configured()
      const result = await service.listProjectChoices('local-1')
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.choices.map((c) => c.title)).toEqual([
        'Orkio Desktop',
        'Site institucional'
      ])
      expect(result.value.choices[0]!.similarity).toBe(1)
    })

    it('um projeto do Notion ↔ um projeto local', async () => {
      const service = await configured()
      expect(await service.link('local-1', 'page-orkio')).toEqual({
        ok: true,
        value: { id: 'page-orkio', name: 'Orkio Desktop' }
      })
      expect(await service.link('local-2', 'page-orkio')).toMatchObject({
        ok: false,
        error: {
          code: 'already_linked',
          message: WORKSPACE_MESSAGES.alreadyLinked('orkio-desktop')
        }
      })
      const choices = await service.listProjectChoices('local-2')
      if (choices.ok) {
        expect(choices.value.choices.find((c) => c.id === 'page-orkio')?.linkedTo).toEqual({
          projectId: 'local-1',
          name: 'orkio-desktop'
        })
      }
      expect(await service.unlink('local-1')).toEqual({ ok: true, value: null })
      expect(await service.link('local-2', 'page-orkio')).toMatchObject({ ok: true })
    })

    it('página fora do banco de Projetos é recusada; OAuth oferece reconectar', async () => {
      const service = await configured()
      expect(await service.link('local-1', 'page-x')).toMatchObject({
        ok: false,
        error: { code: 'not_found' }
      })
      api.queryDataSource.mockRejectedValueOnce(new ApiError('notion', 'not_found', 'Sumiu.', 404))
      expect(await service.listProjectChoices('local-1', { force: true })).toEqual({
        ok: false,
        error: { code: 'not_found', message: 'Sumiu.', canReconnect: true }
      })
    })

    it('trocar o banco de Projetos desfaz os vínculos', async () => {
      const service = await configured()
      await service.link('local-1', 'page-orkio')
      const NEW_PROJECTS = '33333333-3333-3333-3333-333333333333'
      api.getDataSource.mockImplementation(async (id) =>
        id === TASKS_DS
          ? tasksSchema({
              Projeto: {
                id: 'rel',
                name: 'Projeto',
                type: 'relation',
                relation: { data_source_id: NEW_PROJECTS }
              }
            })
          : { ...projectsSchema, id: NEW_PROJECTS }
      )
      expect(
        await service.saveConfig({ ...MAPPING_INPUT, projectsDataSourceId: NEW_PROJECTS })
      ).toMatchObject({ ok: true })
      expect(store.get().projects.every((p) => p.notionProject === null)).toBe(true)
    })
  })

  describe('busca de tarefas', () => {
    it('busca no banco inteiro por título ou ID, sem filtrar pessoa nem projeto', async () => {
      const service = await configured()
      await service.link('local-1', 'page-orkio')
      api.queryDataSource.mockImplementation(async () => ({
        results: [taskPage(142, 'page-orkio'), taskPage(7, 'page-outro')],
        nextCursor: null
      }))

      const result = await service.searchTasks('ORK-142')

      expect(api.queryDataSource).toHaveBeenLastCalledWith(TASKS_DS, {
        filter: {
          or: [
            { property: 'title', title: { contains: 'ORK-142' } },
            { property: 'uid', unique_id: { equals: 142 } }
          ]
        },
        sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }],
        pageSize: 20
      })
      expect(result).toMatchObject({
        ok: true,
        value: {
          tasks: [
            {
              id: 'task-142',
              displayId: 'ORK-142',
              projectId: 'local-1',
              projectName: 'orkio-desktop'
            },
            { id: 'task-7', projectId: null, projectName: null }
          ]
        }
      })
    })

    it('texto vazio traz as editadas mais recentemente; texto sem número só pelo título', async () => {
      const service = await configured()
      api.queryDataSource.mockImplementation(async () => ({ results: [], nextCursor: null }))

      await service.searchTasks('  ')
      expect(api.queryDataSource).toHaveBeenLastCalledWith(TASKS_DS, {
        sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }],
        pageSize: 20
      })

      await service.searchTasks('login')
      expect(api.queryDataSource).toHaveBeenLastCalledWith(TASKS_DS, {
        filter: { property: 'title', title: { contains: 'login' } },
        sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }],
        pageSize: 20
      })
    })

    it('sem bancos configurados: erro claro, sem chamar o Notion', async () => {
      const service = await makeService()
      api.queryDataSource.mockClear()
      const result = await service.searchTasks('x')
      expect(result).toMatchObject({
        ok: false,
        // Onde resolver vai como dado (a tela decide texto e botão), não no meio do texto.
        error: { code: 'not_configured', fixAt: 'integrations' }
      })
      expect(result.ok ? '' : result.error.message).not.toContain('Integrações')
      expect(api.queryDataSource).not.toHaveBeenCalled()
    })
  })

  describe('tarefas', () => {
    it('conexão de bot do workspace (sem pessoa): não lista as tarefas de todos', async () => {
      const service = await configured()
      await service.link('local-1', 'page-orkio')
      tasksByProject.set('page-orkio', [taskPage(1, 'page-orkio')])
      api.currentPersonId.mockResolvedValue(null)
      api.queryDataSource.mockClear()

      const result = await service.listTasks('local-1')

      expect(result).toMatchObject({ ok: false, error: { code: 'no_person', canReconnect: true } })
      expect(api.queryDataSource).not.toHaveBeenCalled()
    })

    it('Responsável é obrigatório no mapeamento', async () => {
      const service = await makeService()
      const mapping: Partial<typeof MAPPING_INPUT.mapping> = { ...MAPPING_INPUT.mapping }
      delete mapping.assignee
      const saved = await service.saveConfig({ ...MAPPING_INPUT, mapping })
      expect(saved).toMatchObject({ ok: false })
    })

    it('filtra pela página vinculada e pela pessoa logada, e usa o mapeamento', async () => {
      const service = await configured()
      await service.link('local-1', 'page-orkio')
      tasksByProject.set('page-orkio', [taskPage(2, 'page-orkio'), taskPage(1, 'page-orkio')])
      tasksByProject.set('page-site', [taskPage(9, 'page-site')])

      const result = await service.listTasks('local-1')

      expect(api.queryDataSource).toHaveBeenLastCalledWith(TASKS_DS, {
        filter: {
          and: [
            { property: 'rel', relation: { contains: 'page-orkio' } },
            { property: 'ppl', people: { contains: 'me' } }
          ]
        },
        sorts: [{ timestamp: 'created_time', direction: 'descending' }],
        startCursor: null
      })
      expect(result).toMatchObject({ ok: true, value: { truncated: false, fromCache: false } })
      if (result.ok) {
        expect(result.value.tasks.map((t) => t.displayId)).toEqual(['ORK-2', 'ORK-1'])
        expect(result.value.tasks[0]).toMatchObject({
          title: 'Tarefa 2',
          status: { name: 'A fazer', color: 'gray' },
          url: 'https://www.notion.so/task-2'
        })
      }
    })

    it('cache de 60 s; "Atualizar" (force) ignora o cache', async () => {
      const service = await configured()
      await service.link('local-1', 'page-orkio')
      tasksByProject.set('page-orkio', [taskPage(1, 'page-orkio')])
      await service.listTasks('local-1')
      api.queryDataSource.mockClear()

      clock += 59_000
      expect(await service.listTasks('local-1')).toMatchObject({ value: { fromCache: true } })
      expect(api.queryDataSource).not.toHaveBeenCalled()

      expect(await service.listTasks('local-1', { force: true })).toMatchObject({
        value: { fromCache: false }
      })
      clock += 61_000
      expect(await service.listTasks('local-1')).toMatchObject({ value: { fromCache: false } })
      expect(api.queryDataSource).toHaveBeenCalledTimes(2)
    })

    it('Visão geral: tarefas em memória mesmo vencidas, sem rede; nada antes da 1ª leitura', async () => {
      const service = await configured()
      await service.link('local-1', 'page-orkio')
      expect(service.cachedTasks('local-1')).toBeNull()
      tasksByProject.set('page-orkio', [taskPage(1, 'page-orkio')])
      await service.listTasks('local-1')
      api.queryDataSource.mockClear()
      clock += 10 * 60_000
      expect(service.cachedTasks('local-1')).toHaveLength(1)
      expect(api.queryDataSource).not.toHaveBeenCalled()
      expect(service.cachedHealth()).not.toBeNull()
    })

    it('pagina e trunca em 500 tarefas', async () => {
      const service = await configured()
      await service.link('local-1', 'page-orkio')
      let n = 0
      api.queryDataSource.mockClear()
      api.queryDataSource.mockImplementation(async () => ({
        results: Array.from({ length: 100 }, () => taskPage(++n, 'page-orkio')),
        nextCursor: `c${n}`
      }))
      const result = await service.listTasks('local-1')
      expect(result).toMatchObject({ ok: true, value: { truncated: true } })
      if (result.ok) expect(result.value.tasks).toHaveLength(500)
      expect(api.queryDataSource).toHaveBeenCalledTimes(5)
      expect(api.queryDataSource.mock.calls[1]![1]).toMatchObject({ startCursor: 'c100' })
    })

    it('sem configuração ou sem vínculo → mensagens claras', async () => {
      const service = await makeService()
      expect(await service.listTasks('local-1')).toMatchObject({
        ok: false,
        error: { code: 'not_configured' }
      })
      const ready = await configured()
      expect(await ready.listTasks('local-1')).toMatchObject({
        ok: false,
        error: { code: 'not_linked', message: WORKSPACE_MESSAGES.notLinked }
      })
    })

    it('erro desconhecido não vaza detalhes', async () => {
      const service = await configured()
      await service.link('local-1', 'page-orkio')
      api.queryDataSource.mockRejectedValueOnce(new Error('ntn_SECRET boom'))
      const result = await service.listTasks('local-1', { force: true })
      expect(result).toEqual({
        ok: false,
        error: { code: 'unexpected', message: WORKSPACE_MESSAGES.unknown }
      })
    })
  })
})
