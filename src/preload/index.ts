import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS, type BranchChangedEvent, type OrkioApi } from '../shared/ipc-contract'

const { notion, github, projects, shell } = IPC_CHANNELS

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
