/**
 * Regras puras da tela Servidores MCP: rascunho do formulário (Avançado) ↔ servidor, com a mesma
 * validação do main (`parseMcpServer`) e mensagens pt-BR por campo. Sem DOM.
 */
import {
  MCP_LIMITS,
  catalogEntry,
  isMcpCommand,
  isSensitiveName,
  mcpUrlProblem,
  parseMcpServer,
  type McpBinding,
  type McpOrigin,
  type McpServer,
  type McpTransport
} from '../../../../shared/mcp'
import { isSecretName } from '../../../../shared/vault'

export interface BindingDraft {
  name: string
  kind: 'text' | 'secret'
  text: string
  secret: string
  prefix: string
}

export interface ServerDraft {
  name: string
  description: string
  transport: McpTransport
  command: string
  /** Um argumento por linha. */
  argsText: string
  url: string
  env: BindingDraft[]
  headers: BindingDraft[]
}

export function emptyBinding(): BindingDraft {
  return { name: '', kind: 'text', text: '', secret: '', prefix: '' }
}

export function emptyDraft(): ServerDraft {
  return {
    name: '',
    description: '',
    transport: 'stdio',
    command: '',
    argsText: '',
    url: '',
    env: [],
    headers: []
  }
}

function bindingDraft(b: McpBinding): BindingDraft {
  return b.value.kind === 'text'
    ? { name: b.name, kind: 'text', text: b.value.text, secret: '', prefix: '' }
    : { name: b.name, kind: 'secret', text: '', secret: b.value.secret, prefix: b.value.prefix }
}

export function draftFromServer(s: McpServer): ServerDraft {
  return {
    name: s.name,
    description: s.description,
    transport: s.transport,
    command: s.command ?? '',
    argsText: s.args.join('\n'),
    url: s.url ?? '',
    env: s.env.map(bindingDraft),
    headers: s.headers.map(bindingDraft)
  }
}

/** Linhas → argumentos (linhas vazias saem; espaços no meio ficam). */
export function argsFromText(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '')
}

function bindingFromDraft(b: BindingDraft): McpBinding {
  const name = b.name.trim()
  return b.kind === 'secret'
    ? { name, value: { kind: 'secret', secret: b.secret, prefix: b.prefix } }
    : { name, value: { kind: 'text', text: b.text } }
}

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/
const HEADER_NAME = /^[A-Za-z0-9-]{1,64}$/
const PREFIX = /^[A-Za-z]{0,16} ?$/

/** Problema de uma variável/cabeçalho (pt-BR) ou `null`. */
export function bindingProblem(b: BindingDraft, target: 'env' | 'header'): string | null {
  const name = b.name.trim()
  if (!name) return 'Dê um nome.'
  if (!(target === 'env' ? ENV_NAME : HEADER_NAME).test(name)) {
    return target === 'env'
      ? 'Nome de variável: letras, números e _, começando por letra.'
      : 'Nome de cabeçalho: letras, números e -.'
  }
  if (b.kind === 'text') {
    if (isSensitiveName(name) && b.text !== '') {
      return 'Esse nome guarda algo sensível: use um segredo.'
    }
    if (b.text.length > MCP_LIMITS.text || /[\0\r\n]/.test(b.text)) return 'Valor inválido.'
    return null
  }
  if (!isSecretName(b.secret)) return 'Escolha um segredo.'
  if (!PREFIX.test(b.prefix)) return 'Prefixo: só letras e um espaço no fim (ex.: Bearer ).'
  return null
}

export interface DraftCheck {
  /** Problema por campo (para mostrar ao lado). */
  name: string | null
  command: string | null
  args: string | null
  url: string | null
  env: (string | null)[]
  headers: (string | null)[]
  /** Duplicados e o resto (mensagem geral). */
  general: string | null
}

export function checkDraft(d: ServerDraft): DraftCheck {
  const stdio = d.transport === 'stdio'
  const args = argsFromText(d.argsText)
  const dup = (list: BindingDraft[]): boolean => {
    const names = list.map((b) => b.name.trim().toLowerCase()).filter(Boolean)
    return new Set(names).size !== names.length
  }
  const env = stdio ? d.env.map((b) => bindingProblem(b, 'env')) : []
  const headers = d.headers.map((b) => bindingProblem(b, 'header'))
  return {
    name: !d.name.trim()
      ? 'Dê um nome.'
      : d.name.length > MCP_LIMITS.name
        ? 'Nome longo demais.'
        : null,
    command: !stdio
      ? null
      : !d.command.trim()
        ? 'Diga o comando (ex.: npx).'
        : isMcpCommand(d.command.trim())
          ? null
          : 'Só o nome do programa (ex.: npx) ou um caminho absoluto; os argumentos vão abaixo.',
    args: !stdio
      ? null
      : args.length > MCP_LIMITS.args
        ? `Até ${MCP_LIMITS.args} argumentos.`
        : args.some((a) => a.length > MCP_LIMITS.arg)
          ? 'Algum argumento está longo demais.'
          : null,
    url: stdio ? null : !d.url.trim() ? 'Diga o endereço.' : mcpUrlProblem(d.url.trim()),
    env,
    headers,
    general:
      (stdio && dup(d.env)) || dup(d.headers)
        ? 'Há nomes repetidos.'
        : stdio && d.headers.length > 0
          ? 'Servidor por comando não usa cabeçalhos.'
          : d.description.length > MCP_LIMITS.description
            ? 'Descrição longa demais.'
            : null
  }
}

export function draftHasProblems(c: DraftCheck): boolean {
  return (
    [c.name, c.command, c.args, c.url, c.general].some(Boolean) ||
    c.env.some(Boolean) ||
    c.headers.some(Boolean)
  )
}

/** Servidor a salvar (validado com a regra do main) ou `null`. */
export function serverFromDraft(
  d: ServerDraft,
  base: {
    id: string
    origin: McpOrigin
    enabled: boolean
    agents: McpServer['agents']
    createdAt: string
  }
): McpServer | null {
  const stdio = d.transport === 'stdio'
  return parseMcpServer({
    ...base,
    name: d.name.trim(),
    description: d.description.trim(),
    transport: d.transport,
    command: stdio ? d.command.trim() : null,
    args: stdio ? argsFromText(d.argsText) : [],
    url: stdio ? null : d.url.trim(),
    env: stdio ? d.env.map(bindingFromDraft) : [],
    headers: stdio ? [] : d.headers.map(bindingFromDraft)
  })
}

/** De onde veio, em pt-BR. */
export function originLabel(origin: McpOrigin): string {
  if (origin.kind === 'catalog')
    return `Do catálogo (${catalogEntry(origin.id)?.name ?? origin.id})`
  if (origin.kind === 'claude') return `Copiado do seu Claude Code (${origin.name})`
  return 'Adicionado à mão'
}

/** Liga/desliga um agente em "Só estes agentes". */
export function toggleAgent(list: readonly string[], key: string, on: boolean): string[] {
  const without = list.filter((k) => k !== key)
  return on ? [...without, key] : without
}

/** Marca de um servidor MCP (para o logo), pelo nome, endereço ou comando. `null` = genérico. */
export type McpBrand =
  | 'github'
  | 'notion'
  | 'linear'
  | 'aws'
  | 'vercel'
  | 'figma'
  | 'slack'
  | 'docker'
  | 'browser'
  | 'stripe'
  | 'sentry'
  | 'supabase'
  | 'gitlab'
  | 'jira'
  | 'mongodb'
  | 'firebase'
  | 'drive'
  | 'shop'
  | 'docs'
  | 'database'

const BRAND_RULES: readonly (readonly [McpBrand, RegExp])[] = [
  ['github', /github|octocode/],
  ['notion', /notion/],
  ['linear', /linear/],
  ['aws', /\baws\b|amazonaws/],
  ['vercel', /vercel/],
  ['figma', /figma/],
  ['slack', /slack/],
  ['docker', /docker/],
  ['browser', /chrome|playwright|puppeteer|browser/],
  ['stripe', /stripe/],
  ['sentry', /sentry/],
  ['supabase', /supabase/],
  ['gitlab', /gitlab/],
  ['jira', /jira|atlassian|confluence/],
  ['mongodb', /mongo/],
  ['firebase', /firebase/],
  ['drive', /google.?drive|gdrive/],
  ['shop', /shopify|asaas|omie/],
  ['database', /postgres|mysql|sqlite|database|\bdb\b/],
  ['docs', /context7|docs|knowledge|backlog/]
]

export function mcpBrand(...texts: readonly (string | null | undefined)[]): McpBrand | null {
  const t = texts.filter(Boolean).join(' ').toLowerCase()
  return BRAND_RULES.find(([, re]) => re.test(t))?.[0] ?? null
}
