/**
 * Entrega (Etapa 5C): regras puras de push e do "modo entrega", usadas pela ação de push do
 * Orkio, pela política de permissões do Claude Code e pela tela.
 *
 * Regra de ouro: só a branch da tarefa (a do worktree, com o ID) vai para o GitHub. Branch
 * padrão, main/master/develop/production/release*, força e remoção nunca.
 */

/** Destino de uma entrega: o repositório do projeto e a branch da tarefa. */
export interface DeliveryTarget {
  owner: string
  repo: string
  /** Nome do remote no git (ex.: `origin`). */
  remote: string
  /** Branch da tarefa (a do worktree). */
  branch: string
  /** Branch padrão do repositório (GitHub/remote), se conhecida. */
  defaultBranch: string | null
  /** ID da tarefa (ex.: ORK-142). */
  displayId: string | null
}

/** Ajustes de entrega por projeto (`orkio-config` v8 → `delivery[projectId]`). */
export interface DeliverySettings {
  /** Pedir aprovação antes de CADA push (Orkio e Claude Code). Padrão: sim. */
  requirePushApproval: boolean
}

export const DEFAULT_DELIVERY_SETTINGS: DeliverySettings = { requirePushApproval: true }

/** Nomes sempre protegidos, além da branch padrão do repositório. */
export const PROTECTED_BRANCH_NAMES = [
  'main',
  'master',
  'develop',
  'development',
  'dev',
  'production',
  'prod',
  'staging',
  'trunk',
  'gh-pages'
] as const

export function isProtectedBranch(name: string, defaultBranch: string | null): boolean {
  const n = name
    .trim()
    .replace(/^refs\/heads\//, '')
    .toLowerCase()
  if (!n) return true
  if (defaultBranch && n === defaultBranch.toLowerCase()) return true
  if ((PROTECTED_BRANCH_NAMES as readonly string[]).includes(n)) return true
  // release* sempre; hotfix sozinho, hotfix-x e hotfix_x também. `hotfix/<nome>` é a branch de uma
  // tarefa (tipo escolhido no formulário) e pode ir, como feat/ e fix/.
  return /^(release|releases)([/_-]|$)/.test(n) || /^hotfix([_-]|$)/.test(n)
}

export const DELIVERY_MESSAGES = {
  protected: (b: string) =>
    `A branch “${b}” é protegida pelo Orkio (padrão/main/develop/production/release): push nunca é permitido.`,
  notTaskBranch: (b: string, task: string) =>
    `Só a branch da tarefa (“${task}”) pode ir para o GitHub; “${b}” não é ela.`,
  invalid: 'Nome de branch inválido para o push.',
  dirty:
    'Há mudanças não commitadas no ambiente da tarefa. Faça o commit (ou descarte) antes do push.',
  nothing: 'Não há commits novos para enviar: a branch remota já está igual.',
  noRepo:
    'O projeto não tem um repositório do GitHub verificado. Confira a tela Projetos antes da entrega.'
} as const

/** Pode fazer push desta branch para este destino? `null` = sim; senão, o motivo (pt-BR). */
export function checkPushBranch(branch: string, target: DeliveryTarget): string | null {
  const b = branch.replace(/^refs\/heads\//, '')
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(b) || b.includes('..')) return DELIVERY_MESSAGES.invalid
  if (isProtectedBranch(b, target.defaultBranch)) return DELIVERY_MESSAGES.protected(b)
  // Só a branch da pasta de trabalho da tarefa. O nome não precisa ter o ID do Notion: a branch
  // pode ter sido vinculada à mão (`feat/listar-pedidos`) ou o banco pode não ter ID.
  if (b !== target.branch) return DELIVERY_MESSAGES.notTaskBranch(b, target.branch)
  return null
}

/** Repositório `owner/repo` igual ao do projeto (GitHub ignora maiúsculas). */
export function sameRepo(owner: string, repo: string, target: DeliveryTarget): boolean {
  return (
    owner.toLowerCase() === target.owner.toLowerCase() &&
    repo.replace(/\.git$/i, '').toLowerCase() === target.repo.toLowerCase()
  )
}
