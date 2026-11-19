import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS, type OrkioApi } from '../shared/ipc-contract'

const { notion, github, shell } = IPC_CHANNELS

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
  openExternal: (url) => ipcRenderer.invoke(shell.openExternal, url)
}

contextBridge.exposeInMainWorld('orkio', api)
