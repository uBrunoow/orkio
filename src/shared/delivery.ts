/**
 * Entrega (Etapa 5C): regras puras de push e do "modo entrega", usadas pela ação de push do
 * Orkio, pela política de permissões do Claude Code e pela tela.
 *
 * Regra de ouro: só a branch da tarefa (a do worktree) vai para o GitHub. Branch
 * padrão, main/master/develop/production/release*, força e remoção nunca.
 */
import { isBranchName } from './github-names'

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
  /**
   * Para onde as PRs podem ir (`--base`), quando o projeto deixa os agentes entregarem sozinhos.
   * Ausente = sem restrição de destino (o passo de entrega escolhe, como antes).
   */
  prBases?: readonly string[]
}

/** Ajustes de entrega por projeto (`orkio-config` v8 → `delivery[projectId]`). */
export interface DeliverySettings {
  /** Pedir aprovação antes de CADA push (Orkio e Claude Code). Padrão: sim. */
  requirePushApproval: boolean
  /**
   * Agentes enviam a branch da tarefa e abrem/atualizam a PR sozinhos (qualquer conversa ou passo,
   * não só os passos de entrega). Ausente = não.
   */
  agentsDeliver?: boolean
  /** Destinos permitidos das PRs (`--base`); ausente = `DEFAULT_PR_BASES`. Nunca main/master. */
  prBases?: string[]
}

export const DEFAULT_DELIVERY_SETTINGS: DeliverySettings = { requirePushApproval: true }

/** Destino padrão das PRs quando os agentes entregam sozinhos. */
export const DEFAULT_PR_BASES: readonly string[] = ['dev']

/** Destinos que nunca recebem PR de agente, mesmo se estiverem na lista. */
export const NEVER_PR_BASES: readonly string[] = ['main', 'master']

export const PR_BASES_MAX = 5

/** Destinos das PRs do projeto (a lista salva ou o padrão). */
export function prBasesOf(settings: Pick<DeliverySettings, 'prBases'>): string[] {
  return settings.prBases?.length ? [...settings.prBases] : [...DEFAULT_PR_BASES]
}

/**
 * De onde sai a branch nova da tarefa: com "Agentes enviam e abrem PR", o primeiro destino das PRs
 * (ex.: `dev`), para a PR não trazer o que só está na padrão; senão `null` (a branch padrão).
 */
export function taskBaseBranch(
  settings: Pick<DeliverySettings, 'agentsDeliver' | 'prBases'> | undefined
): string | null {
  return settings?.agentsDeliver ? (prBasesOf(settings)[0] ?? null) : null
}

const cleanRef = (b: string): string => b.trim().replace(/^refs\/heads\//, '')

/**
 * A PR pode ir para `base`? `null` = sim. Sem `base` o GitHub usa a branch padrão (em geral a
 * `main`), então também é recusa: o agente precisa dizer o destino.
 */
export function checkPrBase(base: string | null, prBases: readonly string[]): string | null {
  const allowed = prBases.map(cleanRef).filter((b) => b && !isNeverBase(b))
  const list = allowed.join(', ') || 'nenhuma'
  if (base === null || !cleanRef(base)) return PR_BASE_MESSAGES.missing(allowed[0] ?? 'dev')
  const b = cleanRef(base)
  if (isNeverBase(b)) return PR_BASE_MESSAGES.never(b, list)
  if (!allowed.some((a) => a.toLowerCase() === b.toLowerCase())) {
    return PR_BASE_MESSAGES.notAllowed(b, list)
  }
  return null
}

function isNeverBase(b: string): boolean {
  return NEVER_PR_BASES.includes(b.toLowerCase())
}

const PB = 'Bloqueado pelo Orkio:'
export const PR_BASE_MESSAGES = {
  missing: (first: string) =>
    `${PB} diga o destino da PR (gh pr create --base ${first}); sem ele, o GitHub usaria a branch padrão.`,
  never: (b: string, list: string) =>
    `${PB} PR para “${b}” nunca é permitida a agentes. Destinos deste projeto: ${list}.`,
  notAllowed: (b: string, list: string) => `${PB} a PR só pode ir para ${list} (pedido: “${b}”).`,
  graphqlBase: `${PB} trocar a base da PR pelo GraphQL não é permitido; use gh pr edit --base.`
} as const

/**
 * Ajustes de entrega salvos (`orkio-config`) ou vindos da tela: `requirePushApproval` obrigatório;
 * os opcionais ruins caem sozinhos (lista de destinos com main/master volta ao padrão). `null` =
 * registro inválido.
 */
export function parseDeliverySettingsValue(value: unknown): DeliverySettings | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as Record<string, unknown>
  if (typeof v['requirePushApproval'] !== 'boolean') return null
  const out: DeliverySettings = { requirePushApproval: v['requirePushApproval'] }
  if (typeof v['agentsDeliver'] === 'boolean') out.agentsDeliver = v['agentsDeliver']
  if (v['prBases'] !== undefined) {
    const bases = parsePrBases(v['prBases'])
    if (bases.ok) out.prBases = bases.value
  }
  return out
}

/** A lista da tela/IPC: limpa, sem repetidas, nomes válidos, sem main/master, 1 a `PR_BASES_MAX`. */
export function parsePrBases(
  value: unknown
): { ok: true; value: string[] } | { ok: false; error: string } {
  if (!Array.isArray(value)) return { ok: false, error: 'Informe as branches de destino.' }
  const out: string[] = []
  for (const raw of value) {
    if (typeof raw !== 'string') return { ok: false, error: 'Nome de branch inválido.' }
    const b = cleanRef(raw)
    if (!b) continue
    if (!isBranchName(b)) return { ok: false, error: `Nome de branch inválido: “${b}”.` }
    if (isNeverBase(b)) return { ok: false, error: `PR de agente para “${b}” nunca é permitida.` }
    if (!out.some((o) => o.toLowerCase() === b.toLowerCase())) out.push(b)
  }
  if (out.length === 0) return { ok: false, error: 'Informe pelo menos uma branch de destino.' }
  if (out.length > PR_BASES_MAX) {
    return { ok: false, error: `No máximo ${PR_BASES_MAX} branches de destino.` }
  }
  return { ok: true, value: out }
}

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
  if (!isBranchName(b)) return DELIVERY_MESSAGES.invalid
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

/**
 * Projeto só com git local (sem a API do GitHub do Orkio): pedir revisão e publicar a revisão do
 * agente ainda não têm caminho (chegam com a leitura pelo `gh`).
 */
export const GIT_ONLY_REVIEW_MESSAGE =
  'Este projeto usa só o git desta máquina: pedir revisão e publicar a revisão chegam com a leitura pelo `gh`.'
