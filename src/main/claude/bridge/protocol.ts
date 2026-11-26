/**
 * Contrato da ponte de permissões entre o Claude Code e o main: o servidor MCP (`permission-mcp.ts`,
 * empacotado à parte) e o `PermissionBroker`/`ClaudeRun` (`runner.ts`) importam daqui. Sem
 * dependências.
 *
 * O CLI chama a ferramenta `mcp__<SERVER>__<TOOL>`; o servidor manda uma linha JSON
 * `{ token, toolName, input, toolUseId }` pelo socket local e recebe a decisão numa linha.
 *
 * Memória do agente (Fase 3): com agente na execução, o servidor também oferece a ferramenta
 * `lembrar` (`mcp__orkio__lembrar`); cada chamada vai ao main como
 * `{ token, kind: 'remember', input }` e volta `{ ok, message }`. O pedido de permissão não muda
 * (sem `kind` = permissão).
 *
 * Servidores da tarefa: com servidores cadastrados no projeto, o servidor também oferece
 * `servidor_subir|parar|status|log` (`ORKIO_BRIDGE_SERVERS`: `all`, ou `read` num passo só de
 * leitura = só status e log); cada chamada vai ao main como
 * `{ token, kind: 'server', action, input }` e volta `{ ok, message }`.
 */

/** Variáveis de ambiente que o main passa ao servidor MCP (no mcp-config 0600). */
export const BRIDGE_ENV = {
  socket: 'ORKIO_BRIDGE_SOCKET',
  token: 'ORKIO_BRIDGE_TOKEN',
  /** `1` = a execução tem agente: a ferramenta `lembrar` aparece no `tools/list`. */
  memory: 'ORKIO_BRIDGE_MEMORY',
  /** `all` | `read`: as ferramentas dos servidores da tarefa (ausente = o projeto não tem). */
  servers: 'ORKIO_BRIDGE_SERVERS'
} as const

export const BRIDGE_SERVER = 'orkio'
export const BRIDGE_TOOL = 'approve'
/** Valor de `--permission-prompt-tool`. */
export const BRIDGE_PROMPT_TOOL = `mcp__${BRIDGE_SERVER}__${BRIDGE_TOOL}`
/** Ferramenta da memória do agente (só com agente) e o nome que o CLI dá a ela. */
export const BRIDGE_MEMORY_TOOL = 'lembrar'
export const BRIDGE_MEMORY_TOOL_NAME = `mcp__${BRIDGE_SERVER}__${BRIDGE_MEMORY_TOOL}`

/** Ações das ferramentas dos servidores; a ferramenta é `servidor_<ação>`. */
export const BRIDGE_SERVER_ACTIONS = ['subir', 'parar', 'status', 'log'] as const
export type BridgeServerAction = (typeof BRIDGE_SERVER_ACTIONS)[number]
/** As que só leem (as únicas num passo só de leitura). */
export const BRIDGE_SERVER_READ_ACTIONS: readonly BridgeServerAction[] = ['status', 'log']
export const serverToolName = (action: BridgeServerAction): string => `servidor_${action}`
/** Nome que o CLI dá à ferramenta (`mcp__orkio__servidor_subir`). */
export const serverToolFullName = (action: BridgeServerAction): string =>
  `mcp__${BRIDGE_SERVER}__${serverToolName(action)}`

export function isBridgeServerAction(v: unknown): v is BridgeServerAction {
  return typeof v === 'string' && (BRIDGE_SERVER_ACTIONS as readonly string[]).includes(v)
}

/** Ação de um nome do CLI (`mcp__orkio__servidor_log` → `log`), ou `null`. */
export function serverActionOfTool(toolName: string): BridgeServerAction | null {
  const prefix = `mcp__${BRIDGE_SERVER}__servidor_`
  if (!toolName.startsWith(prefix)) return null
  const action = toolName.slice(prefix.length)
  return isBridgeServerAction(action) ? action : null
}

export interface BridgeRequest {
  toolName: string
  input: Record<string, unknown>
  toolUseId: string | null
}

export type BridgeDecision =
  | { behavior: 'allow'; updatedInput?: Record<string, unknown> }
  | { behavior: 'deny'; message: string }

/** Resposta do main a um `remember` ou a uma ferramenta de servidor (o texto volta ao agente). */
export interface BridgeRememberReply {
  ok: boolean
  message: string
}
export type BridgeToolReply = BridgeRememberReply

/** O que chega ao main: pedido de permissão ou nota para a memória. */
export type BridgeMessage =
  | { kind: 'permission'; request: BridgeRequest }
  | { kind: 'remember'; input: Record<string, unknown> }
  | { kind: 'server'; action: BridgeServerAction; input: Record<string, unknown> }

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

/** Linha da ferramenta `lembrar` (sem a quebra de linha). */
export function encodeBridgeRemember(token: string, input: Record<string, unknown>): string {
  return JSON.stringify({ token, kind: 'remember', input })
}

/** Linha de uma ferramenta de servidor (sem a quebra de linha). */
export function encodeBridgeServer(
  token: string,
  action: BridgeServerAction,
  input: Record<string, unknown>
): string {
  return JSON.stringify({ token, kind: 'server', action, input })
}

/** Lê qualquer linha do servidor MCP; `null` = JSON inválido. Sem `kind` = permissão. */
export function decodeBridgeMessage(
  line: string
): { token: string; message: BridgeMessage } | null {
  const base = decodeBridgeRequest(line)
  if (!base) return null
  let kind: unknown
  let action: unknown
  try {
    const raw = JSON.parse(line) as Record<string, unknown>
    kind = raw['kind']
    action = raw['action']
  } catch {
    return null
  }
  if (kind === 'server') {
    // Ação desconhecida nunca vira pedido de permissão: o main recusa pelo `action` inválido.
    return isBridgeServerAction(action)
      ? { token: base.token, message: { kind: 'server', action, input: base.request.input } }
      : null
  }
  return kind === 'remember'
    ? { token: base.token, message: { kind: 'remember', input: base.request.input } }
    : { token: base.token, message: { kind: 'permission', request: base.request } }
}

/** Resposta do `remember` lida pelo servidor MCP (qualquer coisa estranha = não anotou). */
export function parseRememberReply(value: unknown, max = 2000): BridgeRememberReply {
  if (typeof value === 'object' && value !== null) {
    const v = value as Record<string, unknown>
    if (typeof v['ok'] === 'boolean' && typeof v['message'] === 'string') {
      return { ok: v['ok'], message: v['message'].slice(0, max) }
    }
  }
  return { ok: false, message: 'Resposta inválida do Orkio.' }
}

/** Resposta de uma ferramenta de servidor (o log cabe em até 12 mil caracteres). */
export const SERVER_REPLY_MAX = 12_000
export function parseServerReply(value: unknown): BridgeToolReply {
  return parseRememberReply(value, SERVER_REPLY_MAX)
}
