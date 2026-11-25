/**
 * Fase 4: os servidores MCP que o Claude Code do usuário já carrega, só para leitura. Lê o
 * `~/.claude.json` (escopo do usuário e o "local" de cada projeto do Orkio) e o `.mcp.json` de cada
 * projeto. Para o renderer sai só nome, onde, tipo, um resumo do comando sem segredos e os NOMES
 * das variáveis/cabeçalhos; os valores nunca saem do main. "Copiar para o Orkio" relê o arquivo
 * aqui e troca todo valor sensível por referência a um segredo do Vault.
 */
import { readFile, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { isRecord } from '../../shared/guards'
import {
  MCP_LIMITS,
  freeMcpId,
  isMcpCommand,
  isSensitiveName,
  mcpUrlProblem,
  parseMcpServer,
  type ClaudeMcpEntry,
  type ClaudeMcpRef,
  type McpBinding,
  type McpServer
} from '../../shared/mcp'
import { isSecretName, secretNameProblem } from '../../shared/vault'
import { redactSecrets } from '../platform/redact'

/** Definição crua lida do arquivo (fica no main). */
export interface ClaudeMcpRaw {
  ref: ClaudeMcpRef
  where: string
  def: Record<string, unknown>
}

export interface ClaudeMcpSources {
  /** `~/.claude.json` (ou `$CLAUDE_CONFIG_DIR/.claude.json`). */
  claudeJson: string
  projects: { id: string; name: string; localPath: string }[]
}

export interface ClaudeMcpFs {
  /** Conteúdo do arquivo, `null` se não existe; lança se existe e não dá para ler. */
  read(path: string, maxBytes: number): Promise<string | null>
}

export const realClaudeMcpFs: ClaudeMcpFs = {
  async read(path, maxBytes) {
    let size: number
    try {
      size = (await stat(path)).size
    } catch {
      return null
    }
    if (size > maxBytes) throw new Error('grande demais')
    return readFile(path, 'utf8')
  }
}

export function claudeJsonPath(env: NodeJS.ProcessEnv, home: string): string {
  const dir = env['CLAUDE_CONFIG_DIR']
  return dir && dir.startsWith('/') ? join(dir, '.claude.json') : join(home, '.claude.json')
}

const CLAUDE_JSON_MAX = 32 * 1024 * 1024
const MCP_JSON_MAX = 1024 * 1024
const MAX_ENTRIES = 100

export const CLAUDE_MCP_MESSAGES = {
  unreadable: 'Não deu para ler as configurações do seu Claude Code.',
  notFound: 'Esse servidor não está mais nas configurações do seu Claude Code.',
  secretArg:
    'Esse servidor tem um segredo nos argumentos. Adicione à mão, pondo o valor no Segredos.',
  unsupported: 'Esse tipo de servidor não dá para copiar (só comando local ou http).'
} as const

function serversOf(value: unknown): [string, Record<string, unknown>][] {
  if (!isRecord(value)) return []
  return Object.entries(value).filter(
    (e): e is [string, Record<string, unknown>] =>
      e[0].length > 0 && e[0].length <= 100 && isRecord(e[1])
  )
}

function parseJson(text: string | null): unknown {
  if (text === null) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new Error('json')
  }
}

/** Lê tudo (lança só se um arquivo existe e não dá para ler/entender). */
export async function readClaudeMcp(
  sources: ClaudeMcpSources,
  fs: ClaudeMcpFs = realClaudeMcpFs
): Promise<{ entries: ClaudeMcpRaw[]; error: string | null }> {
  const entries: ClaudeMcpRaw[] = []
  let error: string | null = null
  try {
    const json = parseJson(await fs.read(sources.claudeJson, CLAUDE_JSON_MAX))
    if (isRecord(json)) {
      for (const [name, def] of serversOf(json['mcpServers'])) {
        entries.push({ ref: { scope: 'user', name, projectId: null }, where: 'Seu usuário', def })
      }
      const projects = isRecord(json['projects']) ? json['projects'] : {}
      for (const p of sources.projects) {
        const local = projects[p.localPath]
        if (!isRecord(local)) continue
        for (const [name, def] of serversOf(local['mcpServers'])) {
          entries.push({ ref: { scope: 'local', name, projectId: p.id }, where: p.name, def })
        }
      }
    }
  } catch {
    error = CLAUDE_MCP_MESSAGES.unreadable
  }
  for (const p of sources.projects) {
    try {
      const json = parseJson(await fs.read(join(p.localPath, '.mcp.json'), MCP_JSON_MAX))
      if (!isRecord(json)) continue
      for (const [name, def] of serversOf(json['mcpServers'])) {
        entries.push({
          ref: { scope: 'project', name, projectId: p.id },
          where: `${p.name} (.mcp.json)`,
          def
        })
      }
    } catch {
      error = CLAUDE_MCP_MESSAGES.unreadable
    }
  }
  return { entries: entries.slice(0, MAX_ENTRIES), error }
}

function transportOf(def: Record<string, unknown>): ClaudeMcpEntry['transport'] {
  const type = def['type']
  if (type === 'http' || type === 'sse') return type
  if (type === 'stdio' || (type === undefined && typeof def['command'] === 'string')) return 'stdio'
  if (type === undefined && typeof def['url'] === 'string') return 'http'
  return 'unknown'
}

/** Argumento com cara de segredo (ou valor de uma flag sensível): não sai do main. */
function secretArgIndexes(args: string[]): Set<number> {
  const out = new Set<number>()
  args.forEach((arg, i) => {
    if (redactSecrets(arg) !== arg) out.add(i)
    const eq = /^--?([A-Za-z0-9_-]+)=(.+)$/.exec(arg)
    if (eq && isSensitiveName(eq[1]!)) out.add(i)
    const prev = args[i - 1]
    if (prev && /^--?[A-Za-z0-9_-]+$/.test(prev) && isSensitiveName(prev)) out.add(i)
  })
  return out
}

function argsOf(def: Record<string, unknown>): string[] {
  const args = def['args']
  return Array.isArray(args) ? args.filter((a): a is string => typeof a === 'string') : []
}

function keysOf(value: unknown): string[] {
  return isRecord(value)
    ? Object.keys(value)
        .filter((k) => k.length <= 64)
        .slice(0, 30)
    : []
}

/** Resumo sem segredos: comando (só o nome) + argumentos mascarados, ou o endereço sem query. */
export function summarize(def: Record<string, unknown>): string {
  const transport = transportOf(def)
  if (transport === 'stdio') {
    const command = typeof def['command'] === 'string' ? basename(def['command']) : '?'
    const args = argsOf(def)
    const masked = secretArgIndexes(args)
    return [command, ...args.map((a, i) => (masked.has(i) ? '•••' : a))].join(' ').slice(0, 200)
  }
  if (typeof def['url'] === 'string') {
    try {
      const url = new URL(def['url'])
      return `${url.origin}${url.pathname}`.slice(0, 200)
    } catch {
      return 'endereço inválido'
    }
  }
  return 'tipo desconhecido'
}

export function toClaudeEntry(raw: ClaudeMcpRaw, copied: boolean): ClaudeMcpEntry {
  return {
    ref: raw.ref,
    transport: transportOf(raw.def),
    summary: summarize(raw.def),
    envKeys: keysOf(raw.def['env']),
    headerKeys: keysOf(raw.def['headers']),
    where: raw.where,
    copied
  }
}

/** Nome do segredo para uma variável/cabeçalho (`Authorization` → `<SERVIDOR>_AUTHORIZATION`). */
function secretNameFor(serverId: string, key: string): string {
  const base = key
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  if (isSecretName(base) && !secretNameProblem(base) && base !== 'AUTHORIZATION') return base
  const prefixed = `${serverId.toUpperCase().replace(/-/g, '_')}_${base}`.slice(0, 48)
  return isSecretName(prefixed) && !secretNameProblem(prefixed) ? prefixed : 'MCP_SECRET'
}

/**
 * Valor de variável/cabeçalho copiado: texto comum só se o nome e o valor não forem sensíveis;
 * senão vira referência a um segredo (que você cria no Vault). `${VAR}` vira referência também.
 */
function bindingsOf(serverId: string, value: unknown, header: boolean): McpBinding[] {
  if (!isRecord(value)) return []
  const out: McpBinding[] = []
  for (const [name, v] of Object.entries(value).slice(0, MCP_LIMITS.bindings)) {
    const text = typeof v === 'string' ? v : ''
    const plain =
      !isSensitiveName(name) &&
      redactSecrets(`${name}=${text}`) === `${name}=${text}` &&
      redactSecrets(text) === text &&
      !/\$\{/.test(text) &&
      text.length <= MCP_LIMITS.text &&
      !/[\0\r\n]/.test(text)
    const prefix = header && /^Bearer\s/i.test(text) ? 'Bearer ' : ''
    out.push({
      name,
      value: plain
        ? { kind: 'text', text }
        : { kind: 'secret', secret: secretNameFor(serverId, name), prefix }
    })
  }
  return out
}

/** Servidor do Orkio copiado de um do Claude Code (desligado). Lança `Error` com texto pt-BR. */
export function copyClaudeServer(
  raw: ClaudeMcpRaw,
  takenIds: readonly string[],
  now: string
): McpServer {
  const transport = transportOf(raw.def)
  const id = freeMcpId(raw.ref.name, takenIds)
  const base = {
    id,
    name: raw.ref.name.slice(0, MCP_LIMITS.name),
    description: `Copiado do seu Claude Code (${raw.where}).`.slice(0, MCP_LIMITS.description),
    origin: { kind: 'claude' as const, name: raw.ref.name },
    enabled: false,
    agents: 'all' as const,
    createdAt: now
  }
  let candidate: unknown
  if (transport === 'stdio') {
    const command = raw.def['command']
    const args = argsOf(raw.def)
    if (!isMcpCommand(command)) throw new Error(CLAUDE_MCP_MESSAGES.unsupported)
    if (secretArgIndexes(args).size > 0) throw new Error(CLAUDE_MCP_MESSAGES.secretArg)
    candidate = {
      ...base,
      transport: 'stdio',
      command,
      args,
      url: null,
      env: bindingsOf(id, raw.def['env'], false),
      headers: []
    }
  } else if (transport === 'http') {
    const url = raw.def['url']
    if (typeof url !== 'string' || mcpUrlProblem(url))
      throw new Error(CLAUDE_MCP_MESSAGES.unsupported)
    candidate = {
      ...base,
      transport: 'http',
      command: null,
      args: [],
      url,
      env: [],
      headers: bindingsOf(id, raw.def['headers'], true)
    }
  } else {
    throw new Error(CLAUDE_MCP_MESSAGES.unsupported)
  }
  const server = parseMcpServer(candidate)
  if (!server) throw new Error(CLAUDE_MCP_MESSAGES.unsupported)
  return server
}
