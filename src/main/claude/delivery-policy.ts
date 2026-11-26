/**
 * Veredito dos comandos de GitHub e `git push` do Claude Code (Etapa 5C), a partir da tabela de
 * `github-rules.ts`. Funções puras, chamadas pela política (`policy.ts`): no modo entrega, `read`
 * e `write` passam (com o evento) e `never` não; fora dele, só `read` (`isGhRead`).
 *
 * - `git push`: só a branch da tarefa, só o remote do projeto, sem força/remoção/mirror/tags.
 * - `gh pr|run|label`: a ação da tabela (com `-R`/URL só do próprio repositório).
 * - `gh api`: só `repos/<owner>/<repo>/…` do projeto ou GraphQL com o mesmo repositório.
 * - `gh release`, `gh repo`: nunca.
 *
 * `null` = o comando não é de GitHub/push (segue a política normal).
 */
import {
  PR_BASE_MESSAGES,
  checkPrBase,
  checkPushBranch,
  sameRepo,
  type DeliveryTarget
} from '../../shared/delivery'
import {
  GH_API_MUTATIONS,
  GH_API_NEVER_METHODS,
  GH_API_READ_METHODS,
  GH_API_ROUTES,
  GH_NEVER_FAMILIES,
  GH_NEVER_TEXT,
  PUSH_OPTIONS,
  PUSH_REFSPEC_NEVER,
  PUSH_SHORT,
  ghRule,
  type DeliveryEvent,
  type PushNeverReason
} from './github-rules'

export type { DeliveryEvent }

/** Categorias aprovadas uma vez por execução. */
export type DeliveryKind = 'push' | 'github'

export type DeliveryVerdict =
  | null
  | { ok: false; reason: string }
  /** A branch atual precisa ser lida antes de decidir (ver `decidePermission`). */
  | { ok: false; needs: 'currentBranch' }
  | { ok: true; kind: DeliveryKind; access: 'read' | 'write'; event: DeliveryEvent | null }

export interface DeliveryPolicyContext {
  target: DeliveryTarget
  /** `git config push.default` (`matching` torna `git push` sem refspec perigoso). */
  pushDefault: string | null
  /**
   * Branch atual do worktree (para `git push` sem refspec/`HEAD`). `undefined` = ainda não lida: a
   * política devolve `needs` e quem chama lê e pergunta de novo.
   */
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
  ghSub: (c: string) => `${B} “gh ${c}” não é permitido (${GH_NEVER_TEXT} ficam com você).`,
  ghHead: (b: string) => `${B} a PR só pode partir da branch da tarefa (“${b}”).`,
  apiDelete: `${B} gh api com método DELETE não é permitido.`,
  apiWrite: (p: string) => `${B} gh api só escreve em PR, comentários e revisores (pedido: ${p}).`,
  apiField: (f: string) =>
    `${B} gh api com “${f}” não é permitido (fechar PR, aprovar/reprovar revisão).`,
  apiFile: `${B} consulta GraphQL em arquivo (@arquivo/--input) não pode ser conferida.`,
  apiGetFields: `${B} gh api com GET e campos (-f/-F) não é permitido: ponha os parâmetros na URL (…?state=open).`,
  apiMutation: (m: string) => `${B} a mutation “${m}” do GraphQL não é permitida.`,
  apiEndpoint: `${B} gh api sem endpoint.`
} as const

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

const PUSH_REASON: Record<PushNeverReason, (opt: string) => string> = {
  force: () => DELIVERY_POLICY_MESSAGES.force,
  del: () => DELIVERY_POLICY_MESSAGES.del,
  option: (opt) => DELIVERY_POLICY_MESSAGES.pushOption(opt)
}

/** Opção do `git push` pela tabela: `null` = permitida; senão o motivo. */
function pushOptionReason(opt: string): string | null {
  const long = opt.includes('=') ? opt.slice(0, opt.indexOf('=')) : opt
  const rule = PUSH_OPTIONS[long]
  if (!rule) return DELIVERY_POLICY_MESSAGES.pushOption(opt)
  return rule.access === 'never' ? PUSH_REASON[rule.reason](opt) : null
}

/** Comandos que trocam/renomeiam a branch atual (antes de um `git push` sem refspec). */
const MOVES_HEAD = new Set([
  'checkout',
  'switch',
  'branch',
  'symbolic-ref',
  'update-ref',
  'worktree'
])

function gitPushVerdict(
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
    if (a === '-o' || a === '--push-option') {
      i++
      continue
    }
    if (a.startsWith('--push-option=')) continue
    if (a.startsWith('--')) {
      const reason = pushOptionReason(a)
      if (reason) return { ok: false, reason }
      continue
    }
    for (const c of a.slice(1)) {
      const long = PUSH_SHORT[c]
      const reason = long ? pushOptionReason(long) : DELIVERY_POLICY_MESSAGES.pushOption(`-${c}`)
      if (reason) return { ok: false, reason }
    }
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
    if (ctx.currentBranch === undefined) return { ok: false, needs: 'currentBranch' }
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
    return reason ? { ok: false, reason: `${B} ${reason}` } : PUSH_OK
  }
  for (const spec of refspecs) {
    const never = PUSH_REFSPEC_NEVER.find((r) => spec.startsWith(r.prefix))
    if (never) return { ok: false, reason: PUSH_REASON[never.reason](spec) }
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
  return PUSH_OK
}

const PUSH_OK: DeliveryVerdict = { ok: true, kind: 'push', access: 'write', event: 'push' }

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
  const family = args[0] ?? ''
  const fullName = `${target.owner}/${target.repo}`
  if (family === 'api') return ghApiVerdict(args.slice(1), target)
  const action = args[1] ?? ''
  const rule = ghRule(family, action)
  if (!rule) return null
  const label = (GH_NEVER_FAMILIES as readonly string[]).includes(family)
    ? family
    : `${family} ${action}`.trim()
  if (rule.access === 'never') {
    return { ok: false, reason: DELIVERY_POLICY_MESSAGES.ghSub(label) }
  }
  for (const r of optionValues(args, '-R', '--repo')) {
    if (!repoArgOk(r, target))
      return { ok: false, reason: DELIVERY_POLICY_MESSAGES.otherRepo(fullName) }
  }
  if (family === 'pr') {
    if (action === 'create') {
      for (const h of optionValues(args, '-H', '--head')) {
        const branch = h.includes(':') ? h.slice(h.indexOf(':') + 1) : h
        if (branch !== target.branch)
          return { ok: false, reason: DELIVERY_POLICY_MESSAGES.ghHead(target.branch) }
      }
    }
    // Destino da PR (projeto com os agentes entregando): criar exige um da lista; trocar também.
    if (target.prBases && (action === 'create' || action === 'edit')) {
      const bases = optionValues(args, '-B', '--base')
      const reason =
        action === 'create' && bases.length === 0
          ? checkPrBase(null, target.prBases)
          : bases.map((b) => checkPrBase(b, target.prBases!)).find((r) => r !== null)
      if (reason) return { ok: false, reason }
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
  }
  return rule.access === 'read'
    ? { ok: true, kind: 'github', access: 'read', event: null }
    : { ok: true, kind: 'github', access: 'write', event: rule.event }
}

/**
 * Leitura do GitHub fora do modo entrega: as formas `read` da tabela (`github-rules.ts`), só no
 * repositório do projeto. Escrita nunca passa por aqui, com ou sem evento no histórico.
 */
export function isGhRead(args: readonly string[], target: DeliveryTarget): boolean {
  const v = ghVerdict(args, target)
  return v !== null && v.ok && v.access === 'read'
}

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

function ghApiVerdict(args: readonly string[], target: DeliveryTarget): DeliveryVerdict {
  const call = ghApiParse(args)
  const fullName = `${target.owner}/${target.repo}`
  if (!call.endpoint) return { ok: false, reason: DELIVERY_POLICY_MESSAGES.apiEndpoint }
  if (call.hostname && call.hostname.toLowerCase() !== 'github.com') {
    return { ok: false, reason: DELIVERY_POLICY_MESSAGES.ghHost }
  }
  const method = call.method ?? (call.fields.length > 0 || call.input ? 'POST' : 'GET')
  if ((GH_API_NEVER_METHODS as readonly string[]).includes(method)) {
    return { ok: false, reason: DELIVERY_POLICY_MESSAGES.apiDelete }
  }
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
        if (!Object.hasOwn(GH_API_MUTATIONS, f))
          return { ok: false, reason: DELIVERY_POLICY_MESSAGES.apiMutation(f) }
        event = event ?? GH_API_MUTATIONS[f] ?? null
      }
      // A base vem num campo do input ou numa variável: com destinos restritos, não passa.
      if (
        target.prBases &&
        /\bbaseRefName\b/.test(call.fields.map(([k, v]) => `${k}=${v}`).join(' '))
      ) {
        return { ok: false, reason: PR_BASE_MESSAGES.graphqlBase }
      }
      return { ok: true, kind: 'github', access: 'write', event }
    }
    return { ok: true, kind: 'github', access: 'read', event: null }
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
  if ((GH_API_READ_METHODS as readonly string[]).includes(method)) {
    // Leitura é sem campos nem arquivo (com campos o `gh` monta um corpo; o CLI nega também).
    if (call.fields.length > 0 || call.input) {
      return { ok: false, reason: DELIVERY_POLICY_MESSAGES.apiGetFields }
    }
    return { ok: true, kind: 'github', access: 'read', event: null }
  }
  const rest = m[3] ?? ''
  const rule = GH_API_ROUTES.find((r) => r.route.test(rest) && r.methods.includes(method))
  if (!rule)
    return { ok: false, reason: DELIVERY_POLICY_MESSAGES.apiWrite(`${method} ${rest || '/'}`) }
  // Fechar a PR ou aprovar/reprovar revisão: ficam com a pessoa.
  if (field('state').some((v) => v.toLowerCase() === 'closed')) {
    return { ok: false, reason: DELIVERY_POLICY_MESSAGES.apiField('state=closed') }
  }
  if (field('event').some((v) => /^(APPROVE|REQUEST_CHANGES)$/i.test(v))) {
    return { ok: false, reason: DELIVERY_POLICY_MESSAGES.apiField('event') }
  }
  if (target.prBases && /^\/pulls(\/\d+)?\/?$/.test(rest)) {
    const bases = field('base')
    const creating = /^\/pulls\/?$/.test(rest)
    const reason =
      creating && bases.length === 0
        ? checkPrBase(null, target.prBases)
        : bases.map((b) => checkPrBase(b, target.prBases!)).find((r) => r !== null)
    if (reason) return { ok: false, reason }
  }
  if (rule.event === 'pr_create') {
    for (const h of field('head')) {
      const branch = h.includes(':') ? h.slice(h.indexOf(':') + 1) : h
      if (branch !== target.branch)
        return { ok: false, reason: DELIVERY_POLICY_MESSAGES.ghHead(target.branch) }
    }
  }
  return { ok: true, kind: 'github', access: 'write', event: rule.event }
}
