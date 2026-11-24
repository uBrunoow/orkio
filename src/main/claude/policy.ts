/**
 * Política de permissões das execuções do Claude Code (Etapa 4A). Função pura, chamada pela
 * ferramenta de permissão (`--permission-prompt-tool`) para cada pedido do CLI.
 *
 * - Ler/editar DENTRO do worktree: permitido. Fora: bloqueado.
 * - `git push` (qualquer forma, ex. `git -C . push`, aliases), `gh pr`, `gh api`: bloqueados, mesmo
 *   que o usuário tenha aprovado "sempre". Exceção (5C): passo com "modo entrega", com as regras de
 *   `delivery-policy.ts` (só a branch da tarefa, só o repositório do projeto, sem força/merge).
 * - Outros comandos de shell: perguntar ao usuário (uma vez / sempre neste projeto / negar).
 *   "Sempre" vale por prefixo de comando e só se TODOS os trechos (`&&`, `;`, `|`) casarem.
 * - `AskUserQuestion`: vira pergunta na tela.
 */
import { isAbsolute, normalize, relative, resolve, sep } from 'node:path'
import { isEditTool } from '../../shared/agent-run'
import type { DeliveryTarget } from '../../shared/delivery'
import {
  deliveryVerdict,
  ghApiParse,
  gitParse,
  isGhRead,
  type DeliveryEvent,
  type DeliveryKind
} from './delivery-policy'

export interface PermissionRequest {
  tool: string
  input: Record<string, unknown>
}

export interface AllowRule {
  tool: string
  pattern: string
}

/** Ação de entrega liberada (para o log e o histórico da tarefa). */
export interface DeliveryAction {
  kind: DeliveryKind
  event: DeliveryEvent | null
}
export type { DeliveryEvent, DeliveryKind }

export type PolicyDecision =
  | { decision: 'allow'; reason?: string; delivery?: DeliveryAction[] }
  | { decision: 'deny'; reason: string }
  | { decision: 'ask'; suggestion: string; delivery?: DeliveryAction[] }
  | { decision: 'question' }

const FILE_READ = new Set(['Read', 'Grep', 'Glob', 'LS'])
/** Ferramentas sem efeito fora da sessão (planejamento, subagentes, skills, tarefas). */
const HARMLESS = new Set([
  'TodoWrite',
  'Task',
  'Agent',
  'Skill',
  'TaskCreate',
  'TaskUpdate',
  'TaskList',
  'ExitPlanMode'
])

export const POLICY_MESSAGES = {
  outside: 'Bloqueado pelo Orkio: fora do ambiente desta tarefa (worktree).',
  push: 'Bloqueado pelo Orkio: git push só é permitido em um passo de fluxo com “modo entrega”. Para publicar, use “Abrir PR” na aba PR & CI da tarefa.',
  gh: 'Bloqueado pelo Orkio: comandos do GitHub CLI que publicam (gh pr, gh api) só são permitidos em um passo de fluxo com “modo entrega”. Ler a PR do projeto pode (gh pr view/diff/checks, gh api com GET ou GraphQL sem mutation). Para publicar, use “Abrir PR” na aba PR & CI da tarefa.',
  alias:
    'Bloqueado pelo Orkio: alias definido na própria linha de comando (git -c alias.…) ou aninhado demais.'
} as const

export function isInside(path: string, worktree: string): boolean {
  const target = normalize(isAbsolute(path) ? path : resolve(worktree, path))
  const rel = relative(normalize(worktree), target)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel) && !rel.startsWith(`..${sep}`))
}

/**
 * Trechos de um comando de shell: separa em `;`, `&&`, `||`, `|`, `&`, quebra de linha, subshell
 * `( … )`, `$( … )` e crases — fora de aspas simples. Dentro de aspas duplas só `$( … )` e crases
 * separam (o shell executa as duas ali também).
 */
export function shellSegments(command: string): string[] {
  const out: string[] = []
  let cur = ''
  let quote: '"' | "'" | null = null
  let subst = 0 // `$(` abertos dentro de aspas duplas
  const flush = (): void => {
    const t = cur.trim()
    if (t) out.push(t)
    cur = ''
  }
  for (let i = 0; i < command.length; i++) {
    const c = command[i]!
    const next = command[i + 1]
    if (quote === "'") {
      cur += c
      if (c === "'") quote = null
      continue
    }
    if (c === '\\' && next !== undefined) {
      cur += c + next
      i++
      continue
    }
    if (quote === '"') {
      if (c === '$' && next === '(') {
        subst++
        i++
        flush()
      } else if (c === ')' && subst > 0) {
        subst--
        flush()
      } else if (c === '`') flush()
      else {
        cur += c
        if (c === '"') quote = null
      }
      continue
    }
    if (c === "'" || c === '"') {
      quote = c
      cur += c
    } else if (c === '$' && next === '(') {
      i++
      flush()
    } else if (
      c === '(' ||
      c === ')' ||
      c === '`' ||
      c === ';' ||
      c === '\n' ||
      c === '|' ||
      c === '&'
    ) {
      if ((c === '|' || c === '&') && next === c) i++
      flush()
    } else cur += c
  }
  flush()
  return out
}

/** Palavras de um trecho, como o shell (aspas simples/duplas juntam partes; sem expandir variáveis). */
export function shellWords(segment: string): string[] {
  const words: string[] = []
  let cur = ''
  let has = false
  let quote: '"' | "'" | null = null
  for (let i = 0; i < segment.length; i++) {
    const c = segment[i]!
    if (quote) {
      if (c === quote) quote = null
      else if (c === '\\' && quote === '"' && i + 1 < segment.length) cur += segment[++i]
      else cur += c
      continue
    }
    if (c === "'" || c === '"') {
      quote = c
      has = true
    } else if (c === '\\' && i + 1 < segment.length) {
      cur += segment[++i]
      has = true
    } else if (/\s/.test(c)) {
      if (has) words.push(cur)
      cur = ''
      has = false
    } else {
      cur += c
      has = true
    }
  }
  if (has) words.push(cur)
  return words
}

/** Pula atribuições de ambiente e wrappers comuns (`env`, `sudo`, `command`, `time`, `nohup`). */
function program(words: string[]): { name: string; args: string[] } | null {
  const wrappers = ['env', 'sudo', 'command', 'time', 'nohup', 'exec']
  let i = 0
  // Atribuições e wrappers podem se alternar: `env FOO=1 sudo -E BAR=2 git push`.
  while (
    i < words.length &&
    (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i]!) ||
      wrappers.includes(words[i]!) ||
      (i > 0 && wrappers.includes(words[i - 1]!) && words[i]!.startsWith('-')))
  ) {
    i++
  }
  const name = words[i]
  if (!name) return null
  return { name: name.split('/').pop() ?? name, args: words.slice(i + 1) }
}

/** Aliases lidos no começo da execução (`git config --get-regexp ^alias\.`, `gh alias list`). */
export interface PolicyAliases {
  git?: Readonly<Record<string, string>>
  gh?: Readonly<Record<string, string>>
}

/** Contexto do modo entrega (5C): só existe na execução de um passo marcado. */
export interface DeliveryContext {
  target: DeliveryTarget
  /** Pedir aprovação a cada push (ajuste do projeto). */
  requirePushApproval: boolean
  /** Categorias já aprovadas nesta execução. */
  granted: ReadonlySet<DeliveryKind>
  /** `git config push.default` no worktree (`matching` torna `git push` sem refspec perigoso). */
  pushDefault: string | null
  /** Branch atual do worktree, lida logo antes de avaliar. */
  currentBranch?: string | null
}

export interface PolicyContext {
  worktree: string
  allowRules: readonly AllowRule[]
  aliases?: PolicyAliases
  delivery?: DeliveryContext | null
  /**
   * Repositório do projeto (e branch da tarefa) fora do modo entrega: com ele, a leitura do GitHub
   * (`isGhRead`) passa sem perguntar. Sem repositório verificado, `gh pr`/`gh api` seguem
   * bloqueados.
   */
  repo?: DeliveryTarget | null
}

/** Comando simples já resolvido (aliases expandidos). */
interface Cmd {
  name: string
  args: string[]
}

/** Subcomandos de verdade do git: um alias com o mesmo nome é ignorado pelo próprio git. */
const GIT_BUILTINS = new Set(
  'add am apply bisect blame branch bundle checkout cherry-pick clean clone commit config describe diff fetch format-patch gc grep init log ls-files ls-remote merge mv notes pull push rebase reflog remote reset restore revert rm show sparse-checkout stash status submodule switch tag worktree rev-parse rev-list for-each-ref symbolic-ref update-ref cat-file show-ref send-pack var help version'.split(
    ' '
  )
)
const GH_BUILTINS = new Set(
  'alias api attestation auth browse cache codespace completion config extension gist gpg-key help issue label org pr project release repo ruleset run search secret ssh-key status variable workflow cs'.split(
    ' '
  )
)

function quote(word: string): string {
  return /^[A-Za-z0-9_./:=@+%,^~-]+$/.test(word) ? word : `'${word.replace(/'/g, '')}'`
}

/**
 * Resolve aliases do git e do gh. Alias de shell (`!…`) vira comando de shell avaliado trecho a
 * trecho. `git -c alias.x=…` é recusado: não dá para conferir.
 */
function resolveCommands(
  segment: string,
  aliases: PolicyAliases | undefined,
  depth = 0
): Cmd[] | string {
  if (depth > 4) return POLICY_MESSAGES.alias
  const p = program(shellWords(segment))
  if (!p) return []
  if (p.name === 'git') {
    const { globals, sub, rest } = gitParse(p.args)
    for (let i = 0; i < globals.length; i++) {
      const g = globals[i]!
      const value = g === '-c' ? (globals[i + 1] ?? '') : g.startsWith('-c') ? g.slice(2) : ''
      if (/^alias\./i.test(value) || g === '--config-env') return POLICY_MESSAGES.alias
    }
    const expansion = sub && !GIT_BUILTINS.has(sub) ? aliases?.git?.[sub] : undefined
    if (sub && expansion !== undefined) {
      if (expansion.startsWith('!')) {
        return expandShell(`${expansion.slice(1)} ${rest.map(quote).join(' ')}`, aliases, depth)
      }
      return resolveCommands(
        ['git', ...globals, ...shellWords(expansion), ...rest].map(quote).join(' '),
        aliases,
        depth + 1
      )
    }
  }
  if (p.name === 'gh') {
    const sub = p.args[0]
    const expansion = sub && !GH_BUILTINS.has(sub) ? aliases?.gh?.[sub] : undefined
    if (sub && expansion !== undefined) {
      const rest = p.args.slice(1)
      if (expansion.startsWith('!')) {
        return expandShell(`${expansion.slice(1)} ${rest.map(quote).join(' ')}`, aliases, depth)
      }
      // `$1`, `$2`… dos aliases do gh viram os argumentos; o que sobrar vai no fim.
      const used = new Set<number>()
      const filled = shellWords(expansion).map((w) =>
        w.replace(/\$(\d+)/g, (_, n: string) => {
          used.add(Number(n))
          return rest[Number(n) - 1] ?? ''
        })
      )
      const extra = rest.filter((_, i) => !used.has(i + 1))
      return resolveCommands(['gh', ...filled, ...extra].map(quote).join(' '), aliases, depth + 1)
    }
  }
  return [{ name: p.name, args: p.args }]
}

function expandShell(
  text: string,
  aliases: PolicyAliases | undefined,
  depth: number
): Cmd[] | string {
  const out: Cmd[] = []
  for (const seg of shellSegments(text)) {
    const r = resolveCommands(seg, aliases, depth + 1)
    if (typeof r === 'string') return r
    out.push(...r)
  }
  return out
}

/** Bloqueio fora do modo entrega (4A): push e comandos do gh que publicam (ler pode). */
function blockedOutsideDelivery(cmd: Cmd, repo: DeliveryTarget | null): string | null {
  if (cmd.name === 'git' && gitParse(cmd.args).sub === 'push') return POLICY_MESSAGES.push
  if (cmd.name === 'gh' && ['pr', 'api', 'release'].includes(cmd.args[0] ?? '')) {
    if (repo && isGhRead(cmd.args, repo)) return null
    return POLICY_MESSAGES.gh
  }
  return null
}

/** Leitura do GitHub no repositório do projeto (passa sem perguntar). */
export const GH_READ_ALLOWED = 'leitura do GitHub no repositório do projeto'

/** Caminhos absolutos/relativos que saem do worktree (heurística sobre as palavras). */
function escapesWorktree(segment: string, worktree: string): boolean {
  const words = shellWords(segment)
  const p = program(words)
  // O endpoint do `gh api` (`/repos/o/r/…`) não é caminho de arquivo.
  const endpoint =
    p?.name === 'gh' && p.args[0] === 'api' ? ghApiParse(p.args.slice(1)).endpoint : null
  for (const w of words) {
    if (endpoint !== null && w === endpoint) continue
    const value = w.includes('=') && !w.startsWith('/') ? w.slice(w.indexOf('=') + 1) : w
    if (/^\/dev\/(null|stdout|stderr)$/.test(value)) continue
    if (value.startsWith('~')) return true
    if (value.startsWith('/') && !isInside(value, worktree)) return true
    if (/(^|\/)\.\.(\/|$)/.test(value) && !isInside(value, worktree)) return true
  }
  return false
}

/** Prefixo sugerido para "sempre neste projeto": programa + subcomando (ex.: "npm test"). */
export function suggestPattern(command: string): string {
  const first = shellSegments(command)[0] ?? command
  const p = program(shellWords(first))
  if (!p) return first.trim()
  const sub = p.args.find((a) => !a.startsWith('-'))
  return sub ? `${p.name} ${sub}` : p.name
}

function matchesRule(segment: string, pattern: string): boolean {
  const p = program(shellWords(segment))
  if (!p) return false
  const normalized = [p.name, ...p.args].join(' ')
  return normalized === pattern || normalized.startsWith(`${pattern} `)
}

function matchesCmd(cmd: Cmd, pattern: string): boolean {
  const normalized = [cmd.name, ...cmd.args].join(' ')
  return normalized === pattern || normalized.startsWith(`${pattern} `)
}

export const DELIVERY_ALLOWED = 'Liberado pelo modo entrega'

export function evaluatePermission(req: PermissionRequest, ctx: PolicyContext): PolicyDecision {
  const { tool, input } = req
  if (tool === 'AskUserQuestion') return { decision: 'question' }
  if (HARMLESS.has(tool)) return { decision: 'allow' }

  const path =
    (typeof input['file_path'] === 'string' && input['file_path']) ||
    (typeof input['notebook_path'] === 'string' && input['notebook_path']) ||
    (typeof input['path'] === 'string' && input['path']) ||
    null
  if (isEditTool(tool) || FILE_READ.has(tool)) {
    if (path && !isInside(path, ctx.worktree))
      return { decision: 'deny', reason: POLICY_MESSAGES.outside }
    return { decision: 'allow' }
  }

  if (tool === 'Bash') {
    const command = typeof input['command'] === 'string' ? input['command'] : ''
    const segments = shellSegments(command)
    const commands: Cmd[] = []
    for (const s of segments) {
      const resolved = resolveCommands(s, ctx.aliases)
      if (typeof resolved === 'string') return { decision: 'deny', reason: resolved }
      commands.push(...resolved)
    }
    // Bloqueios primeiro (push/gh fora do modo entrega; regras do modo entrega).
    const delivery: DeliveryAction[] = []
    const others: Cmd[] = []
    for (const cmd of commands) {
      if (!ctx.delivery) {
        const blocked = blockedOutsideDelivery(cmd, ctx.repo ?? null)
        if (blocked) return { decision: 'deny', reason: blocked }
        others.push(cmd)
        continue
      }
      const siblings = commands.filter((c) => c !== cmd)
      const v = deliveryVerdict(cmd.name, cmd.args, ctx.delivery, ctx.worktree, siblings)
      if (v === null) others.push(cmd)
      else if (!v.ok) return { decision: 'deny', reason: v.reason }
      else delivery.push({ kind: v.kind, event: v.event })
    }
    if (segments.some((s) => escapesWorktree(s, ctx.worktree))) {
      return { decision: 'deny', reason: POLICY_MESSAGES.outside }
    }
    const rules = ctx.allowRules.filter((r) => r.tool === 'Bash')
    // Só leitura do GitHub (ex.: `gh pr view 14 --json comments; gh api repos/o/r/pulls/14/comments`).
    const repo = ctx.repo ?? null
    if (
      !ctx.delivery &&
      repo &&
      commands.length > 0 &&
      commands.every((c) => c.name === 'gh' && isGhRead(c.args, repo))
    ) {
      return { decision: 'allow', reason: GH_READ_ALLOWED }
    }
    if (delivery.length > 0) {
      const d = ctx.delivery!
      const needsAsk = delivery.some(
        (a) => !d.granted.has(a.kind) || (a.kind === 'push' && d.requirePushApproval)
      )
      const othersOk = others.every((c) => rules.some((r) => matchesCmd(c, r.pattern)))
      if (!needsAsk && othersOk) return { decision: 'allow', reason: DELIVERY_ALLOWED, delivery }
      // "Sempre neste projeto" nunca vale para comandos de entrega (sugestão vazia).
      return { decision: 'ask', suggestion: '', delivery }
    }
    if (
      segments.length > 0 &&
      segments.every((s) => rules.some((r) => matchesRule(s, r.pattern)))
    ) {
      return { decision: 'allow', reason: 'aprovado sempre neste projeto' }
    }
    return { decision: 'ask', suggestion: suggestPattern(command) }
  }

  // WebFetch, WebSearch, MCP e ferramentas desconhecidas: perguntar.
  return { decision: 'ask', suggestion: tool }
}
