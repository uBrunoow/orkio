/**
 * Processo do Claude Code de uma execução (Etapa 4A): `claude -p` (CLI do usuário, com o login
 * dele) via spawn SEM shell, cwd = worktree, entrada/saída `stream-json`.
 *
 * Permissões em camadas: `--permission-mode acceptEdits` (editar no worktree), `--settings` com
 * `blockWritesOutsideWorkingDirectories` e deny de push/gh, e `--permission-prompt-tool` apontando
 * para o servidor MCP do Orkio (bridge/permission-mcp.ts), que pergunta ao main.
 */
import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process'
import { createServer, type Server, type Socket } from 'node:net'
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { chmod, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import type { RunLogEvent } from '../../shared/agent-run'
import { redactSecrets, sanitizeEnv } from './redact'
import { parseStreamLine } from './stream'

export type SpawnFn = typeof nodeSpawn

export interface BridgeRequest {
  toolName: string
  input: Record<string, unknown>
  toolUseId: string | null
}

export type BridgeDecision =
  | { behavior: 'allow'; updatedInput?: Record<string, unknown> }
  | { behavior: 'deny'; message: string }

/** Socket local de uso único entre o servidor MCP (bridge) e o main. */
export class PermissionBroker {
  private server: Server | null = null
  readonly token = randomBytes(24).toString('hex')
  readonly socketPath =
    process.platform === 'win32'
      ? `\\\\.\\pipe\\orkio-${randomUUID()}`
      : join(tmpdir(), `orkio-${randomUUID().slice(0, 12)}.sock`)

  constructor(private readonly onRequest: (req: BridgeRequest) => Promise<BridgeDecision>) {}

  async open(): Promise<void> {
    this.server = createServer((socket) => this.handle(socket))
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject)
      this.server!.listen(this.socketPath, () => resolve())
    })
    if (process.platform !== 'win32') await chmod(this.socketPath, 0o600).catch(() => undefined)
  }

  close(): void {
    this.server?.close()
    this.server = null
    if (process.platform !== 'win32') void rm(this.socketPath, { force: true })
  }

  private handle(socket: Socket): void {
    let buffer = ''
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8')
      const nl = buffer.indexOf('\n')
      if (nl < 0 || buffer.length > 1024 * 1024) return
      const line = buffer.slice(0, nl)
      buffer = ''
      void this.answer(line).then((decision) => socket.end(`${JSON.stringify(decision)}\n`))
    })
    socket.on('error', () => socket.destroy())
  }

  private async answer(line: string): Promise<BridgeDecision> {
    let msg: Record<string, unknown>
    try {
      msg = JSON.parse(line) as Record<string, unknown>
    } catch {
      return { behavior: 'deny', message: 'Pedido inválido.' }
    }
    const token = typeof msg['token'] === 'string' ? Buffer.from(msg['token']) : Buffer.alloc(0)
    const expected = Buffer.from(this.token)
    if (token.length !== expected.length || !timingSafeEqual(token, expected)) {
      return { behavior: 'deny', message: 'Pedido não autorizado.' }
    }
    const input = msg['input']
    return this.onRequest({
      toolName: typeof msg['toolName'] === 'string' ? msg['toolName'] : '',
      input: typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {},
      toolUseId: typeof msg['toolUseId'] === 'string' ? msg['toolUseId'] : null
    }).catch((): BridgeDecision => ({ behavior: 'deny', message: 'Falha ao decidir a permissão.' }))
  }
}

export interface RunnerOptions {
  claudeCommand: string
  cwd: string
  prompt: string
  sessionId: string
  broker: PermissionBroker
  /** Executável do Node do Electron e o script do servidor MCP de permissões. */
  nodePath: string
  bridgeScript: string
  /** Pasta para o mcp-config temporário (0600, apagado no fim). */
  tmpDir: string
  env: NodeJS.ProcessEnv
  /** Modo entrega (5C): regras `deny` do modo entrega em vez das padrão. */
  delivery?: boolean
  onEvent(event: RunLogEvent): void
  onExit(result: { code: number | null; signal: NodeJS.Signals | null; stderr: string }): void
  spawn?: SpawnFn
}

export const RUN_SETTINGS = {
  permissions: {
    blockWritesOutsideWorkingDirectories: true,
    deny: ['Bash(git push *)', 'Bash(gh pr *)', 'Bash(gh api *)']
  }
}

/**
 * Modo entrega (5C): push e gh passam a ser decididos pela política do Orkio (ferramenta de
 * permissão); o CLI continua negando o que nunca é permitido.
 */
export const DELIVERY_RUN_SETTINGS = {
  permissions: {
    blockWritesOutsideWorkingDirectories: true,
    deny: [
      'Bash(git push --force *)',
      'Bash(git push -f *)',
      'Bash(git push --force-with-lease *)',
      'Bash(git push --delete *)',
      'Bash(git push --mirror *)',
      'Bash(gh pr merge *)',
      'Bash(gh pr close *)',
      'Bash(gh release *)',
      'Bash(gh repo *)'
    ]
  }
}

export class ClaudeRun {
  private child: ChildProcess | null = null
  private mcpConfig: string | null = null
  private killTimers: NodeJS.Timeout[] = []
  private ended = false

  constructor(private readonly options: RunnerOptions) {}

  async start(): Promise<void> {
    const o = this.options
    // Token do socket num arquivo 0600 (não na linha de comando, visível a outros processos).
    this.mcpConfig = join(o.tmpDir, `${o.sessionId}.mcp.json`)
    await writeFile(
      this.mcpConfig,
      JSON.stringify({
        mcpServers: {
          orkio: {
            command: o.nodePath,
            args: [o.bridgeScript],
            env: {
              ELECTRON_RUN_AS_NODE: '1',
              ORKIO_BRIDGE_SOCKET: o.broker.socketPath,
              ORKIO_BRIDGE_TOKEN: o.broker.token
            }
          }
        }
      }),
      { mode: 0o600 }
    )
    const args = [
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--input-format',
      'stream-json',
      '--session-id',
      o.sessionId,
      '--permission-mode',
      'acceptEdits',
      '--settings',
      JSON.stringify(o.delivery ? DELIVERY_RUN_SETTINGS : RUN_SETTINGS),
      '--mcp-config',
      this.mcpConfig,
      '--permission-prompt-tool',
      'mcp__orkio__approve'
    ]
    const spawn = o.spawn ?? nodeSpawn
    const child = spawn(o.claudeCommand, args, {
      cwd: o.cwd,
      env: sanitizeEnv(o.env),
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
      windowsHide: true
    })
    this.child = child
    let stderr = ''
    child.stderr?.on('data', (d: Buffer) => {
      stderr = (stderr + d.toString('utf8')).slice(-4096)
    })
    const lines = createInterface({ input: child.stdout! })
    lines.on('line', (line) => {
      for (const event of parseStreamLine(line, o.cwd)) {
        o.onEvent(event)
        // Terminou o turno: fecha a entrada para o processo encerrar.
        if (event.kind === 'result') child.stdin?.end()
      }
    })
    child.on('error', () => {
      this.finish({ code: null, signal: null, stderr: 'Não foi possível iniciar o Claude Code.' })
    })
    child.on('close', (code, signal) =>
      this.finish({ code, signal, stderr: redactSecrets(stderr) })
    )
    child.stdin?.on('error', () => undefined)
    child.stdin?.write(
      `${JSON.stringify({
        type: 'user',
        message: { role: 'user', content: [{ type: 'text', text: o.prompt }] }
      })}\n`
    )
  }

  /** Cancela: SIGINT → SIGTERM (5 s) → SIGKILL (10 s). */
  cancel(): void {
    const child = this.child
    if (!child || this.ended) return
    child.stdin?.end()
    child.kill('SIGINT')
    this.killTimers.push(
      setTimeout(() => !this.ended && child.kill('SIGTERM'), 5_000),
      setTimeout(() => !this.ended && child.kill('SIGKILL'), 10_000)
    )
  }

  private finish(result: {
    code: number | null
    signal: NodeJS.Signals | null
    stderr: string
  }): void {
    if (this.ended) return
    this.ended = true
    for (const t of this.killTimers) clearTimeout(t)
    if (this.mcpConfig) void rm(this.mcpConfig, { force: true })
    this.options.broker.close()
    this.options.onExit(result)
  }
}
