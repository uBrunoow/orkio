/**
 * Regras do "modo entrega" (Etapa 5C) para comandos do Claude Code. Funções puras, chamadas pela
 * política (`policy.ts`) só quando a execução é de um passo de fluxo marcado com `delivery`.
 *
 * - `git push`: só a branch da tarefa, só o remote do projeto, sem força/remoção/mirror/tags.
 * - `gh pr create|view|edit|checks|comment|diff|list|status|ready`, `gh run view|list|watch`,
 *   `gh label list`: liberados (com `-R` só do próprio repositório).
 * - `gh api`: só `repos/<owner>/<repo>/…` do projeto ou GraphQL com o mesmo repositório; escrita
 *   só em PR/comentários/revisores; nunca DELETE; mutations do GraphQL só da allowlist.
 * - `gh pr merge|close|review|checkout…`, `gh release`, `gh repo`: bloqueados.
 *
 * `null` = o comando não é de entrega (segue a política normal).
 */
import type { DeliveryAction } from '../../shared/task-events'
import { checkPushBranch, sameRepo, type DeliveryTarget } from '../../shared/delivery'

/** Categorias aprovadas uma vez por execução. */
export type DeliveryKind = 'push' | 'github'

/** O que um comando liberado faz, para o histórico da tarefa (`review_post` é só do Orkio). */
export type DeliveryEvent = Exclude<DeliveryAction, 'review_post'>

export type DeliveryVerdict =
  | null
  | { ok: false; reason: string }
  | { ok: true; kind: DeliveryKind; event: DeliveryEvent | null }

export interface DeliveryPolicyContext {
  target: DeliveryTarget
  /** `git config push.default` (`matching` torna `git push` sem refspec perigoso). */
  pushDefault: string | null
  /** Branch atual do worktree, lida logo antes de avaliar (para `git push`/`HEAD`). */
  currentBranch?: string | null
}

const B = 'Bloqueado pelo Orkio (modo entrega):'
export const DELIVERY_POLICY_MESSAGES = {
  force: `${B} push com força (--force, -f, --force-with-lease, +branch) nunca é permitido.`,
  del: `${B} apagar branch remota (--delete, :branch) não é permitido.`,
  pushOption: (o: string) => `${B} opção “${o}” do git push não é permitida.`,
  gitGlobal: (o: string) => `${B} opção “${o}” do git não é permitida junto com push.`,
  remote: (r: string) => `${B} push só para o remote do projeto (“${r}”).`,
  matching: `${B} com push.default=matching, “git push” sem branch enviaria várias branches. Informe a branch da tarefa.`,
  ambiguous: `${B} faça o push numa linha separada e com a branch da tarefa explícita (a linha também troca de branch).`,
  refs: `${B} só branches (refs/heads) podem ir para o GitHub; tags e outros refs não.`,
  noBranch: `${B} não deu para saber a branch atual do ambiente; informe a branch da tarefa no push.`,
  otherRepo: (r: string) => `${B} o GitHub CLI só pode agir no repositório do projeto (${r}).`,
  ghHost: `${B} só github.com é permitido.`,
  ghSub: (c: string) =>
    `${B} “gh ${c}” não é permitido (merge, fechar, revisar, release e repo ficam com você).`,
  ghHead: (b: string) => `${B} a PR só pode partir da branch da tarefa (“${b}”).`,
  apiDelete: `${B} gh api com método DELETE não é permitido.`,
  apiWrite: (p: string) => `${B} gh api só escreve em PR, comentários e revisores (pedido: ${p}).`,
  apiField: (f: string) =>
    `${B} gh api com “${f}” não é permitido (fechar PR, aprovar/reprovar revisão).`,
  apiFile: `${B} consulta GraphQL em arquivo (@arquivo/--input) não pode ser conferida.`,
  apiMutation: (m: string) => `${B} a mutation “${m}” do GraphQL não é permitida.`,
  apiEndpoint: `${B} gh api sem endpoint.`
} as const

/** Opções globais do git que levam valor (`-C dir`, `-c k=v`, …). */
const GIT_GLOBAL_WITH_VALUE = new Set([
  '-C',
  '-c',
  '--git-dir',
  '--work-tree',
  '--namespace',
  '--exec-path',
  '--config-env',
  '--super-prefix'
])

/** Divide `git <globais> <subcomando> <resto>`. */
export function gitParse(args: readonly string[]): {
  globals: string[]
  sub: string | null
  rest: string[]
} {
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!
    if (GIT_GLOBAL_WITH_VALUE.has(a)) {
      i++
      continue
    }
    if (a.startsWith('-')) continue
    return { globals: args.slice(0, i), sub: a, rest: args.slice(i + 1) }
  }
  return { globals: [...args], sub: null, rest: [] }
}

export function deliveryVerdict(
  name: string,
  args: readonly string[],
  ctx: DeliveryPolicyContext,
  _worktree: string,
  /** Outros comandos da mesma linha (para detectar troca de branch antes do push). */
  siblings: readonly { name: string; args: readonly string[] }[] = []
): DeliveryVerdict {
  if (name === 'git') {
    const { globals, sub, rest } = gitParse(args)
    if (sub !== 'push') return null
    return gitPushVerdict(globals, rest, ctx, siblings)
  }
  if (name === 'gh') return ghVerdict(args, ctx.target)
  return null
}

// ---------------------------------------------------------------- git push

const PUSH_FLAGS = new Set([
  '-u',
  '--set-upstream',
  '--porcelain',
  '-q',
  '--quiet',
  '-v',
  '--verbose',
  '--progress',
  '--no-progress',
  '--no-verify',
  '--verify',
  '-n',
  '--dry-run',
  '--atomic',
  '--no-atomic'
])
const FORCE = /^(--force|--force-with-lease|--force-if-includes|--no-force-if-includes)(=.*)?$/
const DELETE = /^(--delete|--prune|--mirror|--all|--branches|--tags|--follow-tags)$/
/** Comandos que trocam/renomeiam a branch atual (antes de um `git push` sem refspec). */
const MOVES_HEAD = new Set([
  'checkout',
  'switch',
  'branch',
  'symbolic-ref',
  'update-ref',
  'worktree'
])

export function gitPushVerdict(
  globals: readonly string[],
  rest: readonly string[],
  ctx: DeliveryPolicyContext,
  siblings: readonly { name: string; args: readonly string[] }[] = []
): DeliveryVerdict {
  for (let i = 0; i < globals.length; i++) {
    const g = globals[i]!
    if (g === '-C') {
      i++ // o diretório passa pela checagem de "fora do worktree"
      continue
    }
    if (g === '--no-pager' || g === '-P' || g === '--no-optional-locks') continue
    return { ok: false, reason: DELIVERY_POLICY_MESSAGES.gitGlobal(g) }
  }
  const positionals: string[] = []
  let onlyPositionals = false
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!
    if (onlyPositionals || !a.startsWith('-') || a === '-') {
      positionals.push(a)
      continue
    }
    if (a === '--') {
      onlyPositionals = true
      continue
    }
    if (FORCE.test(a)) return { ok: false, reason: DELIVERY_POLICY_MESSAGES.force }
    if (DELETE.test(a)) {
      return {
        ok: false,
        reason:
          a === '--delete' || a === '--prune'
            ? DELIVERY_POLICY_MESSAGES.del
            : DELIVERY_POLICY_MESSAGES.pushOption(a)
      }
    }
    if (PUSH_FLAGS.has(a)) continue
    if (a === '-o' || a === '--push-option') {
      i++
      continue
    }
    if (a.startsWith('--push-option=')) continue
    if (/^-[a-zA-Z]+$/.test(a)) {
      // Opções curtas (também juntas, `-uf`): cada letra precisa ser permitida.
      for (const c of a.slice(1)) {
        if (c === 'f') return { ok: false, reason: DELIVERY_POLICY_MESSAGES.force }
        if (c === 'd') return { ok: false, reason: DELIVERY_POLICY_MESSAGES.del }
        if (!'uqvn'.includes(c))
          return { ok: false, reason: DELIVERY_POLICY_MESSAGES.pushOption(`-${c}`) }
      }
      continue
    }
    return { ok: false, reason: DELIVERY_POLICY_MESSAGES.pushOption(a) }
  }

  const [remote, ...refspecs] = positionals
  if (remote !== undefined && remote !== ctx.target.remote) {
    return { ok: false, reason: DELIVERY_POLICY_MESSAGES.remote(ctx.target.remote) }
  }
  const movesHead = siblings.some(
    (s) => s.name === 'git' && MOVES_HEAD.has(gitParse(s.args).sub ?? '')
  )
  const current = (): DeliveryVerdict | string => {
    if (movesHead) return { ok: false, reason: DELIVERY_POLICY_MESSAGES.ambiguous }
    if (!ctx.currentBranch) return { ok: false, reason: DELIVERY_POLICY_MESSAGES.noBranch }
    return ctx.currentBranch
  }
  if (refspecs.length === 0) {
    if (ctx.pushDefault?.toLowerCase() === 'matching') {
      return { ok: false, reason: DELIVERY_POLICY_MESSAGES.matching }
    }
    const b = current()
    if (typeof b !== 'string') return b
    const reason = checkPushBranch(b, ctx.target)
    return reason
      ? { ok: false, reason: `${B} ${reason}` }
      : { ok: true, kind: 'push', event: 'push' }
  }
  for (const spec of refspecs) {
    if (spec.startsWith('+')) return { ok: false, reason: DELIVERY_POLICY_MESSAGES.force }
    if (spec.includes('*')) return { ok: false, reason: DELIVERY_POLICY_MESSAGES.refs }
    const colon = spec.indexOf(':')
    const src = colon >= 0 ? spec.slice(0, colon) : spec
    let dst = colon >= 0 ? spec.slice(colon + 1) : spec
    if (colon >= 0 && dst === '') return { ok: false, reason: DELIVERY_POLICY_MESSAGES.del }
    if (src === '' && colon >= 0) return { ok: false, reason: DELIVERY_POLICY_MESSAGES.del }
    if (dst === 'HEAD' || dst === '@') {
      const b = current()
      if (typeof b !== 'string') return b
      dst = b
    }
    if (dst.startsWith('refs/') && !dst.startsWith('refs/heads/')) {
      return { ok: false, reason: DELIVERY_POLICY_MESSAGES.refs }
    }
    const reason = checkPushBranch(dst.replace(/^refs\/heads\//, ''), ctx.target)
    if (reason) return { ok: false, reason: `${B} ${reason}` }
  }
  return { ok: true, kind: 'push', event: 'push' }
}

// ---------------------------------------------------------------- gh

const PR_ALLOWED: Record<string, DeliveryEvent | null> = {
  create: 'pr_create',
  edit: 'pr_edit',
  comment: 'pr_comment',
  ready: 'pr_ready',
  view: null,
  checks: null,
  diff: null,
  list: null,
  status: null
}
const RUN_ALLOWED = new Set(['view', 'list', 'watch'])
const LABEL_ALLOWED = new Set(['list'])

/** Valores de uma opção (`-R x`, `--repo x`, `--repo=x`). */
function optionValues(args: readonly string[], short: string | null, long: string): string[] {
  const out: string[] = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!
    if (a === long || (short && a === short)) out.push(args[i + 1] ?? '')
    else if (a.startsWith(`${long}=`)) out.push(a.slice(long.length + 1))
    else if (short && a.startsWith(short) && a.length > short.length && !a.startsWith('--'))
      out.push(a.slice(short.length))
  }
  return out
}

/** `owner/repo`, `github.com/owner/repo` ou URL → é o repositório do projeto? */
function repoArgOk(value: string, target: DeliveryTarget): boolean {
  const clean = value
    .replace(/^https?:\/\//, '')
    .replace(/\.git$/, '')
    .replace(/\/+$/, '')
  const parts = clean.split('/')
  if (parts.length === 3 && parts[0]!.toLowerCase() !== 'github.com') return false
  if (parts.length !== 2 && parts.length !== 3) return false
  const [owner, repo] = parts.slice(-2) as [string, string]
  return sameRepo(owner, repo, target)
}

export function ghVerdict(args: readonly string[], target: DeliveryTarget): DeliveryVerdict {
  const sub = args[0] ?? ''
  const fullName = `${target.owner}/${target.repo}`
  if (sub === 'release' || sub === 'repo') {
    return { ok: false, reason: DELIVERY_POLICY_MESSAGES.ghSub(sub) }
  }
  if (sub === 'api') return ghApiVerdict(args.slice(1), target)
  if (sub !== 'pr' && sub !== 'run' && sub !== 'label') return null
  for (const r of optionValues(args, '-R', '--repo')) {
    if (!repoArgOk(r, target))
      return { ok: false, reason: DELIVERY_POLICY_MESSAGES.otherRepo(fullName) }
  }
  const action = args[1] ?? ''
  const label = `${sub} ${action}`.trim()
  if (sub === 'pr') {
    if (!(action in PR_ALLOWED)) return { ok: false, reason: DELIVERY_POLICY_MESSAGES.ghSub(label) }
    if (action === 'create') {
      for (const h of optionValues(args, '-H', '--head')) {
        const branch = h.includes(':') ? h.slice(h.indexOf(':') + 1) : h
        if (branch !== target.branch)
          return { ok: false, reason: DELIVERY_POLICY_MESSAGES.ghHead(target.branch) }
      }
    }
    if (action === 'comment' && args.includes('--delete-last')) {
      return { ok: false, reason: DELIVERY_POLICY_MESSAGES.apiDelete }
    }
    // Um número/URL de PR de outro repositório também é "outro repositório".
    const url = args.find((a) => /^https?:\/\/github\.com\//.test(a))
    if (url) {
      const m = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\//.exec(url)
      if (!m || !sameRepo(m[1]!, m[2]!, target)) {
        return { ok: false, reason: DELIVERY_POLICY_MESSAGES.otherRepo(fullName) }
      }
    }
    return { ok: true, kind: 'github', event: PR_ALLOWED[action] ?? null }
  }
  const allowed = sub === 'run' ? RUN_ALLOWED : LABEL_ALLOWED
  if (!allowed.has(action)) return { ok: false, reason: DELIVERY_POLICY_MESSAGES.ghSub(label) }
  return { ok: true, kind: 'github', event: null }
}

/**
 * Leitura do GitHub fora do modo entrega: `gh pr view|diff|checks|list|status`, `gh run
 * view|list|watch`, `gh label list` e `gh api` só com GET/HEAD em `repos/<owner>/<repo>/…` do
 * projeto ou GraphQL sem mutation. Mesmas checagens de repositório do modo entrega; nada que
 * escreva passa (todo comando que escreve tem evento, e mutation é recusada à parte).
 */
export function isGhRead(args: readonly string[], target: DeliveryTarget): boolean {
  const sub = args[0] ?? ''
  if (!['pr', 'run', 'label', 'api'].includes(sub)) return false
  if (sub === 'api') {
    const call = ghApiParse(args.slice(1))
    if (call.input || !call.endpoint) return false
    if (call.endpoint.replace(/^\//, '') === 'graphql') {
      const query = call.fields.find(([k]) => k === 'query')?.[1]
      if (query === undefined || query.startsWith('@') || /\bmutation\b/.test(query)) return false
    } else {
      const method = call.method ?? (call.fields.length > 0 ? 'POST' : 'GET')
      if (method !== 'GET' && method !== 'HEAD') return false
    }
  }
  const v = ghVerdict(args, target)
  return v !== null && v.ok && v.event === null
}

// ---------------------------------------------------------------- gh api

const API_WITH_VALUE = new Set([
  '-X',
  '--method',
  '-f',
  '--raw-field',
  '-F',
  '--field',
  '-H',
  '--header',
  '--input',
  '-q',
  '--jq',
  '-t',
  '--template',
  '--hostname',
  '--cache',
  '-p',
  '--preview'
])

export interface GhApiCall {
  endpoint: string | null
  method: string | null
  fields: [string, string][]
  input: boolean
  hostname: string | null
}

export function ghApiParse(args: readonly string[]): GhApiCall {
  const call: GhApiCall = { endpoint: null, method: null, fields: [], input: false, hostname: null }
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!
    let opt = a
    let value: string | undefined
    if (a.startsWith('--') && a.includes('=')) {
      opt = a.slice(0, a.indexOf('='))
      value = a.slice(a.indexOf('=') + 1)
    } else if (/^-[XfFHqtp]./.test(a)) {
      opt = a.slice(0, 2)
      value = a.slice(2)
    }
    if (API_WITH_VALUE.has(opt)) {
      if (value === undefined) value = args[++i] ?? ''
      if (opt === '-X' || opt === '--method') call.method = value.toUpperCase()
      else if (['-f', '--raw-field', '-F', '--field'].includes(opt)) {
        const eq = value.indexOf('=')
        call.fields.push(eq >= 0 ? [value.slice(0, eq), value.slice(eq + 1)] : [value, ''])
      } else if (opt === '--input') call.input = true
      else if (opt === '--hostname') call.hostname = value
      continue
    }
    if (a.startsWith('-')) continue
    if (call.endpoint === null) call.endpoint = a
  }
  return call
}

/** Mutations do GraphQL permitidas e o evento que cada uma gera. */
const MUTATIONS: Record<string, DeliveryEvent | null> = {
  addPullRequestReviewThreadReply: 'thread_reply',
  resolveReviewThread: 'thread_resolve',
  unresolveReviewThread: null,
  addComment: 'pr_comment',
  addPullRequestReviewComment: 'pr_comment',
  updatePullRequestReviewComment: 'pr_comment',
  updateIssueComment: 'pr_comment',
  requestReviews: 'review_request',
  markPullRequestReadyForReview: 'pr_ready',
  updatePullRequest: 'pr_edit'
}

/** Campos do primeiro nível da operação (`{ campo(args) { … } }`), ignorando strings. */
export function topLevelFields(query: string): string[] {
  const body = query.replace(/"(?:\\.|[^"\\])*"/g, '""').replace(/#[^\n]*/g, '')
  const out: string[] = []
  let depth = 0
  let parens = 0
  // Varre tokens; no nível 1 de chaves e fora de parênteses, cada identificador é um campo
  // (`apelido:` é pulado: o campo é o identificador seguinte).
  const tokens = body.match(/[{}()]|[A-Za-z_]\w*\s*:|[A-Za-z_]\w*/g) ?? []
  for (const t of tokens) {
    if (t === '{') depth++
    else if (t === '}') depth--
    else if (t === '(') parens++
    else if (t === ')') parens--
    else if (depth === 1 && parens === 0 && !t.endsWith(':')) out.push(t.trim())
  }
  return out
}

export function ghApiVerdict(args: readonly string[], target: DeliveryTarget): DeliveryVerdict {
  const call = ghApiParse(args)
  const fullName = `${target.owner}/${target.repo}`
  if (!call.endpoint) return { ok: false, reason: DELIVERY_POLICY_MESSAGES.apiEndpoint }
  if (call.hostname && call.hostname.toLowerCase() !== 'github.com') {
    return { ok: false, reason: DELIVERY_POLICY_MESSAGES.ghHost }
  }
  const method = call.method ?? (call.fields.length > 0 || call.input ? 'POST' : 'GET')
  if (method === 'DELETE') return { ok: false, reason: DELIVERY_POLICY_MESSAGES.apiDelete }
  const field = (k: string): string[] => call.fields.filter(([key]) => key === k).map(([, v]) => v)

  if (call.endpoint.replace(/^\//, '') === 'graphql') {
    if (call.input) return { ok: false, reason: DELIVERY_POLICY_MESSAGES.apiFile }
    const query = field('query')[0]
    if (query === undefined || query.startsWith('@')) {
      return { ok: false, reason: DELIVERY_POLICY_MESSAGES.apiFile }
    }
    for (const v of field('owner')) {
      if (v.toLowerCase() !== target.owner.toLowerCase())
        return { ok: false, reason: DELIVERY_POLICY_MESSAGES.otherRepo(fullName) }
    }
    for (const v of [...field('repo'), ...field('name'), ...field('repository')]) {
      if (!sameRepo(target.owner, v, target))
        return { ok: false, reason: DELIVERY_POLICY_MESSAGES.otherRepo(fullName) }
    }
    for (const m of query.matchAll(/repository\s*\(([^)]*)\)/g)) {
      const owner = /owner\s*:\s*"([^"]*)"/.exec(m[1]!)?.[1]
      const name = /name\s*:\s*"([^"]*)"/.exec(m[1]!)?.[1]
      if (
        (owner !== undefined && owner.toLowerCase() !== target.owner.toLowerCase()) ||
        (name !== undefined && !sameRepo(target.owner, name, target))
      ) {
        return { ok: false, reason: DELIVERY_POLICY_MESSAGES.otherRepo(fullName) }
      }
    }
    if (/\bmutation\b/.test(query)) {
      const body = query.replace(/\bmutation\b\s*\w*\s*(\([^)]*\))?/, '')
      let event: DeliveryEvent | null = null
      const fields = topLevelFields(body)
      if (fields.length === 0)
        return { ok: false, reason: DELIVERY_POLICY_MESSAGES.apiMutation('?') }
      for (const f of fields) {
        if (!(f in MUTATIONS)) return { ok: false, reason: DELIVERY_POLICY_MESSAGES.apiMutation(f) }
        event = event ?? MUTATIONS[f] ?? null
      }
      return { ok: true, kind: 'github', event }
    }
    return { ok: true, kind: 'github', event: null }
  }

  const path = call.endpoint
    .replace(/^\//, '')
    .split('?')[0]!
    .replace(/\{owner\}/g, target.owner)
    .replace(/\{repo\}/g, target.repo)
    .replace(/\{branch\}/g, target.branch)
  const m = /^repos\/([^/]+)\/([^/]+)(\/.*)?$/.exec(path)
  if (!m || !sameRepo(m[1]!, m[2]!, target)) {
    return { ok: false, reason: DELIVERY_POLICY_MESSAGES.otherRepo(fullName) }
  }
  if (method === 'GET' || method === 'HEAD') return { ok: true, kind: 'github', event: null }
  const rest = m[3] ?? ''
  const rules: [RegExp, string[], DeliveryEvent][] = [
    [/^\/pulls$/, ['POST'], 'pr_create'],
    [/^\/pulls\/\d+$/, ['PATCH'], 'pr_edit'],
    [/^\/pulls\/\d+\/comments$/, ['POST'], 'pr_comment'],
    [/^\/pulls\/\d+\/comments\/\d+\/replies$/, ['POST'], 'thread_reply'],
    [/^\/pulls\/comments\/\d+$/, ['PATCH'], 'pr_comment'],
    [/^\/pulls\/\d+\/reviews$/, ['POST'], 'pr_comment'],
    [/^\/pulls\/\d+\/requested_reviewers$/, ['POST'], 'review_request'],
    [/^\/issues\/\d+\/comments$/, ['POST'], 'pr_comment'],
    [/^\/issues\/comments\/\d+$/, ['PATCH'], 'pr_comment'],
    [/^\/issues\/\d+\/labels$/, ['POST', 'PUT'], 'pr_edit']
  ]
  const rule = rules.find(([re, methods]) => re.test(rest) && methods.includes(method))
  if (!rule)
    return { ok: false, reason: DELIVERY_POLICY_MESSAGES.apiWrite(`${method} ${rest || '/'}`) }
  // Fechar a PR ou aprovar/reprovar revisão: ficam com a pessoa.
  if (field('state').some((v) => v.toLowerCase() === 'closed')) {
    return { ok: false, reason: DELIVERY_POLICY_MESSAGES.apiField('state=closed') }
  }
  if (field('event').some((v) => /^(APPROVE|REQUEST_CHANGES)$/i.test(v))) {
    return { ok: false, reason: DELIVERY_POLICY_MESSAGES.apiField('event') }
  }
  if (rule[2] === 'pr_create') {
    for (const h of field('head')) {
      const branch = h.includes(':') ? h.slice(h.indexOf(':') + 1) : h
      if (branch !== target.branch)
        return { ok: false, reason: DELIVERY_POLICY_MESSAGES.ghHead(target.branch) }
    }
  }
  return { ok: true, kind: 'github', event: rule[2] }
}
