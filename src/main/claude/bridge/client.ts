/** Cliente do socket de permissões do Orkio (usado pelo servidor MCP e pelos testes). */
import { connect } from 'node:net'

export function askOrkio(
  socketPath: string,
  token: string,
  payload: Record<string, unknown>
): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const socket = connect(socketPath)
    let buffer = ''
    const fail = (message: string): void => resolve({ behavior: 'deny', message })
    socket.on('connect', () => socket.write(`${JSON.stringify({ token, ...payload })}\n`))
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8')
      const nl = buffer.indexOf('\n')
      if (nl < 0) return
      try {
        resolve(JSON.parse(buffer.slice(0, nl)) as Record<string, unknown>)
      } catch {
        fail('Resposta inválida do Orkio.')
      }
      socket.end()
    })
    socket.on('error', () => fail('O Orkio não respondeu ao pedido de permissão.'))
  })
}
