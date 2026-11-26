/**
 * Processo do Claude Code de uma execução (Etapa 4A): `claude -p` (CLI do usuário, com o login
 * dele) via spawn SEM shell, cwd = worktree, entrada/saída `stream-json`.
 *
 * Permissões em camadas: `--permission-mode acceptEdits` (editar no worktree), `--settings` com
 * `blockWritesOutsideWorkingDirectories` e o deny gerado da tabela do GitHub/push
 * (`github-rules.ts`), e `--permission-prompt-tool` apontando para o servidor MCP do Orkio
 * (bridge/permission-mcp.ts), que pergunta ao main. Os argumentos saem de `buildCliArgs(spec)`.
 */
import { isSessionUuid } from '../../shared/terminal'
import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process'
import { createServer, type Server, type Socket } from 'node:net'
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { chmod, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import type { RunLogEvent } from '../../shared/agent-run'
import { isEffort, isModelName } from '../../shared/agent-runtime'
import { READ_ONLY_DENIED_TOOLS } from '../../shared/task-flow'
import {
  BRIDGE_ENV,
  BRIDGE_PROMPT_TOOL,
  BRIDGE_SERVER,
  decodeBridgeMessage,
  type BridgeDecision,
  type BridgeRememberReply,
  type BridgeRequest
} from './bridge/protocol'
import { cliDenyInDelivery, cliDenyOutsideDelivery } from './github-rules'
import { redactSecrets, sanitizeEnv } from '../platform/redact'
import { deliveryOf, type RunSpec } from './run-spec'
import { parseStreamLine, toolImages, type ToolImage } from './stream'
import type { RunExtras } from '../mcp/run-extras'

export type SpawnFn = typeof nodeSpawn

/** Janela de contexto que o CLI informou por modelo (no fim de cada turno), para as próximas execuções. */
const LEARNED_WINDOWS = new Map<string, number>()
export type { BridgeDecision, BridgeRememberReply, BridgeRequest }

/**
 * Socket local de uso único entre o servidor MCP (bridge) e o main: pedidos de permissão e, com
 * `onRemember`, as notas da ferramenta `lembrar` (memória do agente).
 */
export class PermissionBroker {
  private server: Server | null = null
  readonly token = randomBytes(24).toString('hex')
  readonly socketPath =
    process.platform === 'win32'
      ? `\\\\.\\pipe\\orkio-${randomUUID()}`
      : join(tmpdir(), `orkio-${randomUUID().slice(0, 12)}.sock`)

  constructor(
    private readonly onRequest: (req: BridgeRequest) => Promise<BridgeDecision>,
    private readonly onRemember?: (input: Record<string, unknown>) => Promise<BridgeRememberReply>
  ) {}

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

  private async answer(line: string): Promise<BridgeDecision | BridgeRememberReply> {
    const msg = decodeBridgeMessage(line)
    if (!msg) return { behavior: 'deny', message: 'Pedido inválido.' }
    const token = Buffer.from(msg.token)
    const expected = Buffer.from(this.token)
    const authorized = token.length === expected.length && timingSafeEqual(token, expected)
    if (msg.message.kind === 'remember') {
      if (!authorized) return { ok: false, message: 'Pedido não autorizado.' }
      if (!this.onRemember)
        return { ok: false, message: 'A memória não está ligada nesta execução.' }
      return this.onRemember(msg.message.input).catch((): BridgeRememberReply => ({
        ok: false,
        message: 'Falha ao gravar a memória.'
      }))
    }
    if (!authorized) return { behavior: 'deny', message: 'Pedido não autorizado.' }
    return this.onRequest(msg.message.request).catch((): BridgeDecision => ({
      behavior: 'deny',
      message: 'Falha ao decidir a permissão.'
    }))
  }
}

export interface RunnerOptions {
  claudeCommand: string
  /** A execução (sessão, ferramentas, GitHub, agente, modelo): vira os argumentos do CLI. */
  spec: RunSpec
  cwd: string
  prompt: string
  /** Id da sessão (o da sessão retomada, no `--resume`). */
  sessionId: string
  broker: PermissionBroker
  /** Executável do Node do Electron e o script do servidor MCP de permissões. */
  nodePath: string
  bridgeScript: string
  /** Pasta para o mcp-config temporário (0600, apagado no fim). */
  tmpDir: string
  env: NodeJS.ProcessEnv
  /**
   * Fase 4: servidores MCP do Orkio (no mcp-config, com os segredos de cada um), segredos do agente
   * (ambiente do processo) e skills negadas (deny do `--settings`). Resolvido pelo RunService.
   */
  extras?: RunExtras
  onEvent(event: RunLogEvent): void
  /** Imagens dos `tool_result` (print, `Read` de imagem): bytes, fora do log. */
  onImage?(image: ToolImage): void
  onExit(result: { code: number | null; signal: NodeJS.Signals | null; stderr: string }): void
  spawn?: SpawnFn
}

/**
 * Fora do modo entrega: o CLI nega o que escreve no GitHub mesmo se o usuário tiver uma regra de
 * "permitir" no `~/.claude`. Ler a PR passa pela política do Orkio (`isGhRead`).
 */
export const RUN_SETTINGS = {
  permissions: { blockWritesOutsideWorkingDirectories: true, deny: cliDenyOutsideDelivery() }
}

/**
 * Modo entrega (5C): push e gh passam a ser decididos pela política do Orkio (ferramenta de
 * permissão); o CLI continua negando o que nunca é permitido.
 */
export const DELIVERY_RUN_SETTINGS = {
  permissions: { blockWritesOutsideWorkingDirectories: true, deny: cliDenyInDelivery() }
}

/**
 * Sessão no CLI: nova com o nosso id, retomada, ou ramificada de um ponto de outra (o id novo é
 * nosso: `--session-id` com `--resume` exige `--fork-session`). Ids passam pelo formato exato.
 */
export function sessionArgs(session: RunSpec['session'], sessionId: string): string[] {
  if (session.kind === 'resume') return ['--resume', session.id]
  if (session.kind === 'fork') {
    if (!isSessionUuid(session.from) || !isSessionUuid(session.at)) {
      throw new Error('Sessão inválida para ramificar.')
    }
    return [
      '--resume',
      session.from,
      '--resume-session-at',
      session.at,
      '--fork-session',
      '--session-id',
      sessionId
    ]
  }
  return ['--session-id', sessionId]
}

/** Argumentos do `claude` para uma execução (puro). */
export function buildCliArgs(
  spec: Pick<RunSpec, 'session' | 'access' | 'agent' | 'runtime' | 'askEdits'>,
  run: { sessionId: string; mcpConfig: string; deny?: readonly string[] }
): string[] {
  const base = deliveryOf(spec) ? DELIVERY_RUN_SETTINGS : RUN_SETTINGS
  // Fase 4: skills desligadas no projeto entram no deny (só regras `Skill(nome)` validadas).
  const extraDeny = (run.deny ?? []).filter((d) =>
    /^Skill\([A-Za-z0-9][A-Za-z0-9:._-]{0,99}\)$/.test(d)
  )
  const settings =
    extraDeny.length > 0
      ? { permissions: { ...base.permissions, deny: [...base.permissions.deny, ...extraDeny] } }
      : base
  const readOnly = spec.access.tools === 'read_only'
  // Agente que pede antes de editar (Fase 3): nada é aprovado sozinho pelo CLI; a política decide.
  const askEdits = spec.agent?.autonomy === 'ask' || (!spec.agent && spec.askEdits === true)
  const { model, effort } = spec.runtime
  return [
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
    '--input-format',
    'stream-json',
    ...sessionArgs(spec.session, run.sessionId),
    // Lista num argumento só, separada por vírgula; a opção aceita vários valores, então vem
    // antes de outra flag (nada solto depois dela).
    ...(readOnly ? ['--disallowedTools', READ_ONLY_DENIED_TOOLS.join(',')] : []),
    '--permission-mode',
    // Só leitura: nada é aprovado sozinho (nem comandos de arquivo no shell); tudo passa pela
    // ferramenta de permissão do Orkio.
    readOnly || askEdits ? 'manual' : 'acceptEdits',
    '--settings',
    JSON.stringify(settings),
    '--mcp-config',
    run.mcpConfig,
    '--permission-prompt-tool',
    BRIDGE_PROMPT_TOOL,
    ...appendPrompt(spec),
    // Nada que pareça outra flag chega ao CLI: valida aqui, de novo, antes de montar os args.
    ...(isModelName(model) ? ['--model', model] : []),
    ...(isEffort(effort) ? ['--effort', effort] : [])
  ]
}

/** O Orkio liga a PR à tarefa pela branch; o link na página do Notion só polui a tarefa. */
const NOTION_PR_NOTE =
  'Regra do Orkio: Não grave o link da PR na tarefa do Notion (nem em campo, nem no texto da página), mesmo que um comando peça; o Orkio já liga a PR à tarefa pela branch. Pule esse passo sem perguntar.'

/**
 * O que vai no `--append-system-prompt`: as instruções do agente e, quando o projeto deixa os
 * agentes entregarem (destinos de PR restritos), como enviar e para onde vai a PR. Vale mais que o
 * briefing antigo da sessão ("não faça push").
 */
function appendPrompt(spec: Pick<RunSpec, 'access' | 'agent'>): string[] {
  const deliver = deliveryOf(spec)
  const bases = deliver?.target.prBases
  const note =
    deliver && bases?.length
      ? [
          'Entrega nesta tarefa (regra do Orkio, vale mais que o briefing):',
          `- Você PODE enviar a branch da tarefa: git push ${deliver.target.remote} ${deliver.target.branch}.`,
          `- Você PODE abrir/atualizar a PR dela com gh pr create --base ${bases[0]} (destinos permitidos: ${bases.join(', ')}).`,
          '- Nunca para main ou master; nada de merge, força ou apagar branch.'
        ].join('\n')
      : null
  const text = [spec.agent?.prompt, note, NOTION_PR_NOTE].filter(Boolean).join('\n\n')
  return ['--append-system-prompt', text]
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
          // Servidores do Orkio primeiro; a ponte por último (o nome dela nunca é sobrescrito).
          ...Object.fromEntries(
            Object.entries(o.extras?.mcpServers ?? {}).filter(([name]) => name !== BRIDGE_SERVER)
          ),
          [BRIDGE_SERVER]: {
            command: o.nodePath,
            args: [o.bridgeScript],
            env: {
              ELECTRON_RUN_AS_NODE: '1',
              [BRIDGE_ENV.socket]: o.broker.socketPath,
              [BRIDGE_ENV.token]: o.broker.token,
              // Memória do agente (Fase 3): a ferramenta `lembrar` só existe com agente.
              ...(o.spec.agent ? { [BRIDGE_ENV.memory]: '1' } : {})
            }
          }
        }
      }),
      { mode: 0o600 }
    )
    const args = buildCliArgs(o.spec, {
      sessionId: o.sessionId,
      mcpConfig: this.mcpConfig,
      deny: o.extras?.deny ?? []
    })
    const spawn = o.spawn ?? nodeSpawn
    const child = spawn(o.claudeCommand, args, {
      cwd: o.cwd,
      // Segredos do agente (Fase 4) depois do filtro: os nomes reservados já foram recusados.
      env: { ...sanitizeEnv(o.env), ...(o.extras?.env ?? {}) },
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
    let model: string | null = null
    lines.on('line', (line) => {
      const known = model ? (LEARNED_WINDOWS.get(model) ?? null) : null
      for (const event of parseStreamLine(line, o.cwd, undefined, model, known)) {
        if (event.kind === 'init') model = event.model
        if (event.kind === 'result' && event.contextWindow && model) {
          LEARNED_WINDOWS.set(model, event.contextWindow)
        }
        o.onEvent(event)
        // Terminou o turno: fecha a entrada para o processo encerrar.
        if (event.kind === 'result') child.stdin?.end()
      }
      // Só relê a linha quando pode ter imagem (o JSON grande do print não passa duas vezes à toa).
      if (o.onImage && line.includes('"image"')) for (const img of toolImages(line)) o.onImage(img)
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
