import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC_CHANNELS,
  type BoardSyncEvent,
  type BranchChangedEvent,
  type OrkioApi
} from '../shared/ipc-contract'

const { notion, github, notionWorkspace, signals, board, projects, shell } = IPC_CHANNELS

// API mínima: o renderer nunca recebe ipcRenderer nem credenciais.
const api: OrkioApi = {
  notion: {
    getStatus: () => ipcRenderer.invoke(notion.getStatus),
    connect: (credentials) =>
      ipcRenderer.invoke(notion.connect, { kind: credentials.kind, token: credentials.token }),
    disconnect: () => ipcRenderer.invoke(notion.disconnect),
    testConnection: () => ipcRenderer.invoke(notion.testConnection),
    getAuthOptions: () => ipcRenderer.invoke(notion.getAuthOptions),
    startOAuth: () => ipcRenderer.invoke(notion.startOAuth),
    cancelOAuth: () => ipcRenderer.invoke(notion.cancelOAuth)
  },
  github: {
    getStatus: () => ipcRenderer.invoke(github.getStatus),
    connect: (credentials) =>
      ipcRenderer.invoke(github.connect, { kind: credentials.kind, token: credentials.token }),
    disconnect: () => ipcRenderer.invoke(github.disconnect),
    testConnection: () => ipcRenderer.invoke(github.testConnection),
    getAuthOptions: () => ipcRenderer.invoke(github.getAuthOptions),
    startDeviceFlow: () => ipcRenderer.invoke(github.startDeviceFlow),
    waitDeviceFlow: () => ipcRenderer.invoke(github.waitDeviceFlow),
    cancelDeviceFlow: () => ipcRenderer.invoke(github.cancelDeviceFlow)
  },
  notionWorkspace: {
    getStatus: () => ipcRenderer.invoke(notionWorkspace.getStatus),
    revalidate: () => ipcRenderer.invoke(notionWorkspace.revalidate),
    listDataSources: (query) => ipcRenderer.invoke(notionWorkspace.listDataSources, query),
    getTasksSchema: (tasksId, projectsId) =>
      ipcRenderer.invoke(notionWorkspace.getTasksSchema, tasksId, projectsId),
    save: (input) =>
      ipcRenderer.invoke(notionWorkspace.save, {
        projectsDataSourceId: input.projectsDataSourceId,
        tasksDataSourceId: input.tasksDataSourceId,
        mapping: { ...input.mapping }
      }),
    clear: () => ipcRenderer.invoke(notionWorkspace.clear),
    listProjectChoices: (projectId, options) =>
      ipcRenderer.invoke(notionWorkspace.listProjectChoices, projectId, {
        force: options?.force === true
      }),
    link: (projectId, pageId) => ipcRenderer.invoke(notionWorkspace.link, projectId, pageId),
    unlink: (projectId) => ipcRenderer.invoke(notionWorkspace.unlink, projectId),
    listTasks: (projectId, options) =>
      ipcRenderer.invoke(notionWorkspace.listTasks, projectId, { force: options?.force === true })
  },
  board: {
    get: (projectId, options) =>
      ipcRenderer.invoke(board.get, projectId, { force: options?.force === true }),
    save: (projectId, input) =>
      ipcRenderer.invoke(board.save, projectId, {
        stages: input.stages.map((s) => ({
          id: s.id,
          name: s.name,
          notionStatusId: s.notionStatusId
        })),
        orkioStage: { ...input.orkioStage },
        addMissingOptions: input.addMissingOptions === true,
        blockedPropertyId: input.blockedPropertyId
      }),
    move: (projectId, taskId, stageId) =>
      ipcRenderer.invoke(board.move, projectId, taskId, stageId),
    setBlocked: (projectId, taskId, blocked) =>
      ipcRenderer.invoke(board.setBlocked, projectId, taskId, blocked === true),
    history: (projectId, taskId) => ipcRenderer.invoke(board.history, projectId, taskId),
    retryNow: () => ipcRenderer.invoke(board.retryNow),
    onSyncChanged: (listener) => {
      const handler = (_event: unknown, payload: unknown): void => {
        if (isBoardSyncEvent(payload)) listener(payload)
      }
      ipcRenderer.on(board.syncChanged, handler)
      return () => {
        ipcRenderer.removeListener(board.syncChanged, handler)
      }
    }
  },
  signals: {
    get: (projectId, options) =>
      ipcRenderer.invoke(signals.get, projectId, { force: options?.force === true })
  },
  projects: {
    list: () => ipcRenderer.invoke(projects.list),
    revalidate: () => ipcRenderer.invoke(projects.revalidate),
    pickFolder: () => ipcRenderer.invoke(projects.pickFolder),
    create: (input) =>
      ipcRenderer.invoke(projects.create, {
        selectionId: input.selectionId,
        remoteName: input.remoteName,
        hostConfirmed: input.hostConfirmed,
        ...(input.name !== undefined ? { name: input.name } : {})
      }),
    relocate: (projectId) => ipcRenderer.invoke(projects.relocate, projectId),
    remove: (projectId) => ipcRenderer.invoke(projects.remove, projectId),
    onBranchChanged: (listener) => {
      // O listener recebe só o payload validado, nunca o objeto do evento do Electron.
      const handler = (_event: unknown, payload: unknown): void => {
        if (isBranchChangedEvent(payload)) {
          listener({ projectId: payload.projectId, branch: payload.branch })
        }
      }
      ipcRenderer.on(projects.branchChanged, handler)
      return () => {
        ipcRenderer.removeListener(projects.branchChanged, handler)
      }
    }
  },
  openExternal: (url) => ipcRenderer.invoke(shell.openExternal, url)
}

contextBridge.exposeInMainWorld('orkio', api)

function isBranchChangedEvent(value: unknown): value is BranchChangedEvent {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v['projectId'] === 'string' && (v['branch'] === null || typeof v['branch'] === 'string')
  )
}

function isBoardSyncEvent(value: unknown): value is BoardSyncEvent {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v['projectId'] === 'string' &&
    typeof v['taskId'] === 'string' &&
    (v['state'] === 'synced' || v['state'] === 'pending' || v['state'] === 'failed') &&
    (v['stageId'] === null || typeof v['stageId'] === 'string') &&
    typeof v['blocked'] === 'boolean' &&
    (v['message'] === undefined || typeof v['message'] === 'string')
  )
}
