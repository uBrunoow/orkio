import type { OrkioApi } from '../shared/ipc/api'

declare global {
  interface Window {
    orkio: OrkioApi
  }
}

export {}
