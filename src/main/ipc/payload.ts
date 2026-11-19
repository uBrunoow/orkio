import type { ConnectorCredentials } from '../../shared/ipc-contract'

/** Valida o payload de "conectar com token" vindo do renderer (sempre `unknown`). */
export function isTokenCredentials(value: unknown): value is ConnectorCredentials {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { kind?: unknown }).kind === 'token' &&
    typeof (value as { token?: unknown }).token === 'string'
  )
}

/** Só o nome do erro vai para o log: mensagem e stack podem conter dados sensíveis. */
export function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error
}
