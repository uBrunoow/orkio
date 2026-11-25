/**
 * Fase 4: servidores MCP do Orkio. Ficam na config (sem segredo: valores sensíveis são referências
 * ao Vault, `shared/vault.ts`), nascem desligados e só entram no `--mcp-config` das execuções
 * depois que você liga, e só para os agentes escolhidos. O catálogo é curado e estático
 * (`MCP_CATALOG`); os servidores que o seu Claude Code já carrega (`~/.claude.json`, `.mcp.json`)
 * aparecem só para leitura, com "Copiar para o Orkio". Puro: sem Node/DOM.
 */
import { isRecord } from './guards'
import { isSecretName } from './vault'

export const MCP_ID_PATTERN = /^[a-z][a-z0-9-]{1,39}$/
/** Nome reservado: o servidor de permissões/memória do próprio Orkio (ponte). */
export const MCP_RESERVED_IDS = new Set(['orkio'])
export const MCP_LIMITS = {
  servers: 30,
  name: 60,
  description: 200,
  command: 400,
  args: 32,
  arg: 512,
  url: 500,
  bindings: 20,
  text: 500,
  prefix: 20,
  agents: 50
} as const

export type McpTransport = 'stdio' | 'http'

/** Valor de uma variável/cabeçalho: texto comum ou referência a um segredo do Vault. */
export type McpValue =
  | { kind: 'text'; text: string }
  /** `prefix` vai antes do valor (ex.: `Bearer `). */
  | { kind: 'secret'; secret: string; prefix: string }

export interface McpBinding {
  name: string
  value: McpValue
}

export type McpOrigin =
  { kind: 'catalog'; id: string } | { kind: 'claude'; name: string } | { kind: 'manual' }

/** Quem recebe o servidor: todas as execuções (com ou sem agente) ou só estes agentes. */
export type McpAgents = 'all' | string[]

export interface McpServer {
  id: string
  name: string
  description: string
  transport: McpTransport
  /** stdio: executável (nome no PATH ou caminho absoluto) e argumentos. */
  command: string | null
  args: string[]
  /** http: endereço do servidor. */
  url: string | null
  env: McpBinding[]
  headers: McpBinding[]
  origin: McpOrigin
  /** Desligado = nunca roda (o comando de um servidor só roda depois que você liga). */
  enabled: boolean
  agents: McpAgents
  createdAt: string
}

export interface McpServerView extends McpServer {
  /** O que impede de carregar agora (segredo que falta, segredo não liberado...). */
  problems: string[]
}

/** Servidor que o Claude Code do usuário já carrega: só nome, tipo e um resumo sem segredos. */
export interface ClaudeMcpEntry {
  ref: ClaudeMcpRef
  transport: 'stdio' | 'http' | 'sse' | 'unknown'
  /** `npx -y pacote` (argumentos com cara de segredo viram `•••`) ou o endereço sem a query. */
  summary: string
  /** Só os nomes das variáveis e cabeçalhos (nunca os valores). */
  envKeys: string[]
  headerKeys: string[]
  /** Onde aparece: "Seu usuário" ou o nome do projeto do Orkio. */
  where: string
  /** Já existe um servidor do Orkio copiado dele. */
  copied: boolean
}

/** Qual servidor do Claude copiar (o main relê o arquivo; nada da definição vem do renderer). */
export interface ClaudeMcpRef {
  scope: 'user' | 'local' | 'project'
  name: string
  /** Projeto do Orkio (escopos `local` e `project`). */
  projectId: string | null
}

export interface McpView {
  servers: McpServerView[]
  claude: ClaudeMcpEntry[]
  /** Falha ao ler as configurações do Claude (pt-BR) ou `null`. */
  claudeError: string | null
}

/** Item do catálogo curado. */
export interface McpCatalogEntry {
  id: string
  name: string
  /** Uma frase comum: o que ele deixa o agente fazer. */
  description: string
  category: 'Código' | 'Tarefas' | 'Erros' | 'Documentação' | 'Navegador'
  transport: McpTransport
  command: string | null
  args: string[]
  url: string | null
  /** Segredos que ele usa (variável ou cabeçalho). */
  secrets: McpCatalogSecret[]
  /** Entra pelo próprio servidor (OAuth): o login acontece no Claude Code (`/mcp`). */
  oauth: boolean
  docsUrl: string
}

export interface McpCatalogSecret {
  label: string
  target: 'env' | 'header'
  /** Nome da variável ou do cabeçalho. */
  name: string
  prefix: string
  /** Nome sugerido no Vault. */
  suggested: string
  required: boolean
  help: string
}

/** Catálogo curado (estático): comece pequeno. */
export const MCP_CATALOG: readonly McpCatalogEntry[] = [
  {
    id: 'github',
    name: 'GitHub',
    description: 'Ler issues, PRs, código e Actions do GitHub com o seu token.',
    category: 'Código',
    transport: 'http',
    command: null,
    args: [],
    url: 'https://api.githubcopilot.com/mcp/',
    secrets: [
      {
        label: 'Token do GitHub',
        target: 'header',
        name: 'Authorization',
        prefix: 'Bearer ',
        suggested: 'GITHUB_MCP_TOKEN',
        required: true,
        help: 'Um fine-grained token só com o que o agente precisa ler.'
      }
    ],
    oauth: false,
    docsUrl: 'https://github.com/github/github-mcp-server'
  },
  {
    id: 'notion',
    name: 'Notion',
    description: 'Buscar e ler páginas e bancos do Notion além da tarefa.',
    category: 'Tarefas',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@notionhq/notion-mcp-server'],
    url: null,
    secrets: [
      {
        label: 'Token da integração do Notion',
        target: 'env',
        name: 'NOTION_TOKEN',
        prefix: '',
        suggested: 'NOTION_MCP_TOKEN',
        required: true,
        help: 'Token de uma integração interna, compartilhada só com as páginas necessárias.'
      }
    ],
    oauth: false,
    docsUrl: 'https://github.com/makenotion/notion-mcp-server'
  },
  {
    id: 'linear',
    name: 'Linear',
    description: 'Ler e comentar issues do Linear.',
    category: 'Tarefas',
    transport: 'http',
    command: null,
    args: [],
    url: 'https://mcp.linear.app/mcp',
    secrets: [],
    oauth: true,
    docsUrl: 'https://linear.app/docs/mcp'
  },
  {
    id: 'sentry',
    name: 'Sentry',
    description: 'Ver erros e eventos do Sentry para investigar falhas.',
    category: 'Erros',
    transport: 'http',
    command: null,
    args: [],
    url: 'https://mcp.sentry.dev/mcp',
    secrets: [],
    oauth: true,
    docsUrl: 'https://docs.sentry.io/product/sentry-mcp/'
  },
  {
    id: 'context7',
    name: 'Context7',
    description: 'Documentação atual de bibliotecas e frameworks.',
    category: 'Documentação',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@upstash/context7-mcp'],
    url: null,
    secrets: [
      {
        label: 'Chave da API do Context7 (opcional)',
        target: 'env',
        name: 'CONTEXT7_API_KEY',
        prefix: '',
        suggested: 'CONTEXT7_API_KEY',
        required: false,
        help: 'Sem chave funciona com limite menor.'
      }
    ],
    oauth: false,
    docsUrl: 'https://github.com/upstash/context7'
  },
  {
    id: 'playwright',
    name: 'Playwright',
    description: 'Abrir um navegador, clicar e ver páginas para testar a interface.',
    category: 'Navegador',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@playwright/mcp@latest'],
    url: null,
    secrets: [],
    oauth: false,
    docsUrl: 'https://github.com/microsoft/playwright-mcp'
  }
]

export function catalogEntry(id: string): McpCatalogEntry | undefined {
  return MCP_CATALOG.find((e) => e.id === id)
}

export function isMcpId(value: unknown): value is string {
  return typeof value === 'string' && MCP_ID_PATTERN.test(value) && !MCP_RESERVED_IDS.has(value)
}

/** Nome que pede segredo: o valor não pode ir como texto comum. */
export function isSensitiveName(name: string): boolean {
  return /(KEY|TOKEN|SECRET|PASS|PWD|AUTH|COOKIE|CREDENTIAL|SENHA|SESSION|PRIVATE)/i.test(name)
}

const PATH_COMMAND = /^[A-Za-z0-9._+-]{1,64}$/
const ABSOLUTE_COMMAND = /^(\/|[A-Za-z]:[\\/])[^\0\r\n]{1,398}$/
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/
const HEADER_NAME = /^[A-Za-z0-9-]{1,64}$/
const PREFIX = /^[A-Za-z]{0,16} ?$/
const AGENT_KEY = /^(repo|local|builtin):[a-z0-9][a-z0-9-]{0,39}$/

/** Comando do servidor stdio: nome simples no PATH ou caminho absoluto (nunca uma linha de shell). */
export function isMcpCommand(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    !value.startsWith('-') &&
    (PATH_COMMAND.test(value) || ABSOLUTE_COMMAND.test(value))
  )
}

function isArg(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MCP_LIMITS.arg && !/[\0\r\n]/.test(value)
}

/** Endereço do servidor http: https (ou http só em localhost), sem usuário/senha na URL. */
export function mcpUrlProblem(value: string): string | null {
  if (value.length > MCP_LIMITS.url) return 'Endereço longo demais.'
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return 'Endereço inválido.'
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    return 'Use https:// (http só em localhost).'
  }
  if (url.username || url.password) return 'Não ponha usuário ou senha no endereço: use um segredo.'
  for (const key of url.searchParams.keys()) {
    if (isSensitiveName(key)) return 'Não ponha chaves no endereço: use um cabeçalho com segredo.'
  }
  return null
}

function parseValue(value: unknown, name: string): McpValue | null {
  if (!isRecord(value)) return null
  if (value['kind'] === 'text') {
    const text = value['text']
    if (typeof text !== 'string' || text.length > MCP_LIMITS.text || /[\0\r\n]/.test(text)) {
      return null
    }
    // Nome sensível nunca leva texto comum: o valor iria em claro para a config.
    if (isSensitiveName(name) && text !== '') return null
    return { kind: 'text', text }
  }
  if (value['kind'] === 'secret') {
    const { secret, prefix } = value
    if (!isSecretName(secret)) return null
    const p = typeof prefix === 'string' ? prefix : ''
    if (!PREFIX.test(p)) return null
    return { kind: 'secret', secret, prefix: p }
  }
  return null
}

function parseBindings(value: unknown, kind: 'env' | 'header'): McpBinding[] | null {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > MCP_LIMITS.bindings) return null
  const out: McpBinding[] = []
  for (const raw of value) {
    if (!isRecord(raw)) return null
    const name = raw['name']
    if (typeof name !== 'string' || !(kind === 'env' ? ENV_NAME : HEADER_NAME).test(name)) {
      return null
    }
    if (out.some((b) => b.name.toLowerCase() === name.toLowerCase())) return null
    const v = parseValue(raw['value'], name)
    if (!v) return null
    out.push({ name, value: v })
  }
  return out
}

function parseOrigin(value: unknown): McpOrigin | null {
  if (!isRecord(value)) return null
  if (value['kind'] === 'manual') return { kind: 'manual' }
  if (value['kind'] === 'catalog' && typeof value['id'] === 'string' && catalogEntry(value['id'])) {
    return { kind: 'catalog', id: value['id'] }
  }
  if (
    value['kind'] === 'claude' &&
    typeof value['name'] === 'string' &&
    value['name'].length > 0 &&
    value['name'].length <= 100
  ) {
    return { kind: 'claude', name: value['name'] }
  }
  return null
}

export function parseMcpAgents(value: unknown): McpAgents | null {
  if (value === 'all') return 'all'
  if (!Array.isArray(value) || value.length > MCP_LIMITS.agents) return null
  const out: string[] = []
  for (const k of value) {
    if (typeof k !== 'string' || !AGENT_KEY.test(k)) return null
    if (!out.includes(k)) out.push(k)
  }
  return out
}

/**
 * Servidor com a forma e as regras certas (a mesma regra na tela, no IPC e no main); `null` se
 * não. Campo estranho não passa.
 */
export function parseMcpServer(value: unknown): McpServer | null {
  if (!isRecord(value)) return null
  const { id, name, description, transport, command, url, enabled, createdAt } = value
  if (!isMcpId(id)) return null
  if (typeof name !== 'string' || !name.trim() || name.length > MCP_LIMITS.name) return null
  const desc = typeof description === 'string' ? description : ''
  if (desc.length > MCP_LIMITS.description) return null
  if (transport !== 'stdio' && transport !== 'http') return null
  if (typeof enabled !== 'boolean' || typeof createdAt !== 'string' || createdAt.length > 40) {
    return null
  }
  const origin = parseOrigin(value['origin'])
  const agents = parseMcpAgents(value['agents'])
  const env = parseBindings(value['env'], 'env')
  const headers = parseBindings(value['headers'], 'header')
  if (!origin || !agents || !env || !headers) return null
  let args: string[] = []
  if (transport === 'stdio') {
    if (!isMcpCommand(command)) return null
    const rawArgs = value['args'] ?? []
    if (!Array.isArray(rawArgs) || rawArgs.length > MCP_LIMITS.args || !rawArgs.every(isArg)) {
      return null
    }
    args = [...rawArgs]
    if (headers.length > 0) return null
  } else {
    if (typeof url !== 'string' || mcpUrlProblem(url)) return null
  }
  return {
    id,
    name: name.trim(),
    description: desc,
    transport,
    command: transport === 'stdio' ? (command as string) : null,
    args,
    url: transport === 'http' ? (url as string) : null,
    env: transport === 'stdio' ? env : [],
    headers,
    origin,
    enabled,
    agents,
    createdAt
  }
}

/** Servidores lidos da config: inválido some (nunca derruba a config). */
export function parseMcpServers(value: unknown): McpServer[] {
  if (!Array.isArray(value)) return []
  const out: McpServer[] = []
  for (const raw of value.slice(0, MCP_LIMITS.servers)) {
    const s = parseMcpServer(raw)
    if (s && !out.some((o) => o.id === s.id)) out.push(s)
  }
  return out
}

/** Segredos que o servidor referencia. */
export function mcpSecretNames(server: McpServer): string[] {
  const names = new Set<string>()
  for (const b of [...server.env, ...server.headers]) {
    if (b.value.kind === 'secret') names.add(b.value.secret)
  }
  return [...names]
}

/** O servidor vale para esta execução (agente ou nenhum)? */
export function mcpAppliesTo(server: McpServer, agentKey: string | null): boolean {
  if (!server.enabled) return false
  if (server.agents === 'all') return true
  return agentKey !== null && server.agents.includes(agentKey)
}

/** "Vai rodar: npx -y pacote" / "Conecta em https://…" (o que a tela mostra antes de ligar). */
export function mcpLaunchText(
  server: Pick<McpServer, 'transport' | 'command' | 'args' | 'url'>
): string {
  if (server.transport === 'http') return `Conecta em ${server.url ?? ''}`
  return `Vai rodar: ${[server.command ?? '', ...server.args].join(' ')}`
}

/** Id livre a partir de um nome (`GitHub` → `github`, `github-2` se já existir). */
export function freeMcpId(base: string, taken: readonly string[]): string {
  let slug = base
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
  if (!/^[a-z]/.test(slug)) slug = `mcp-${slug}`.replace(/-+$/, '')
  if (slug.length < 2 || MCP_RESERVED_IDS.has(slug)) slug = `mcp-${slug || 'servidor'}`
  let id = slug
  for (let n = 2; taken.includes(id); n += 1) id = `${slug}-${n}`
  return id
}
