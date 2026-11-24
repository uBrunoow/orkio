/**
 * Regras do GitHub e do `git push` para os comandos do Claude Code, numa tabela só. Cada forma tem
 * um acesso:
 *
 * - `read`: lê (fora do modo entrega passa sem perguntar, só no repositório do projeto);
 * - `write`: escreve (só no modo entrega, com o evento que vai para o histórico);
 * - `never`: nunca (nem no modo entrega).
 *
 * Daqui saem a decisão da política (`delivery-policy.ts`: `ghVerdict`, `isGhRead`,
 * `gitPushVerdict`), o deny do CLI (`RUN_SETTINGS`/`DELIVERY_RUN_SETTINGS` em `runner.ts`, que vale
 * mesmo com uma regra "permitir" no `~/.claude` do usuário) e os textos das mensagens. A checagem
 * dupla (CLI + política) é deliberada; a tabela é que é uma só.
 */
import type { DeliveryAction } from '../../shared/task-events'

/** O que um comando liberado faz, para o histórico da tarefa (`review_post` é só do Orkio). */
export type DeliveryEvent = Exclude<DeliveryAction, 'review_post'>

export type GhAccess = 'read' | 'write' | 'never'

export type GhRule =
  { access: 'read' } | { access: 'never' } | { access: 'write'; event: DeliveryEvent | null }

const READ: GhRule = { access: 'read' }
const NEVER: GhRule = { access: 'never' }
const write = (event: DeliveryEvent | null): GhRule => ({ access: 'write', event })

/**
 * `gh <família> <ação>`. Ação fora da lista = `never` na política (o deny do CLI só conhece as
 * listadas).
 */
export const GH_COMMANDS = {
  pr: {
    view: READ,
    checks: READ,
    diff: READ,
    list: READ,
    status: READ,
    create: write('pr_create'),
    edit: write('pr_edit'),
    comment: write('pr_comment'),
    ready: write('pr_ready'),
    merge: NEVER,
    close: NEVER,
    reopen: NEVER,
    review: NEVER,
    checkout: NEVER,
    lock: NEVER,
    unlock: NEVER,
    revert: NEVER,
    'update-branch': NEVER
  },
  run: { view: READ, list: READ, watch: READ, rerun: NEVER, cancel: NEVER, delete: NEVER },
  label: { list: READ, create: NEVER, edit: NEVER, delete: NEVER, clone: NEVER }
} as const satisfies Record<string, Record<string, GhRule>>

export type GhFamily = keyof typeof GH_COMMANDS

export const GH_NEVER_FAMILIES = ['release', 'repo'] as const

/** Famílias que a política do Orkio decide (o resto do `gh` segue a política normal). */
export const GH_RULED = new Set<string>([...Object.keys(GH_COMMANDS), ...GH_NEVER_FAMILIES, 'api'])

export function ghRule(family: string, action: string): GhRule | null {
  if ((GH_NEVER_FAMILIES as readonly string[]).includes(family)) return NEVER
  if (!Object.hasOwn(GH_COMMANDS, family)) return null
  const actions: Record<string, GhRule> = GH_COMMANDS[family as GhFamily]
  return Object.hasOwn(actions, action) ? actions[action]! : NEVER
}

/**
 * REST: `GET`/`HEAD` sem campos em `repos/<owner>/<repo>/…` do projeto = leitura; `DELETE` nunca;
 * escrita só nas rotas abaixo (PR, comentários, revisores). Com campos (`-f`/`-F`) o `gh` manda
 * `POST`: nunca é leitura (os parâmetros de uma leitura vão na URL).
 */
export const GH_API_ROUTES: readonly {
  route: RegExp
  methods: readonly string[]
  event: DeliveryEvent
}[] = [
  { route: /^\/pulls$/, methods: ['POST'], event: 'pr_create' },
  { route: /^\/pulls\/\d+$/, methods: ['PATCH'], event: 'pr_edit' },
  { route: /^\/pulls\/\d+\/comments$/, methods: ['POST'], event: 'pr_comment' },
  { route: /^\/pulls\/\d+\/comments\/\d+\/replies$/, methods: ['POST'], event: 'thread_reply' },
  { route: /^\/pulls\/comments\/\d+$/, methods: ['PATCH'], event: 'pr_comment' },
  { route: /^\/pulls\/\d+\/reviews$/, methods: ['POST'], event: 'pr_comment' },
  { route: /^\/pulls\/\d+\/requested_reviewers$/, methods: ['POST'], event: 'review_request' },
  { route: /^\/issues\/\d+\/comments$/, methods: ['POST'], event: 'pr_comment' },
  { route: /^\/issues\/comments\/\d+$/, methods: ['PATCH'], event: 'pr_comment' },
  { route: /^\/issues\/\d+\/labels$/, methods: ['POST', 'PUT'], event: 'pr_edit' }
]

export const GH_API_READ_METHODS = ['GET', 'HEAD'] as const
export const GH_API_WRITE_METHODS = ['POST', 'PUT', 'PATCH'] as const
export const GH_API_NEVER_METHODS = ['DELETE'] as const

/** GraphQL: consulta sem mutation = leitura; mutations só destas (escrita), com o evento. */
export const GH_API_MUTATIONS: Readonly<Record<string, DeliveryEvent | null>> = {
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

export type PushNeverReason = 'force' | 'del' | 'option'

/** Opções longas do `git push` (com ou sem `=valor`). Ausente = não permitida. */
export const PUSH_OPTIONS: Readonly<
  Record<string, { access: 'write' } | { access: 'never'; reason: PushNeverReason }>
> = {
  '--set-upstream': { access: 'write' },
  '--porcelain': { access: 'write' },
  '--quiet': { access: 'write' },
  '--verbose': { access: 'write' },
  '--progress': { access: 'write' },
  '--no-progress': { access: 'write' },
  '--no-verify': { access: 'write' },
  '--verify': { access: 'write' },
  '--dry-run': { access: 'write' },
  '--atomic': { access: 'write' },
  '--no-atomic': { access: 'write' },
  '--force': { access: 'never', reason: 'force' },
  '--force-with-lease': { access: 'never', reason: 'force' },
  '--force-if-includes': { access: 'never', reason: 'force' },
  '--no-force-if-includes': { access: 'never', reason: 'force' },
  '--delete': { access: 'never', reason: 'del' },
  '--prune': { access: 'never', reason: 'del' },
  '--mirror': { access: 'never', reason: 'option' },
  '--all': { access: 'never', reason: 'option' },
  '--branches': { access: 'never', reason: 'option' },
  '--tags': { access: 'never', reason: 'option' },
  '--follow-tags': { access: 'never', reason: 'option' }
}

/** Opções curtas = a longa equivalente (também juntas: `-uf`). */
export const PUSH_SHORT: Readonly<Record<string, string>> = {
  u: '--set-upstream',
  q: '--quiet',
  v: '--verbose',
  n: '--dry-run',
  f: '--force',
  d: '--delete'
}

/** Refspecs que nunca vão: `+x` (força) e `:x` (apaga a branch remota). */
export const PUSH_REFSPEC_NEVER: readonly { prefix: string; reason: PushNeverReason }[] = [
  { prefix: '+', reason: 'force' },
  { prefix: ':', reason: 'del' }
]

const bash = (pattern: string): string => `Bash(${pattern})`

function ghDeny(denied: ReadonlySet<GhAccess>): string[] {
  const out: string[] = []
  for (const [family, actions] of Object.entries(GH_COMMANDS)) {
    for (const [action, rule] of Object.entries(actions as Record<string, GhRule>)) {
      if (denied.has(rule.access)) out.push(bash(`gh ${family} ${action}*`))
    }
  }
  for (const family of GH_NEVER_FAMILIES) out.push(bash(`gh ${family} *`))
  return out
}

function apiMethodDeny(methods: readonly string[]): string[] {
  return methods.flatMap((m) =>
    [m, m.toLowerCase()].flatMap((x) => [
      bash(`gh api *-X ${x}*`),
      bash(`gh api *-X${x}*`),
      bash(`gh api *--method ${x}*`),
      bash(`gh api *--method=${x}*`)
    ])
  )
}

function pushOptionDeny(): string[] {
  const out: string[] = []
  for (const [opt, rule] of Object.entries(PUSH_OPTIONS)) {
    if (rule.access === 'never') out.push(bash(`git push ${opt}*`), bash(`git push * ${opt}*`))
  }
  for (const [c, long] of Object.entries(PUSH_SHORT)) {
    if (PUSH_OPTIONS[long]?.access !== 'never') continue
    out.push(
      bash(`git push -${c} *`),
      bash(`git push -${c}`),
      bash(`git push * -${c} *`),
      bash(`git push * -${c}`)
    )
  }
  for (const r of PUSH_REFSPEC_NEVER) out.push(bash(`git push * ${r.prefix}*`))
  return out
}

export function cliDenyOutsideDelivery(): string[] {
  const fields = ['-f *', '-F *', '--field*', '--raw-field*']
  return [
    bash('git push'),
    bash('git push *'),
    ...ghDeny(new Set<GhAccess>(['write', 'never'])),
    ...apiMethodDeny([...GH_API_WRITE_METHODS, ...GH_API_NEVER_METHODS]),
    bash('gh api *--input*'),
    bash('gh api *mutation*'),
    ...['repos/*', '/repos/*'].flatMap((p) => fields.map((f) => bash(`gh api ${p} ${f}`)))
  ]
}

/** No modo entrega o CLI só nega o que nunca roda; o resto a política decide. */
export function cliDenyInDelivery(): string[] {
  return [
    ...pushOptionDeny(),
    ...ghDeny(new Set<GhAccess>(['never'])),
    ...apiMethodDeny(GH_API_NEVER_METHODS)
  ]
}

function actionsWith(access: GhAccess): string[] {
  return Object.entries(GH_COMMANDS).flatMap(([family, actions]) => {
    const names = Object.entries(actions as Record<string, GhRule>)
      .filter(([, r]) => r.access === access)
      .map(([a]) => a)
    return names.length > 0 ? [`gh ${family} ${names.join('/')}`] : []
  })
}

export const GH_READ_TEXT = [
  ...actionsWith('read'),
  'gh api com GET sem campos ou GraphQL sem mutation'
].join(', ')

export const GH_NEVER_TEXT = `${actionsWith('never').join(', ')}, ${GH_NEVER_FAMILIES.map((f) => `gh ${f}`).join(' e ')}`
