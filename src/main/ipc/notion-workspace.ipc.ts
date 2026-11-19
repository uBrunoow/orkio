import type { IpcMain } from 'electron'
import {
  IPC_CHANNELS,
  type NotionMappingField,
  type NotionResult,
  type NotionWorkspaceInput,
  type NotionWorkspaceStatus
} from '../../shared/ipc-contract'
import { NOTION_ID_PATTERN } from '../connectors/notion/notion.schema'
import type { NotionWorkspaceService } from '../notion/notion-workspace.service'
import { errorName } from './payload'
import { isId } from './projects.ipc'
import type { SenderGuard } from './trusted-sender'

const MAPPING_FIELDS: readonly NotionMappingField[] = [
  'title',
  'status',
  'uniqueId',
  'project',
  'priority',
  'assignee'
]

const GENERIC: NotionResult<never> = {
  ok: false,
  error: { code: 'unexpected', message: 'Algo deu errado ao falar com o Notion. Tente novamente.' }
}
const INVALID: NotionResult<never> = {
  ok: false,
  error: { code: 'invalid', message: 'Dados inválidos. Atualize a tela e tente de novo.' }
}

/**
 * Handlers dos bancos do Notion. Validam origem e payload (ids no formato do Notion, ids de
 * projeto locais) e delegam ao serviço. Nada de conteúdo do Notion é salvo.
 */
export function registerNotionWorkspaceIpc(
  ipc: Pick<IpcMain, 'handle'>,
  service: Pick<
    NotionWorkspaceService,
    | 'getStatus'
    | 'revalidate'
    | 'listDataSources'
    | 'getTasksSchema'
    | 'saveConfig'
    | 'clearConfig'
    | 'listProjectChoices'
    | 'link'
    | 'unlink'
    | 'listTasks'
  >,
  isTrustedSender: SenderGuard,
  ready: Promise<void> = Promise.resolve()
): void {
  const ch = IPC_CHANNELS.notionWorkspace

  function guarded<T>(channel: string, fallback: T, run: (...args: unknown[]) => Promise<T>): void {
    ipc.handle(channel, async (event, ...args: unknown[]) => {
      if (!isTrustedSender(event)) throw new Error('Origem de IPC não autorizada')
      try {
        await ready
        return await run(...args)
      } catch (error) {
        console.error(`[orkio] falha inesperada em ${channel}: ${errorName(error)}`)
        return fallback
      }
    })
  }

  const statusFallback: NotionWorkspaceStatus = {
    config: null,
    health: 'unverified',
    messages: ['Não foi possível carregar a configuração do Notion.'],
    connection: null
  }

  guarded(ch.getStatus, statusFallback, () => service.getStatus())
  guarded(ch.revalidate, statusFallback, () => service.revalidate())
  guarded(ch.listDataSources, GENERIC, async (query) => {
    if (query === undefined || query === null || query === '') return service.listDataSources()
    return isQuery(query) ? service.listDataSources(query) : INVALID
  })
  guarded(ch.getTasksSchema, GENERIC, async (tasks, projects) =>
    isNotionId(tasks) && isNotionId(projects) ? service.getTasksSchema(tasks, projects) : INVALID
  )
  guarded(ch.save, GENERIC, async (input) =>
    isWorkspaceInput(input) ? service.saveConfig(input) : INVALID
  )
  guarded(ch.clear, GENERIC, () => service.clearConfig())
  guarded(ch.listProjectChoices, GENERIC, async (projectId, options) =>
    isId(projectId) ? service.listProjectChoices(projectId, { force: isForce(options) }) : INVALID
  )
  guarded(ch.link, GENERIC, async (projectId, pageId) =>
    isId(projectId) && isNotionId(pageId) ? service.link(projectId, pageId) : INVALID
  )
  guarded(ch.unlink, GENERIC, async (projectId) =>
    isId(projectId) ? service.unlink(projectId) : INVALID
  )
  guarded(ch.listTasks, GENERIC, async (projectId, options) =>
    isId(projectId) ? service.listTasks(projectId, { force: isForce(options) }) : INVALID
  )
}

export function isNotionId(value: unknown): value is string {
  return typeof value === 'string' && NOTION_ID_PATTERN.test(value)
}

function isQuery(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 200
}

/** Ids de propriedade do Notion são curtos (ex.: "title", "%3AUPp"). */
function isPropertyId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 200
}

function isForce(value: unknown): boolean {
  return (
    typeof value === 'object' && value !== null && (value as { force?: unknown }).force === true
  )
}

export function isWorkspaceInput(value: unknown): value is NotionWorkspaceInput {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  if (!isNotionId(v['projectsDataSourceId']) || !isNotionId(v['tasksDataSourceId'])) return false
  const mapping = v['mapping']
  if (typeof mapping !== 'object' || mapping === null || Array.isArray(mapping)) return false
  return Object.entries(mapping).every(
    ([key, id]) =>
      (MAPPING_FIELDS as readonly string[]).includes(key) && (id === null || isPropertyId(id))
  )
}
