import { contextBridge, ipcRenderer } from 'electron'
import { ORKIO_API } from '../shared/ipc/api'
import { buildApi } from '../shared/ipc/define'

// API mínima e tipada, gerada da declaração (`shared/ipc/api.ts`): o renderer só vê funções
// nomeadas, nunca o ipcRenderer, o objeto do evento do Electron nem credenciais.
const api = buildApi(ORKIO_API, {
  invoke: (channel, args) => ipcRenderer.invoke(channel, ...args),
  subscribe: (channel, handler) => {
    const listener = (_event: unknown, payload: unknown): void => handler(payload)
    ipcRenderer.on(channel, listener)
    return () => {
      ipcRenderer.removeListener(channel, listener)
    }
  }
})

contextBridge.exposeInMainWorld('orkio', api)
