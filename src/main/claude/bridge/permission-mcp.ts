/**
 * Servidor MCP mínimo (stdio) que o Claude Code carrega por execução (`--mcp-config`) e usa como
 * `--permission-prompt-tool mcp__orkio__approve`. Ele só repassa cada pedido ao processo main do
 * Orkio (socket local + token de uso único) e devolve a decisão no formato documentado:
 * um bloco de texto com `{"behavior":"allow"}` ou `{"behavior":"deny","message":"…"}`.
 *
 * Com agente na execução (`ORKIO_BRIDGE_MEMORY=1`), oferece também a ferramenta `lembrar`
 * (memória do agente, Fase 3): a nota vai ao main, que valida, redige e grava.
 *
 * Roda com o Node do Electron (ELECTRON_RUN_AS_NODE=1). Sem dependências.
 */
import { createInterface } from 'node:readline'
import { askOrkio as ask, rememberInOrkio } from './client'
import { BRIDGE_ENV, BRIDGE_MEMORY_TOOL, BRIDGE_SERVER, BRIDGE_TOOL } from './protocol'

const SOCKET = process.env[BRIDGE_ENV.socket] ?? ''
const TOKEN = process.env[BRIDGE_ENV.token] ?? ''
const MEMORY = process.env[BRIDGE_ENV.memory] === '1'

/** Ferramenta da memória (o texto da validação final é do main). */
const MEMORY_TOOL = {
  name: BRIDGE_MEMORY_TOOL,
  description:
    'Guarda uma nota curta na sua memória do Orkio, que volta no início das próximas tarefas. Só o que vai servir de novo (preferências, convenções, armadilhas); nunca segredos.',
  inputSchema: {
    type: 'object',
    properties: {
      texto: { type: 'string', description: 'A nota, em uma frase curta (até 1000 caracteres).' },
      escopo: {
        type: 'string',
        enum: ['geral', 'projeto'],
        description: '"geral" (padrão) vale em todo lugar; "projeto" só neste projeto.'
      },
      ate: { type: 'string', description: 'Opcional: vale até este dia (AAAA-MM-DD).' }
    },
    required: ['texto']
  }
}

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
        serverInfo: { name: BRIDGE_SERVER, version: '1.0.0' }
      })
      return
    case 'ping':
      reply({})
      return
    case 'tools/list':
      reply({
        tools: [
          {
            name: BRIDGE_TOOL,
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
          },
          ...(MEMORY ? [MEMORY_TOOL] : [])
        ]
      })
      return
    case 'tools/call': {
      const args = (msg.params?.['arguments'] ?? {}) as Record<string, unknown>
      if (msg.params?.['name'] === BRIDGE_MEMORY_TOOL) {
        const r = MEMORY
          ? await rememberInOrkio(SOCKET, TOKEN, args)
          : { ok: false, message: 'A memória não está ligada nesta execução.' }
        reply({ content: [{ type: 'text', text: r.message }], ...(r.ok ? {} : { isError: true }) })
        return
      }
      const decision = await ask(SOCKET, TOKEN, {
        toolName: typeof args['tool_name'] === 'string' ? args['tool_name'] : '',
        // A doc não fixa o nome do campo da entrada: aceitamos os dois usados no Claude Code.
        input: (args['input'] ?? args['tool_input'] ?? {}) as Record<string, unknown>,
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
