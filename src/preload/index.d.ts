import type { OrkioApi } from '../shared/ipc-contract'

declare global {
  interface Window {
    orkio: OrkioApi
  }
}

export {}
