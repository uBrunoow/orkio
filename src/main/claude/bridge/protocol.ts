/**
 * Contrato da ponte de permissões entre o Claude Code e o main: o servidor MCP (`permission-mcp.ts`,
 * empacotado à parte) e o `PermissionBroker`/`ClaudeRun` (`runner.ts`) importam daqui. Sem
 * dependências.
 *
 * O CLI chama a ferramenta `mcp__<SERVER>__<TOOL>`; o servidor manda uma linha JSON
 * `{ token, toolName, input, toolUseId }` pelo socket local e recebe a decisão numa linha.
 */

/** Variáveis de ambiente que o main passa ao servidor MCP (no mcp-config 0600). */
export const BRIDGE_ENV = {
  socket: 'ORKIO_BRIDGE_SOCKET',
  token: 'ORKIO_BRIDGE_TOKEN'
} as const

export const BRIDGE_SERVER = 'orkio'
export const BRIDGE_TOOL = 'approve'
/** Valor de `--permission-prompt-tool`. */
export const BRIDGE_PROMPT_TOOL = `mcp__${BRIDGE_SERVER}__${BRIDGE_TOOL}`

export interface BridgeRequest {
  toolName: string
  input: Record<string, unknown>
  toolUseId: string | null
}

export type BridgeDecision =
  | { behavior: 'allow'; updatedInput?: Record<string, unknown> }
  | { behavior: 'deny'; message: string }

/** Linha que o servidor MCP manda ao main (sem a quebra de linha). */
export function encodeBridgeRequest(token: string, req: BridgeRequest): string {
  return JSON.stringify({ token, ...req })
}

/** Lê a linha do servidor MCP; `null` = JSON inválido. O token é conferido por quem recebe. */
export function decodeBridgeRequest(
  line: string
): { token: string; request: BridgeRequest } | null {
  let msg: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(line)
    if (typeof parsed !== 'object' || parsed === null) return null
    msg = parsed as Record<string, unknown>
  } catch {
    return null
  }
  const input = msg['input']
  return {
    token: typeof msg['token'] === 'string' ? msg['token'] : '',
    request: {
      toolName: typeof msg['toolName'] === 'string' ? msg['toolName'] : '',
      input:
        typeof input === 'object' && input !== null && !Array.isArray(input)
          ? (input as Record<string, unknown>)
          : {},
      toolUseId: typeof msg['toolUseId'] === 'string' ? msg['toolUseId'] : null
    }
  }
}
