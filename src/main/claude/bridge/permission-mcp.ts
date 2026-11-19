/**
 * Servidor MCP mínimo (stdio) que o Claude Code carrega por execução (`--mcp-config`) e usa como
 * `--permission-prompt-tool mcp__orkio__approve`. Ele só repassa cada pedido ao processo main do
 * Orkio (socket local + token de uso único) e devolve a decisão no formato documentado:
 * um bloco de texto com `{"behavior":"allow"}` ou `{"behavior":"deny","message":"…"}`.
 *
 * Roda com o Node do Electron (ELECTRON_RUN_AS_NODE=1). Sem dependências.
 */
import { createInterface } from 'node:readline'
import { askOrkio as ask } from './client'

const SOCKET = process.env['ORKIO_BRIDGE_SOCKET'] ?? ''
const TOKEN = process.env['ORKIO_BRIDGE_TOKEN'] ?? ''

interface JsonRpc {
  jsonrpc: '2.0'
  id?: number | string
  method?: string
  params?: Record<string, unknown>
}

function send(message: unknown): void {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

async function handle(msg: JsonRpc): Promise<void> {
  if (msg.method === undefined || msg.id === undefined) return // notificações
  const reply = (result: unknown): void => send({ jsonrpc: '2.0', id: msg.id, result })
  switch (msg.method) {
    case 'initialize':
      reply({
        protocolVersion: (msg.params?.['protocolVersion'] as string | undefined) ?? '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'orkio', version: '1.0.0' }
      })
      return
    case 'ping':
      reply({})
      return
    case 'tools/list':
      reply({
        tools: [
          {
            name: 'approve',
            description: 'Pede ao Orkio (e ao usuário) permissão para usar uma ferramenta.',
            inputSchema: {
              type: 'object',
              properties: {
                tool_name: { type: 'string' },
                input: { type: 'object' },
                tool_input: { type: 'object' },
                tool_use_id: { type: 'string' }
              },
              required: ['tool_name']
            }
          }
        ]
      })
      return
    case 'tools/call': {
      const args = (msg.params?.['arguments'] ?? {}) as Record<string, unknown>
      const decision = await ask(SOCKET, TOKEN, {
        toolName: typeof args['tool_name'] === 'string' ? args['tool_name'] : '',
        // A doc não fixa o nome do campo da entrada: aceitamos os dois usados no Claude Code.
        input: (args['input'] ?? args['tool_input'] ?? {}) as unknown,
        toolUseId: typeof args['tool_use_id'] === 'string' ? args['tool_use_id'] : null
      })
      // Sem structuredContent: a doc pede exatamente um bloco de texto.
      reply({ content: [{ type: 'text', text: JSON.stringify(decision) }] })
      return
    }
    default:
      send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Método desconhecido' } })
  }
}

createInterface({ input: process.stdin }).on('line', (line) => {
  if (!line.trim()) return
  let msg: JsonRpc
  try {
    msg = JSON.parse(line) as JsonRpc
  } catch {
    return
  }
  void handle(msg)
})
