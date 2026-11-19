import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('orkio', {})
