/** Cliente do socket de permissões do Orkio (usado pelo servidor MCP e pelos testes). */
import { connect } from 'node:net'
import {
  encodeBridgeRemember,
  encodeBridgeRequest,
  encodeBridgeServer,
  parseRememberReply,
  parseServerReply,
  type BridgeRememberReply,
  type BridgeRequest,
  type BridgeServerAction,
  type BridgeToolReply
} from './protocol'

/**
 * Manda uma linha e lê a primeira linha da resposta (JSON). `invalid` = resposta que não é JSON (ou
 * que `parse` recusa); `unreachable` = o socket falhou.
 */
function exchange<T>(
  socketPath: string,
  line: string,
  fallback: { invalid: T; unreachable: T },
  parse: (value: unknown) => T
): Promise<T> {
  return new Promise((resolve) => {
    const socket = connect(socketPath)
    let buffer = ''
    socket.on('connect', () => socket.write(`${line}\n`))
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8')
      const nl = buffer.indexOf('\n')
      if (nl < 0) return
      try {
        resolve(parse(JSON.parse(buffer.slice(0, nl))))
      } catch {
        resolve(fallback.invalid)
      }
      socket.end()
    })
    socket.on('error', () => resolve(fallback.unreachable))
  })
}

export function askOrkio(
  socketPath: string,
  token: string,
  request: BridgeRequest
): Promise<Record<string, unknown>> {
  return exchange<Record<string, unknown>>(
    socketPath,
    encodeBridgeRequest(token, request),
    {
      invalid: { behavior: 'deny', message: 'Resposta inválida do Orkio.' },
      unreachable: { behavior: 'deny', message: 'O Orkio não respondeu ao pedido de permissão.' }
    },
    (value) => value as Record<string, unknown>
  )
}

/** Ferramenta `lembrar`: manda a nota ao main e devolve se anotou (e a frase para o agente). */
export function rememberInOrkio(
  socketPath: string,
  token: string,
  input: Record<string, unknown>
): Promise<BridgeRememberReply> {
  return exchange<BridgeRememberReply>(
    socketPath,
    encodeBridgeRemember(token, input),
    {
      invalid: { ok: false, message: 'Resposta inválida do Orkio.' },
      unreachable: { ok: false, message: 'O Orkio não respondeu: a nota não foi anotada.' }
    },
    parseRememberReply
  )
}

/** Ferramentas dos servidores da tarefa: a ação vai ao main, que roda o servidor cadastrado. */
export function serverInOrkio(
  socketPath: string,
  token: string,
  action: BridgeServerAction,
  input: Record<string, unknown>
): Promise<BridgeToolReply> {
  return exchange<BridgeToolReply>(
    socketPath,
    encodeBridgeServer(token, action, input),
    {
      invalid: { ok: false, message: 'Resposta inválida do Orkio.' },
      unreachable: { ok: false, message: 'O Orkio não respondeu.' }
    },
    parseServerReply
  )
}
