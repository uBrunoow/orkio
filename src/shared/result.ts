/** Resultado das operações chamadas pelo renderer (erros já em pt-BR, sem exceção crua). */
export type Result<T> = { ok: true; value: T } | { ok: false; error: ResultError }

export interface ResultError {
  code: string
  message: string
  /** O usuário pode resolver reconectando o Notion (ex.: escolher mais páginas no OAuth). */
  canReconnect?: boolean
  /** Arquivos envolvidos no erro (ex.: mudanças que impedem a operação). */
  files?: string[]
}
