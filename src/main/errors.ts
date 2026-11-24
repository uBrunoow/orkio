/** Só o nome do erro vai para o log: mensagem e stack podem conter dados sensíveis. */
export function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error
}

/**
 * Erro esperado de um serviço: `code` estável e `message` em pt-BR para o usuário. O registro do
 * IPC devolve como `Result` de falha nos métodos que devolvem `Result`; os outros caem no fallback.
 */
export class DomainError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
  }
}
