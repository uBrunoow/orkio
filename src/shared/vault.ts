/**
 * Fase 4: Segredos (Vault). O valor de um segredo vive só no main, criptografado com `safeStorage`
 * (`SecureStore`, chave `vault-<nome>`); a config guarda só os metadados (nome, nota, datas e quem
 * pode usar). O renderer nunca recebe o valor de volta: depois de salvo, só dá para trocar ou
 * apagar. Na hora de rodar, o Orkio injeta como variável de ambiente só os segredos liberados para
 * aquele agente (processo do Claude Code) ou servidor MCP (processo do servidor). Puro: sem Node/DOM.
 */
import { isRecord } from './guards'

/** Nome = variável de ambiente (`GITHUB_TOKEN`): maiúsculas, dígitos e `_`, até 48. */
export const SECRET_NAME_PATTERN = /^[A-Z][A-Z0-9_]{1,47}$/
export const SECRET_VALUE_MAX = 16_384
export const SECRET_NOTE_MAX = 140
/** Segredos guardados no Vault (o `SecureStore` também guarda as conexões; o limite é só daqui). */
export const VAULT_MAX = 100
/** Quem usa um segredo: até este número de agentes/servidores. */
export const SECRET_USES_MAX = 50

/**
 * Nomes que mudariam o comportamento do processo (carregar código, trocar o login do Claude, o
 * PATH...) e por isso nunca viram segredo injetado. `sanitizeEnv` (main) tira alguns deles do
 * ambiente: um segredo com o mesmo nome furaria o filtro.
 */
const RESERVED_NAMES = new Set([
  'PATH',
  'HOME',
  'USER',
  'USERNAME',
  'LOGNAME',
  'SHELL',
  'PWD',
  'TMPDIR',
  'TEMP',
  'TMP',
  'TERM',
  'LANG',
  'NODE_OPTIONS',
  'NODE_PATH',
  'NODE_EXTRA_CA_CERTS',
  'PYTHONPATH',
  'PYTHONSTARTUP',
  'RUBYOPT',
  'PERL5OPT',
  'BASH_ENV',
  'ENV',
  'ZDOTDIR',
  'SSH_AUTH_SOCK',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_RUNTIME_DIR',
  'DISPLAY',
  'COMSPEC',
  'SYSTEMROOT'
])
const RESERVED_PREFIXES = [
  'ANTHROPIC_',
  'CLAUDE_',
  'ELECTRON_',
  'ORKIO_',
  'MAIN_VITE_',
  'LD_',
  'DYLD_',
  'GIT_',
  'NPM_CONFIG_',
  'npm_'
]

export function isSecretName(value: unknown): value is string {
  return typeof value === 'string' && SECRET_NAME_PATTERN.test(value)
}

/** Por que o nome não serve (pt-BR) ou `null`. Mesma regra na tela e no main. */
export function secretNameProblem(name: string): string | null {
  if (!SECRET_NAME_PATTERN.test(name)) {
    return 'Use letras maiúsculas, números e _ (ex.: GITHUB_TOKEN), começando por letra, até 48.'
  }
  if (RESERVED_NAMES.has(name) || RESERVED_PREFIXES.some((p) => name.startsWith(p))) {
    return 'Esse nome é do sistema ou do próprio Claude Code. Escolha outro.'
  }
  return null
}

/** Valor aceito: texto não vazio, sem NUL, até `SECRET_VALUE_MAX`. */
export function secretValueProblem(value: string): string | null {
  if (!value.trim()) return 'Cole o valor do segredo.'
  if (value.length > SECRET_VALUE_MAX) return 'Valor grande demais (até 16 mil caracteres).'
  if (value.includes('\0')) return 'O valor tem um caractere inválido.'
  return null
}

/** Chave no `SecureStore` (só `[a-z0-9-]`): `GITHUB_TOKEN` → `vault-github-token`. */
export function vaultStoreKey(name: string): string {
  return `vault-${name.toLowerCase().replace(/_/g, '-')}`
}

/** Quem pode receber o segredo na hora de rodar. */
export type SecretUse = { kind: 'agent'; key: string } | { kind: 'mcp'; id: string }

export function sameUse(a: SecretUse, b: SecretUse): boolean {
  return (
    a.kind === b.kind &&
    (a.kind === 'agent' ? a.key === (b as typeof a).key : a.id === (b as typeof a).id)
  )
}

/** Metadados guardados na config (nunca o valor). */
export interface SecretMeta {
  name: string
  note: string
  createdAt: string
  updatedAt: string
  uses: SecretUse[]
}

/** O que a tela vê de um segredo: nunca o valor. */
export type SecretView = SecretMeta

export interface VaultView {
  /** Criptografia do sistema disponível (sem ela, nada é salvo). */
  available: boolean
  secrets: SecretView[]
}

/** Salvar: `value` é obrigatório no segredo novo e opcional (trocar) no existente. */
export interface SecretSaveInput {
  name: string
  note: string
  value?: string
}

const AGENT_KEY = /^(repo|local|builtin):[a-z0-9][a-z0-9-]{0,39}$/
const MCP_ID = /^[a-z][a-z0-9-]{1,39}$/

export function parseSecretUse(value: unknown): SecretUse | null {
  if (!isRecord(value)) return null
  if (
    value['kind'] === 'agent' &&
    typeof value['key'] === 'string' &&
    AGENT_KEY.test(value['key'])
  ) {
    return { kind: 'agent', key: value['key'] }
  }
  if (value['kind'] === 'mcp' && typeof value['id'] === 'string' && MCP_ID.test(value['id'])) {
    return { kind: 'mcp', id: value['id'] }
  }
  return null
}

/** Lista de usos sem repetidos; `null` se algo não tiver a forma certa ou passar do limite. */
export function parseSecretUses(value: unknown): SecretUse[] | null {
  if (!Array.isArray(value) || value.length > SECRET_USES_MAX) return null
  const out: SecretUse[] = []
  for (const raw of value) {
    const use = parseSecretUse(raw)
    if (!use) return null
    if (!out.some((u) => sameUse(u, use))) out.push(use)
  }
  return out
}

/** Metadados lidos da config: entrada inválida some (nunca derruba a config). */
export function parseVault(value: unknown): SecretMeta[] {
  if (!Array.isArray(value)) return []
  const out: SecretMeta[] = []
  for (const raw of value.slice(0, VAULT_MAX)) {
    if (!isRecord(raw)) continue
    const { name, note, createdAt, updatedAt } = raw
    if (!isSecretName(name) || out.some((s) => s.name === name)) continue
    if (typeof createdAt !== 'string' || typeof updatedAt !== 'string') continue
    const uses = parseSecretUses(raw['uses']) ?? []
    out.push({
      name,
      note: typeof note === 'string' ? note.slice(0, SECRET_NOTE_MAX) : '',
      createdAt,
      updatedAt,
      uses
    })
  }
  return out
}

/** O segredo pode ir para este uso? */
export function secretAllows(meta: SecretMeta, use: SecretUse): boolean {
  return meta.uses.some((u) => sameUse(u, use))
}
