/**
 * Servidores da tarefa (entrega 2 do design "Servidores e imagens"): o cadastro por projeto
 * (`orkio-config.servers[projectId]`), as regras de validação (mesmas na tela e no main), a URL e o
 * ambiente de cada servidor. Puro, sem Node/DOM: quem roda é o `ServersService` no main.
 */
import { isRecord } from './guards'
import { secretNameProblem } from './vault'

export interface ServerDef {
  /** Id estável (`s-…`): a porta lembrada e o estado são por id, não por nome. */
  id: string
  /** Como você e o agente chamam ("frontend", "backend"). */
  name: string
  /** Linha de shell digitada por você, rodada com o seu shell (`-lc`) no worktree. */
  command: string
  /** Subpasta relativa do worktree (`apps/web`). */
  cwd?: string
  /** Variável com a porta (padrão `PORT`). */
  portEnv?: string
  /** Modelo da URL (padrão `http://localhost:{port}`). */
  url?: string
  /** Variáveis extras; `{nome.url}` e `{nome.port}` apontam para outro servidor do projeto. */
  env?: Record<string, string>
}

export const SERVER_LIMITS = {
  perProject: 6,
  /** Servidores rodando ao mesmo tempo (todas as tarefas). */
  running: 8,
  name: 24,
  command: 500,
  cwd: 200,
  url: 200,
  envVars: 20,
  envValue: 500,
  /** Quanto esperar a porta responder antes de dizer "não abriu a porta". */
  readyMs: 120_000,
  /** Primeira porta do primeiro servidor; cada posição do cadastro ganha a sua faixa. */
  basePort: 4100,
  portSpan: 100
} as const

export const DEFAULT_PORT_ENV = 'PORT'
export const DEFAULT_SERVER_URL = 'http://localhost:{port}'

const NAME = /^[a-z][a-z0-9-]{0,23}$/
const ID = /^s-[a-z0-9-]{1,40}$/
const CWD = /^[\w.\-/]+$/
const URL_TEMPLATE = /^http:\/\/(localhost|127\.0\.0\.1):\{port\}(\/[\w\-./]*)?$/
const REF = /\{([a-z][a-z0-9-]{0,23})\.(url|port)\}/g

export function isServerId(v: unknown): v is string {
  return typeof v === 'string' && ID.test(v)
}

export function isServerName(v: unknown): v is string {
  return typeof v === 'string' && NAME.test(v)
}

export type ServerField = 'name' | 'command' | 'cwd' | 'portEnv' | 'url' | 'env'

export interface ServerProblem {
  index: number
  field: ServerField
  message: string
}

/** Servidores citados nas variáveis (`{backend.url}` → `backend`), sem repetir. */
export function serverRefs(def: ServerDef): string[] {
  const out = new Set<string>()
  for (const value of Object.values(def.env ?? {})) {
    for (const m of value.matchAll(REF)) out.add(m[1]!)
  }
  return [...out]
}

function cwdProblem(cwd: string): string | null {
  if (
    cwd.length > SERVER_LIMITS.cwd ||
    !CWD.test(cwd) ||
    cwd.startsWith('/') ||
    cwd.split('/').some((part) => part === '..')
  ) {
    return 'Use uma subpasta do projeto (ex.: apps/web), sem ".." nem caminho absoluto.'
  }
  return null
}

function envProblem(def: ServerDef, names: ReadonlySet<string>): string | null {
  const entries = Object.entries(def.env ?? {})
  if (entries.length > SERVER_LIMITS.envVars) return `No máximo ${SERVER_LIMITS.envVars} variáveis.`
  for (const [key, value] of entries) {
    const bad = secretNameProblem(key)
    if (bad) return `${key}: ${bad}`
    if (value.length > SERVER_LIMITS.envValue || /[\r\n\0]/.test(value)) {
      return `${key}: valor de uma linha, até ${SERVER_LIMITS.envValue} caracteres.`
    }
  }
  for (const ref of serverRefs(def)) {
    if (ref === def.name) return `{${ref}.…} aponta para o próprio servidor.`
    if (!names.has(ref)) return `Não há servidor chamado "${ref}" neste projeto.`
  }
  return null
}

/** O que impede salvar o cadastro (vazio = pode salvar). A mesma regra na tela e no main. */
export function serverProblems(defs: readonly ServerDef[]): ServerProblem[] {
  const out: ServerProblem[] = []
  const names = new Set(defs.map((d) => d.name))
  const seen = new Set<string>()
  defs.forEach((def, index) => {
    const add = (field: ServerField, message: string): void => {
      out.push({ index, field, message })
    }
    if (index >= SERVER_LIMITS.perProject) {
      add('name', `No máximo ${SERVER_LIMITS.perProject} servidores por projeto.`)
      return
    }
    if (!NAME.test(def.name)) {
      add('name', 'Use letras minúsculas, números e "-" (ex.: frontend), até 24.')
    } else if (seen.has(def.name)) {
      add('name', 'Já existe um servidor com esse nome.')
    }
    seen.add(def.name)
    const command = def.command.trim()
    if (!command || command.length > SERVER_LIMITS.command || /[\r\n\0]/.test(def.command)) {
      add('command', `Uma linha só, até ${SERVER_LIMITS.command} caracteres (ex.: pnpm dev).`)
    }
    if (def.cwd !== undefined) {
      const bad = cwdProblem(def.cwd)
      if (bad) add('cwd', bad)
    }
    if (def.portEnv !== undefined) {
      const bad = secretNameProblem(def.portEnv)
      if (bad) add('portEnv', bad)
    }
    if (
      def.url !== undefined &&
      (def.url.length > SERVER_LIMITS.url || !URL_TEMPLATE.test(def.url))
    ) {
      add('url', 'Use http://localhost:{port} (ou 127.0.0.1), com {port} e um caminho opcional.')
    }
    const env = envProblem(def, names)
    if (env) add('env', env)
  })
  return out
}

export function serverUrl(def: ServerDef, port: number): string {
  return (def.url ?? DEFAULT_SERVER_URL).replace('{port}', String(port))
}

/** Ambiente do servidor: a porta na variável dele e as extras com as referências trocadas. */
export function serverEnv(
  def: ServerDef,
  defs: readonly ServerDef[],
  portOf: (serverId: string) => number
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(def.env ?? {})) {
    out[key] = value.replace(REF, (whole, name: string, what: string) => {
      const target = defs.find((d) => d.name === name)
      if (!target) return whole
      const port = portOf(target.id)
      return what === 'port' ? String(port) : serverUrl(target, port)
    })
  }
  out[def.portEnv ?? DEFAULT_PORT_ENV] = String(portOf(def.id))
  return out
}

function parseEnv(v: unknown): Record<string, string> | null {
  if (!isRecord(v)) return null
  const out: Record<string, string> = {}
  for (const [k, value] of Object.entries(v)) {
    if (typeof value !== 'string') return null
    out[k] = value
  }
  return out
}

/** Um servidor do cadastro (forma), ou `null`. Os limites ficam com `serverProblems`. */
export function parseServerDef(v: unknown): ServerDef | null {
  if (!isRecord(v)) return null
  const { id, name, command, cwd, portEnv, url, env } = v
  if (!isServerId(id) || typeof name !== 'string' || typeof command !== 'string') return null
  const def: ServerDef = { id, name, command }
  if (cwd !== undefined) {
    if (typeof cwd !== 'string') return null
    if (cwd) def.cwd = cwd
  }
  if (portEnv !== undefined) {
    if (typeof portEnv !== 'string') return null
    if (portEnv) def.portEnv = portEnv
  }
  if (url !== undefined) {
    if (typeof url !== 'string') return null
    if (url) def.url = url
  }
  if (env !== undefined) {
    const parsed = parseEnv(env)
    if (!parsed) return null
    if (Object.keys(parsed).length > 0) def.env = parsed
  }
  return def
}

/** Cadastro lido da config: o que não é servidor some (nunca derruba a config). */
export function parseServerDefs(v: unknown): ServerDef[] {
  if (!Array.isArray(v)) return []
  return v.map(parseServerDef).filter((d): d is ServerDef => d !== null)
}

/** `stopped` parado; `starting` esperando a porta; `ready` respondendo; `no_port` rodando sem
 * abrir a porta no prazo; `exited` saiu sozinho (erro de compilação, porta ocupada…). */
export type ServerState = 'stopped' | 'starting' | 'ready' | 'no_port' | 'exited'

export type ServerActor = 'you' | 'agent'

export interface ServerView {
  id: string
  name: string
  command: string
  state: ServerState
  port: number | null
  /** Só com o servidor de pé (`starting`/`ready`/`no_port`). */
  url: string | null
  /** Terminal (só leitura) com a saída do servidor; fica depois de sair, para ler o erro. */
  terminalId: string | null
  by: ServerActor | null
  exitCode: number | null
  startedAt: string | null
  /** Saiu do cadastro, mas ainda roda (para parar). */
  removed?: true
}

export interface TaskServers {
  /** `false` = o terminal embutido não carregou: não dá para rodar servidores aqui. */
  available: boolean
  servers: ServerView[]
}

export interface ServersChangedEvent {
  projectId: string
  taskId: string
}

export function isServerLive(state: ServerState): boolean {
  return state === 'starting' || state === 'ready' || state === 'no_port'
}
