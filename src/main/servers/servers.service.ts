/**
 * Servidores da tarefa: roda os servidores cadastrados do projeto (frontend, backend…) no worktree
 * da tarefa, cada um num terminal só leitura (`TerminalService`, tipo `server`), com uma porta
 * própria por tarefa+servidor. Eles ficam de pé entre as mensagens (o `claude -p` termina; o
 * servidor não) até você ou o agente pararem, "Limpar ambiente" ou o app fechar.
 *
 * O comando é o que você digitou no cadastro (nunca um comando do agente): o agente só escolhe
 * qual servidor cadastrado subir (entrega 3).
 */
import { join } from 'node:path'
import {
  SERVER_LIMITS,
  isServerLive,
  serverEnv,
  serverProblems,
  serverRefs,
  serverStatePhrase,
  serverUrl,
  type ServerActor,
  type ServerDef,
  type ServerState,
  type ServerView
} from '../../shared/servers'
import type { TerminalView } from '../../shared/terminal'
import { DomainError } from '../errors'
import { redactSecrets, redactValues } from '../platform/redact'

export class ServerError extends DomainError {
  override name = 'ServerError'
}

export const SERVER_MESSAGES = {
  unavailable:
    'O terminal embutido não está disponível neste computador, então o Orkio não consegue rodar servidores.',
  notFound: 'Esse servidor não está cadastrado neste projeto.',
  noWorkspace: 'Esta tarefa ainda não tem pasta de trabalho. Rode o Claude Code primeiro.',
  noDir: (cwd: string) => `A pasta ${cwd} não existe na pasta de trabalho desta tarefa.`,
  tooMany: `Já há ${SERVER_LIMITS.running} servidores rodando. Pare algum antes de subir outro.`,
  noPort: 'Não achei uma porta livre para este servidor.',
  invalid: (message: string) => `Confira o cadastro: ${message}`
} as const

export interface ServerTerminalInput {
  projectId: string
  taskId: string
  cwd: string
  kind: 'server'
  command: string
  title: string
  env: Record<string, string>
  filter: (data: string) => string
  onExit: (exitCode: number) => void
}

export interface ServersServiceDeps {
  defs(projectId: string): ServerDef[]
  saveDefs(projectId: string, defs: ServerDef[]): Promise<void>
  /** Pasta do worktree da tarefa (`null` = ainda não existe). */
  workspace(taskId: string): string | null
  isDir(path: string): boolean
  terminals: {
    readonly available: boolean
    open(input: ServerTerminalInput): TerminalView
    close(id: string): Promise<void>
    /** Saída guardada do terminal (já sem segredos), para o `servidor_log`. */
    snapshot?(id: string): { data: string } | null
  }
  /** Dá para escutar nesta porta (ninguém usa). */
  portFree(port: number): Promise<boolean>
  /** Algo responde nesta porta em localhost. */
  portOpen(port: number): Promise<boolean>
  /** Valores dos `.env*` da pasta (para esconder na saída do servidor). */
  envSecrets(dir: string): string[]
  event(
    ref: { projectId: string; taskId: string },
    e:
      | {
          kind: 'server_started'
          source: 'manual' | 'system'
          detail: { server: string; port: number; by: ServerActor }
        }
      | {
          kind: 'server_stopped'
          source: 'manual' | 'system'
          detail: { server: string; by: ServerActor | 'exit'; exitCode: number | null }
        }
  ): void
  /** A lista de servidores da tarefa mudou (tela). */
  changed(ref: { projectId: string; taskId: string }): void
  now?(): Date
  /** Intervalo da conferência da porta (ms). */
  pollMs?: number
}

interface Entry {
  projectId: string
  taskId: string
  def: ServerDef
  port: number
  terminalId: string | null
  state: ServerState
  by: ServerActor
  exitCode: number | null
  startedAt: string
  /** Resolve quando sai de `starting` (pronto, sem porta, saiu ou parou). */
  settled: Promise<void>
  settle: () => void
}

const keyOf = (taskId: string, serverId: string): string => `${taskId}:${serverId}`

export type ServerToolAction = 'subir' | 'parar' | 'status' | 'log'

/** Resposta de uma ferramenta do agente; `info` = linha do log da execução (o que mudou). */
export interface ServerToolReply {
  ok: boolean
  message: string
  info?: string
}

const LOG_LINES = { default: 60, max: 300 } as const

/** Texto do terminal sem cores/controles do terminal, com `\n` como quebra. */
export function plainTerminalText(data: string): string {
  /* eslint-disable no-control-regex -- sequências de controle do terminal (ESC, BEL) */
  return (
    data
      .replace(/\u001b\][^\u0007\u001b]*(\u0007|\u001b\\)/g, '')
      .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
      .replace(/\u001b[@-_]/g, '')
      /* eslint-enable no-control-regex */
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
  )
}

export class ServersService {
  private readonly entries = new Map<string, Entry>()
  /** Porta lembrada por tarefa+servidor (subir de novo usa a mesma, se livre). */
  private readonly ports = new Map<string, number>()
  /** Subidas em andamento (dois cliques não abrem dois processos). */
  private readonly starting = new Map<string, Promise<ServerView>>()

  constructor(private readonly deps: ServersServiceDeps) {}

  get available(): boolean {
    return this.deps.terminals.available
  }

  defs(projectId: string): ServerDef[] {
    return this.deps.defs(projectId)
  }

  async save(projectId: string, defs: ServerDef[]): Promise<ServerDef[]> {
    const problem = serverProblems(defs)[0]
    if (problem) throw new ServerError('invalid', SERVER_MESSAGES.invalid(problem.message))
    await this.deps.saveDefs(projectId, defs)
    // Servidores rodando que saíram do cadastro continuam listados (para parar).
    for (const e of this.entries.values()) {
      if (e.projectId === projectId) this.deps.changed({ projectId, taskId: e.taskId })
    }
    return this.deps.defs(projectId)
  }

  /** Servidores do cadastro (na ordem) + os que saíram do cadastro e ainda rodam. */
  list(projectId: string, taskId: string): ServerView[] {
    const defs = this.deps.defs(projectId)
    const out = defs.map((def) => this.view(def, this.entries.get(keyOf(taskId, def.id))))
    for (const e of this.entries.values()) {
      if (e.taskId !== taskId || e.projectId !== projectId || !isServerLive(e.state)) continue
      if (!defs.some((d) => d.id === e.def.id)) out.push({ ...this.view(e.def, e), removed: true })
    }
    return out
  }

  /** URL do servidor de pé desta tarefa (abrir no navegador), senão `null`. */
  urlOf(projectId: string, taskId: string, serverId: string): string | null {
    const e = this.entries.get(keyOf(taskId, serverId))
    if (!e || e.projectId !== projectId || !isServerLive(e.state)) return null
    return serverUrl(e.def, e.port)
  }

  /** Espera o servidor sair de `starting` (entrega 3: o agente sabe se ficou pronto). */
  async settled(taskId: string, serverId: string): Promise<ServerView | null> {
    const pending = this.starting.get(keyOf(taskId, serverId))
    if (pending) await pending.catch(() => undefined)
    const e = this.entries.get(keyOf(taskId, serverId))
    if (!e) return null
    await e.settled
    return this.view(e.def, e)
  }

  start(projectId: string, taskId: string, serverId: string, by: ServerActor): Promise<ServerView> {
    const key = keyOf(taskId, serverId)
    const pending = this.starting.get(key)
    if (pending) return pending
    const promise = this.doStart(projectId, taskId, serverId, by).finally(() => {
      this.starting.delete(key)
    })
    this.starting.set(key, promise)
    return promise
  }

  async stop(
    projectId: string,
    taskId: string,
    serverId: string,
    by: ServerActor
  ): Promise<ServerView | null> {
    const key = keyOf(taskId, serverId)
    await this.starting.get(key)?.catch(() => undefined)
    const e = this.entries.get(key)
    if (!e || e.projectId !== projectId) {
      const def = this.deps.defs(projectId).find((d) => d.id === serverId)
      return def ? this.view(def, undefined) : null
    }
    if (isServerLive(e.state)) {
      // Marca antes de fechar: a saída do processo agora não conta como "parou sozinho".
      e.state = 'stopped'
      e.settle()
      const terminalId = e.terminalId
      e.terminalId = null
      if (terminalId) await this.deps.terminals.close(terminalId)
      this.deps.event(
        { projectId, taskId },
        {
          kind: 'server_stopped',
          source: by === 'you' ? 'manual' : 'system',
          detail: { server: e.def.name, by, exitCode: null }
        }
      )
    } else if (e.terminalId) {
      // Saiu sozinho: "Parar" só limpa o terminal guardado.
      await this.deps.terminals.close(e.terminalId)
    }
    this.entries.delete(key)
    this.deps.changed({ projectId, taskId })
    return this.view(e.def, undefined)
  }

  /** Para tudo da tarefa ("Limpar ambiente"). */
  async stopTask(taskId: string): Promise<void> {
    const mine = [...this.entries.values()].filter((e) => e.taskId === taskId)
    await Promise.all(mine.map((e) => this.stop(e.projectId, taskId, e.def.id, 'you')))
  }

  /**
   * Ferramentas `servidor_*` do agente (pela ponte). Só os servidores cadastrados, pelo nome; num
   * passo só de leitura, só status e log (a política já nega, aqui é a segunda trava).
   */
  async agentTool(
    ref: { projectId: string; taskId: string },
    action: ServerToolAction,
    input: Record<string, unknown>,
    readOnly: boolean
  ): Promise<ServerToolReply> {
    const { projectId, taskId } = ref
    if (action === 'status') {
      const views = this.list(projectId, taskId)
      if (views.length === 0)
        return { ok: true, message: 'Este projeto não tem servidores cadastrados.' }
      return {
        ok: true,
        message: views.map((s) => `- ${s.name}: ${serverStatePhrase(s)}`).join('\n')
      }
    }
    if (readOnly && (action === 'subir' || action === 'parar')) {
      return {
        ok: false,
        message: 'Este passo só lê: subir e parar servidores não estão disponíveis.'
      }
    }
    const defs = this.deps.defs(projectId)
    const name = typeof input['nome'] === 'string' ? input['nome'].trim() : ''
    const def = defs.find((d) => d.name === name)
    if (!def) {
      const names = defs.map((d) => d.name).join(', ')
      return {
        ok: false,
        message: names
          ? `Não há servidor "${name}" nesta tarefa. Cadastrados: ${names}.`
          : 'Este projeto não tem servidores cadastrados.'
      }
    }
    try {
      if (action === 'subir') return await this.agentStart(projectId, taskId, def)
      if (action === 'parar') {
        const live = this.list(projectId, taskId).find((s) => s.id === def.id)
        if (!live || !isServerLive(live.state)) {
          return { ok: true, message: `${def.name} já estava parado.` }
        }
        await this.stop(projectId, taskId, def.id, 'agent')
        return { ok: true, message: `${def.name} parado.`, info: `Parou o servidor ${def.name}` }
      }
      const raw =
        typeof input['linhas'] === 'number' ? Math.floor(input['linhas']) : LOG_LINES.default
      const lines = Math.min(Math.max(raw, 1), LOG_LINES.max)
      const tail = this.tail(taskId, def.id, lines)
      if (tail === null) return { ok: true, message: `${def.name} ainda não rodou nesta tarefa.` }
      return { ok: true, message: `Últimas linhas de ${def.name}:\n\`\`\`\n${tail}\n\`\`\`` }
    } catch (error) {
      if (error instanceof ServerError) return { ok: false, message: error.message }
      throw error
    }
  }

  private async agentStart(
    projectId: string,
    taskId: string,
    def: ServerDef
  ): Promise<ServerToolReply> {
    const started = await this.start(projectId, taskId, def.id, 'agent')
    const view = (await this.settled(taskId, def.id)) ?? started
    const tail = (): string => {
      const t = this.tail(taskId, def.id, 40)
      return t ? `\nFim do log:\n\`\`\`\n${t}\n\`\`\`` : ''
    }
    switch (view.state) {
      case 'ready':
        return {
          ok: true,
          message: `${def.name} está de pé em ${view.url} (porta ${view.port}). Fica rodando até alguém parar.`,
          info: `Subiu o servidor ${def.name} (${view.url})`
        }
      case 'no_port':
        return {
          ok: false,
          message: `${def.name} subiu, mas não respondeu na porta ${view.port} em ${SERVER_LIMITS.readyMs / 1000} s (continua rodando; use servidor_log para acompanhar).${tail()}`,
          info: `Subiu o servidor ${def.name}, sem resposta na porta ${view.port}`
        }
      case 'exited':
        return {
          ok: false,
          message: `${def.name} parou sozinho${view.exitCode === null ? '' : ` (código ${view.exitCode})`}.${tail()}`
        }
      default:
        return { ok: false, message: `${def.name}: ${serverStatePhrase(view)}.` }
    }
  }

  /** Últimas `lines` linhas da saída do servidor (sem cores), ou `null` sem terminal. */
  private tail(taskId: string, serverId: string, lines: number): string | null {
    const id = this.entries.get(keyOf(taskId, serverId))?.terminalId
    const snap = id ? this.deps.terminals.snapshot?.(id) : null
    if (!snap) return null
    const all = plainTerminalText(snap.data).replace(/\n+$/, '').split('\n')
    return all.slice(-lines).join('\n')
  }

  /** Portas dos servidores de pé desta tarefa (política: Playwright no localhost delas). */
  livePorts(taskId: string): number[] {
    return [...this.entries.values()]
      .filter((e) => e.taskId === taskId && isServerLive(e.state))
      .map((e) => e.port)
  }

  /** Algum servidor de pé (contagem do limite e da tela). */
  running(): number {
    return [...this.entries.values()].filter((e) => isServerLive(e.state)).length
  }

  private async doStart(
    projectId: string,
    taskId: string,
    serverId: string,
    by: ServerActor
  ): Promise<ServerView> {
    if (!this.deps.terminals.available) {
      throw new ServerError('unavailable', SERVER_MESSAGES.unavailable)
    }
    const defs = this.deps.defs(projectId)
    const index = defs.findIndex((d) => d.id === serverId)
    const def = defs[index]
    if (!def) throw new ServerError('not_found', SERVER_MESSAGES.notFound)
    const key = keyOf(taskId, serverId)
    const current = this.entries.get(key)
    if (current && isServerLive(current.state)) return this.view(current.def, current)
    if (this.running() >= SERVER_LIMITS.running) {
      throw new ServerError('too_many', SERVER_MESSAGES.tooMany)
    }
    const root = this.deps.workspace(taskId)
    if (!root || !this.deps.isDir(root)) {
      throw new ServerError('no_workspace', SERVER_MESSAGES.noWorkspace)
    }
    const dir = def.cwd ? join(root, def.cwd) : root
    if (!this.deps.isDir(dir))
      throw new ServerError('no_dir', SERVER_MESSAGES.noDir(def.cwd ?? '.'))
    // Terminal de uma saída anterior (para ler o erro): sai antes do novo.
    if (current?.terminalId) await this.deps.terminals.close(current.terminalId)
    this.entries.delete(key)

    const port = await this.portFor(taskId, def, index)
    // Os servidores citados (`{backend.url}`) ganham a porta agora: subir depois usa a mesma.
    for (const name of serverRefs(def)) {
      const i = defs.findIndex((d) => d.name === name)
      if (i >= 0) await this.portFor(taskId, defs[i]!, i)
    }
    const env = serverEnv(def, defs, (id) => this.ports.get(keyOf(taskId, id)) ?? 0)
    const secrets = this.deps.envSecrets(root)
    const filter = (data: string): string => redactValues(redactSecrets(data), secrets)
    let settle = (): void => undefined
    const settled = new Promise<void>((resolve) => {
      settle = resolve
    })
    const entry: Entry = {
      projectId,
      taskId,
      def,
      port,
      terminalId: null,
      state: 'starting',
      by,
      exitCode: null,
      startedAt: (this.deps.now?.() ?? new Date()).toISOString(),
      settled,
      settle
    }
    const terminal = this.deps.terminals.open({
      projectId,
      taskId,
      cwd: dir,
      kind: 'server',
      command: def.command,
      title: def.name,
      env,
      filter,
      onExit: (exitCode) => this.exited(entry, exitCode)
    })
    entry.terminalId = terminal.id
    this.entries.set(key, entry)
    this.deps.event(
      { projectId, taskId },
      {
        kind: 'server_started',
        source: by === 'you' ? 'manual' : 'system',
        detail: { server: def.name, port, by }
      }
    )
    this.deps.changed({ projectId, taskId })
    void this.watch(entry)
    return this.view(def, entry)
  }

  /** "Pronto" = a porta responde; sem isso no prazo, `no_port` (o processo continua). */
  private async watch(e: Entry): Promise<void> {
    const pollMs = this.deps.pollMs ?? 500
    const deadline = Date.now() + SERVER_LIMITS.readyMs
    while (e.state === 'starting') {
      if (await this.deps.portOpen(e.port).catch(() => false)) {
        if (e.state !== 'starting') return
        e.state = 'ready'
        break
      }
      if (Date.now() >= deadline) {
        if (e.state === 'starting') e.state = 'no_port'
        break
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs))
    }
    e.settle()
    if (this.entries.get(keyOf(e.taskId, e.def.id)) === e) {
      this.deps.changed({ projectId: e.projectId, taskId: e.taskId })
    }
  }

  private exited(e: Entry, exitCode: number): void {
    if (!isServerLive(e.state)) return
    e.state = 'exited'
    e.exitCode = exitCode
    e.settle()
    this.deps.event(
      { projectId: e.projectId, taskId: e.taskId },
      {
        kind: 'server_stopped',
        source: 'system',
        detail: { server: e.def.name, by: 'exit', exitCode }
      }
    )
    this.deps.changed({ projectId: e.projectId, taskId: e.taskId })
  }

  /** Porta estável por tarefa+servidor; nunca a de outro servidor lembrado. */
  private async portFor(taskId: string, def: ServerDef, index: number): Promise<number> {
    const key = keyOf(taskId, def.id)
    const taken = new Set<number>()
    for (const [k, p] of this.ports) if (k !== key) taken.add(p)
    const free = async (port: number): Promise<boolean> =>
      !taken.has(port) &&
      !(await this.deps.portOpen(port).catch(() => false)) &&
      (await this.deps.portFree(port).catch(() => false))
    const remembered = this.ports.get(key)
    if (remembered !== undefined) {
      const live = this.entries.get(key)
      if ((live && isServerLive(live.state)) || (await free(remembered))) return remembered
    }
    const base = SERVER_LIMITS.basePort + index * SERVER_LIMITS.portSpan
    for (let port = base; port < base + SERVER_LIMITS.portSpan; port++) {
      if (await free(port)) {
        this.ports.set(key, port)
        return port
      }
    }
    throw new ServerError('no_port', SERVER_MESSAGES.noPort)
  }

  private view(def: ServerDef, e: Entry | undefined): ServerView {
    const live = e !== undefined && isServerLive(e.state)
    return {
      id: def.id,
      name: def.name,
      command: def.command,
      state: e?.state ?? 'stopped',
      port: e?.port ?? null,
      url: live ? serverUrl(def, e.port) : null,
      terminalId: e?.terminalId ?? null,
      by: e?.by ?? null,
      exitCode: e?.exitCode ?? null,
      startedAt: e?.startedAt ?? null
    }
  }
}
