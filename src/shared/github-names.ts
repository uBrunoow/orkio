/**
 * Nomes do GitHub (owner, repositório, login, revisor, branch, link de instalação do App) e a
 * versão da API: uma regra só, usada pelo main (conectores, IPC, allowlist de links, git) e pelo
 * renderer. As checagens repetidas em cada camada (defesa em profundidade) chamam estas funções.
 * O site (`site/lib/contract.ts`) tem package próprio e mantém as mesmas regras;
 * `test/site-contract.test.ts` exige que os dois lados batam.
 */

/** Versão da API REST do GitHub (header `X-GitHub-Api-Version`), igual à do site. */
export const GITHUB_API_VERSION = '2026-03-10'

/**
 * Trechos das regras (sem âncoras), para montar padrões de URL (allowlist de links).
 * Owner: letras, dígitos, `-` e `_` (o `_` só existe em contas gerenciadas, EMU), até 100.
 * Repositório: letras, dígitos, `.`, `_`, `-`, até 100 (nunca `.`/`..`, ver `isRepo`).
 * Slug do App: minúsculas, dígitos e `-`.
 */
export const GITHUB_NAME_SOURCES = {
  owner: '[A-Za-z0-9_][A-Za-z0-9_-]{0,99}',
  repo: '[A-Za-z0-9._-]{1,100}',
  appSlug: '[a-z0-9][a-z0-9-]{0,99}'
} as const

const OWNER = new RegExp(`^${GITHUB_NAME_SOURCES.owner}$`)
const REPO = new RegExp(`^${GITHUB_NAME_SOURCES.repo}$`)
/** Login de usuário: começa com letra/dígito; depois letras, dígitos, `-` e `_` (EMU), até 39. */
const LOGIN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,38}$/
/** Autor (PR, comentário): login de usuário ou de app (`dependabot[bot]`). */
const AUTHOR = /^[A-Za-z0-9][A-Za-z0-9_-]{0,38}(\[bot\])?$/
/** Slug de time (revisor `team:<slug>`). */
const TEAM = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/
const INSTALL_URL = new RegExp(
  `^https://github\\.com/apps/${GITHUB_NAME_SOURCES.appSlug}/installations/new$`
)
/** Nome de branch não pode ser maior que isso (o git aceita mais, mas não há motivo). */
const BRANCH_MAX = 250

export function isOwner(value: unknown): value is string {
  return typeof value === 'string' && OWNER.test(value)
}

export function isRepo(value: unknown): value is string {
  return typeof value === 'string' && REPO.test(value) && value !== '.' && value !== '..'
}

export function isLogin(value: unknown): value is string {
  return typeof value === 'string' && LOGIN.test(value)
}

export function isAuthorLogin(value: unknown): value is string {
  return typeof value === 'string' && AUTHOR.test(value)
}

export function isTeamSlug(value: unknown): value is string {
  return typeof value === 'string' && TEAM.test(value)
}

/** Revisor de PR: login de usuário ou `team:<slug>`. */
export function isReviewer(value: unknown): value is string {
  if (typeof value !== 'string') return false
  return value.startsWith('team:') ? isTeamSlug(value.slice(5)) : isLogin(value)
}

/**
 * Nome de branch seguro para usar como argumento do git e para vincular a uma tarefa: sem opção
 * (`-x`), refspec, espaço, `..`, `//`, `/` no fim nem `.lock`.
 */
export function isBranchName(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= BRANCH_MAX &&
    /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value) &&
    !value.includes('..') &&
    !value.includes('//') &&
    !value.endsWith('/') &&
    !value.endsWith('.lock')
  )
}

/** Página de instalação do GitHub App (formato que o site devolve). */
export function isInstallUrl(value: unknown): value is string {
  return typeof value === 'string' && INSTALL_URL.test(value)
}
