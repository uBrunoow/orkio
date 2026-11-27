/**
 * Política de permissões das execuções do Claude Code (Etapa 4A). Função pura, chamada pela
 * ferramenta de permissão (`--permission-prompt-tool`) para cada pedido do CLI.
 *
 * - Ler/editar DENTRO do worktree: permitido. Fora: bloqueado (ferramentas pelo catálogo
 *   `shared/claude-tools.ts`). Passo só de leitura: editar é bloqueado. Agente que pede antes de
 *   agir (`askEdits`, Fase 3): editar pergunta.
 * - `git push` (qualquer forma, ex. `git -C . push`, aliases) e o GitHub CLI (`github-rules.ts`):
 *   bloqueados, mesmo que o usuário tenha aprovado "sempre", menos a leitura da PR do projeto.
 *   Exceção (5C): passo com "modo entrega", com as regras de `delivery-policy.ts` (só a branch da
 *   tarefa, só o repositório do projeto, sem força/merge).
 * - Outros comandos de shell: perguntar ao usuário (uma vez / sempre neste projeto / negar).
 *   "Sempre" vale por prefixo de comando e só se TODOS os trechos (`&&`, `;`, `|`) casarem; num
 *   passo só de leitura nada passa sozinho.
 * - `AskUserQuestion`: vira pergunta na tela.
 */
import { isAbsolute, normalize, relative, resolve, sep } from 'node:path'
import type { PermissionBlockCode } from '../../shared/agent-run'
import { toolCategory, toolPath } from '../../shared/claude-tools'
import type { DeliveryTarget } from '../../shared/delivery'
import {
  deliveryVerdict,
  ghApiParse,
  gitParse,
  isGhRead,
  type DeliveryEvent,
  type DeliveryKind,
  type DeliveryPolicyContext
} from './delivery-policy'
import { GH_READ_TEXT, GH_RULED } from './github-rules'
import {
  BRIDGE_MEMORY_TOOL_NAME,
  BRIDGE_SERVER_READ_ACTIONS,
  serverActionOfTool
} from './bridge/protocol'

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

/**
 * Por que a política negou (vai no evento `permission` do log; a tela decide por ele, nunca pelo
 * texto): `push`/`gh` fora do modo entrega oferecem "Abrir PR".
 */
export type PolicyDenyCode = PermissionBlockCode

export type PolicyDecision =
  | { decision: 'allow'; reason?: string; delivery?: DeliveryAction[] }
  | { decision: 'deny'; reason: string; code: PolicyDenyCode }
  | { decision: 'ask'; suggestion: string; delivery?: DeliveryAction[] }
  | { decision: 'question' }

export const POLICY_MESSAGES = {
  outside: 'Bloqueado pelo Orkio: fora do ambiente desta tarefa (worktree).',
  push: 'Bloqueado pelo Orkio: git push só é permitido em um passo de fluxo com “modo entrega”. Para publicar, use “Abrir PR” na aba PR & CI da tarefa.',
  gh: `Bloqueado pelo Orkio: comandos do GitHub CLI que publicam (gh pr, gh api) só são permitidos em um passo de fluxo com “modo entrega”. Ler a PR do projeto pode (${GH_READ_TEXT}). Para publicar, use “Abrir PR” na aba PR & CI da tarefa.`,
  alias:
    'Bloqueado pelo Orkio: alias definido na própria linha de comando (git -c alias.…) ou aninhado demais.',
  readOnly: 'Bloqueado pelo Orkio: este passo é só de leitura (sem editar arquivos).',
  wait: 'Bloqueado pelo Orkio: não espere no shell (gh pr checks --watch, gh run watch, sleep longo, tail -f). Termine o passo: o Orkio acompanha a PR e acorda o fluxo quando o CI ou a revisão mudarem.'
} as const

/** Maior `sleep` aceito (segundos): pausas curtas (esperar um servidor subir) continuam valendo. */
export const MAX_SHELL_SLEEP_S = 30

function sleepSeconds(arg: string): number | null {
  const m = /^(\d+(?:\.\d+)?)([smhd]?)$/.exec(arg)
  if (!m) return arg === 'infinity' ? Infinity : null
  const mult = { '': 1, s: 1, m: 60, h: 3600, d: 86400 }[m[2] as '' | 's' | 'm' | 'h' | 'd']
  return Number(m[1]) * mult
}

/**
 * Fase 5: comandos que só esperam (acompanhar CI, seguir log, dormir muito). Num passo de fluxo
 * eles prendem a execução e gastam a janela do Claude; quem espera a PR é o Orkio.
 */
export function isShellWait(cmd: { name: string; args: readonly string[] }): boolean {
  const { name, args } = cmd
  if (name === 'gh') {
    if (args[0] === 'run' && args[1] === 'watch') return true
    if (args[0] === 'pr' && args[1] === 'checks')
      return args.some((a) => a === '--watch' || a.startsWith('--watch='))
    return false
  }
  if (name === 'tail') {
    return args.some(
      (a) => a === '--follow' || a.startsWith('--follow=') || /^-[a-zA-Z]*[fF]/.test(a)
    )
  }
  if (name === 'watch') return true
  if (name === 'sleep') {
    const total = args.reduce((sum, a) => sum + (sleepSeconds(a) ?? 0), 0)
    return total > MAX_SHELL_SLEEP_S
  }
  return false
}

const deny = (code: PolicyDenyCode, reason: string): PolicyDecision => ({
  decision: 'deny',
  reason,
  code
})

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
export interface DeliveryContext extends DeliveryPolicyContext {
  /** Pedir aprovação a cada push (ajuste do projeto). */
  requirePushApproval: boolean
  /** Categorias já aprovadas nesta execução. */
  granted: ReadonlySet<DeliveryKind>
}

export interface PolicyContext {
  worktree: string
  allowRules: readonly AllowRule[]
  aliases?: PolicyAliases
  delivery?: DeliveryContext | null
  /**
   * Repositório do projeto (e branch da tarefa) fora do modo entrega: com ele, a leitura do GitHub
   * (`isGhRead`) passa sem perguntar. Sem repositório verificado, o GitHub CLI segue bloqueado.
   */
  repo?: DeliveryTarget | null
  /**
   * Passo só de leitura: editar arquivo é bloqueado e nenhum comando passa sozinho (nem regra
   * "sempre neste projeto", nem leitura do GitHub): todo comando pede sua aprovação, MENOS a
   * leitura do git dentro da pasta (`isGitRead`: diff, log, show, status... sem opção que grave ou
   * rode programa), que passa sem perguntar (Fase 3: o revisor não pede a cada `git diff`).
   */
  readOnly?: boolean
  /**
   * Fase 3: agente que pede antes de toda ação. Editar no worktree vira pergunta (sem "sempre"), e
   * as regras "sempre neste projeto" não valem para os comandos dele (ler continua livre).
   */
  askEdits?: boolean
  /**
   * Portas dos servidores da tarefa de pé agora: o Playwright no localhost delas passa sem
   * perguntar (`isTaskBrowserUse`). Vazio/ausente = pergunta como qualquer MCP.
   */
  serverPorts?: readonly number[]
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

/**
 * Bloqueio fora do modo entrega (4A): push e todo comando do GitHub CLI da tabela
 * (`github-rules.ts`) que não seja leitura no repositório do projeto.
 */
function blockedOutsideDelivery(cmd: Cmd, repo: DeliveryTarget | null): PolicyDecision | null {
  if (cmd.name === 'git' && gitParse(cmd.args).sub === 'push') {
    return deny('push', POLICY_MESSAGES.push)
  }
  if (cmd.name === 'gh' && GH_RULED.has(cmd.args[0] ?? '')) {
    if (repo && isGhRead(cmd.args, repo)) return null
    return deny('gh', POLICY_MESSAGES.gh)
  }
  return null
}

export const GH_READ_ALLOWED = 'leitura do GitHub no repositório do projeto'

export const GIT_READ_ALLOWED = 'leitura do git (passo só de leitura)'

/** Subcomandos do git que só leem (sem `grep`: `-O` abre programa; sem `branch`: cria/apaga). */
const GIT_READ_SUBS = new Set([
  'diff',
  'log',
  'show',
  'status',
  'blame',
  'ls-files',
  'rev-parse',
  'merge-base',
  'shortlog'
])
/** Opções que gravam arquivo ou rodam programa externo (`--output`, diff externo, pager...). */
const GIT_WRITE_OPTIONS =
  /^(?:--output(?:=|$)|--output-directory|--ext-diff$|--open-files-in-pager|-O|--exec|--upload-pack|--receiver-pack)/

/**
 * Comando do git que só lê: subcomando da lista, sem opção global (só `--no-pager`/`-P`; nada de
 * `-c`, `-C`, `--git-dir`...) e sem opção que grave ou rode programa. Aliases já vêm expandidos
 * (`resolveCommands`); um alias com nome de subcomando de verdade é ignorado pelo git.
 */
export function isGitRead(cmd: { name: string; args: readonly string[] }): boolean {
  if (cmd.name !== 'git') return false
  const { globals, sub, rest } = gitParse(cmd.args)
  if (!sub || !GIT_READ_SUBS.has(sub)) return false
  if (globals.some((g) => g !== '--no-pager' && g !== '-P')) return false
  return !rest.some((a) => GIT_WRITE_OPTIONS.test(a))
}

/** Caminhos absolutos/relativos que saem do worktree (heurística sobre as palavras). */
/** Quem recebe um heredoc como dado (não executa o texto): a mensagem do `git commit -F -`, `cat`. */
const HEREDOC_DATA_RECEIVERS = new Set(['git', 'cat'])

/**
 * O comando sem o corpo dos heredocs que são só dado (`git commit -F - <<'EOF' … EOF`), para a
 * checagem de caminhos: `/api/home` numa mensagem de commit não é arquivo fora do worktree. Corpo
 * que vai para um shell (`bash <<EOF`) ou outro programa continua conferido linha a linha.
 */
function withoutDataHeredocs(command: string): string {
  return withoutHeredocBodies(command, (receiver) => HEREDOC_DATA_RECEIVERS.has(receiver))
}

/**
 * O comando sem o corpo dos heredocs aceitos por `skip` (todos, por padrão). Para casar com as
 * regras "sempre", o corpo é a entrada do programa (`python3 - <<'EOF'`), não outros comandos: a
 * regra vale pelo programa que o recebe.
 */
function withoutHeredocBodies(
  command: string,
  skip: (receiver: string) => boolean = () => true
): string {
  const lines = command.split('\n')
  const kept: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    kept.push(line)
    const start = /(?<!<)<<(?!<)-?\s*(['"]?)([A-Za-z_][\w-]*)\1/.exec(line)
    if (!start) continue
    const before = shellSegments(line.slice(0, start.index)).at(-1) ?? ''
    const receiver = program(shellWords(before))?.name
    const delimiter = start[2]!
    let end = i + 1
    while (end < lines.length && lines[end]!.trim() !== delimiter) end++
    if (!receiver || !skip(receiver)) continue
    i = end // pula o corpo e a linha do delimitador
  }
  return kept.join('\n')
}

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

/**
 * `cd`/`pushd` para uma pasta escrita por extenso (sem variável, sem `-`): só muda a pasta. Depois
 * da checagem do worktree (que recusa caminho de fora), o trecho não precisa de regra "sempre":
 * senão `cd <pasta> && pnpm test` pediria uma regra `cd` que nunca libera o `pnpm test`.
 * `cd` sozinho (vai para o HOME) e `cd -` continuam pedindo.
 */
function isPlainCd(segment: string): boolean {
  const p = program(shellWords(segment))
  if (!p || (p.name !== 'cd' && p.name !== 'pushd')) return false
  const [dir, ...rest] = p.args
  return rest.length === 0 && dir !== undefined && !/^[-~]|[$`]/.test(dir)
}

/** Trechos que casam com as regras "sempre": sem corpo de heredoc e sem `cd` para dentro. */
function ruleSegments(command: string): string[] {
  return shellSegments(withoutHeredocBodies(command)).filter((s) => !isPlainCd(s))
}

/** Prefixo sugerido para "sempre neste projeto": programa + subcomando (ex.: "npm test"). */
export function suggestPattern(command: string): string {
  // Trecho só de atribuição (`B=/caminho;`) não roda nada: a sugestão é o primeiro programa.
  // `cd` para uma pasta também não: a regra útil é a do comando que vem depois.
  const segments = ruleSegments(command)
  const first = segments.find((s) => program(shellWords(s))) ?? segments[0] ?? command
  const p = program(shellWords(first))
  if (!p) return first.trim()
  // Subcomando é palavra (`test`, `lint`); variável (`$B`) e caminho não entram no padrão.
  const sub = p.args.find((a) => !a.startsWith('-'))
  return sub && /^[A-Za-z][\w:.-]*$/.test(sub) ? `${p.name} ${sub}` : p.name
}

function matchesRule(segment: string, pattern: string): boolean {
  const p = program(shellWords(segment))
  // Só atribuição (`B=…`): não roda programa; o caminho já passou pela checagem do worktree.
  if (!p) return shellWords(segment).length > 0
  const normalized = [p.name, ...p.args].join(' ')
  return normalized === pattern || normalized.startsWith(`${pattern} `)
}

function matchesCmd(cmd: Cmd, pattern: string): boolean {
  const normalized = [cmd.name, ...cmd.args].join(' ')
  return normalized === pattern || normalized.startsWith(`${pattern} `)
}

export const DELIVERY_ALLOWED = 'Liberado pelo modo entrega'

/**
 * Decide um pedido. O contexto que custa ler (a branch atual, para um `git push` do modo entrega)
 * a política pede só quando precisa: `currentBranch` é chamado depois de resolver os aliases.
 */
export async function decidePermission(
  req: PermissionRequest,
  ctx: PolicyContext,
  lazy: { currentBranch(): Promise<string | null> }
): Promise<PolicyDecision> {
  const first = evaluate(req, ctx)
  if (first !== NEEDS_BRANCH || !ctx.delivery) return first as PolicyDecision
  const currentBranch = await lazy.currentBranch().catch(() => null)
  return evaluatePermission(req, { ...ctx, delivery: { ...ctx.delivery, currentBranch } })
}

/** Versão síncrona: a branch atual vem no contexto (sem ela, `git push` sem branch é negado). */
export function evaluatePermission(req: PermissionRequest, ctx: PolicyContext): PolicyDecision {
  const d = evaluate(req, ctx)
  if (d !== NEEDS_BRANCH) return d
  return evaluate(req, {
    ...ctx,
    delivery: { ...ctx.delivery!, currentBranch: null }
  }) as PolicyDecision
}

const NEEDS_BRANCH = Symbol('currentBranch')

function evaluate(
  req: PermissionRequest,
  ctx: PolicyContext
): PolicyDecision | typeof NEEDS_BRANCH {
  const { tool, input } = req
  const category = toolCategory(tool)
  if (category === 'question') return { decision: 'question' }
  if (category === 'subagent' || category === 'plan') return { decision: 'allow' }
  // Memória do agente (Fase 3): `mcp__orkio__lembrar` é do próprio Orkio, não toca no projeto nem
  // na rede (o main valida, redige segredos e grava na pasta do agente). Passa sem perguntar, até
  // em passo só de leitura. Só ela: qualquer outra MCP continua perguntando (fim da função).
  if (tool === BRIDGE_MEMORY_TOOL_NAME) return { decision: 'allow' }
  // Servidores da tarefa: as ferramentas do Orkio só sobem/param os servidores que você cadastrou
  // (o comando nunca vem do agente). Passo só de leitura: só status e log.
  const serverAction = serverActionOfTool(tool)
  if (serverAction) {
    if (ctx.readOnly && !BRIDGE_SERVER_READ_ACTIONS.includes(serverAction)) {
      return deny('read_only', POLICY_MESSAGES.readOnly)
    }
    return { decision: 'allow' }
  }

  if (category === 'edit' || category === 'read' || category === 'search') {
    if (category === 'edit' && ctx.readOnly) return deny('read_only', POLICY_MESSAGES.readOnly)
    const path = toolPath(tool, input)
    if (path && !isInside(path, ctx.worktree)) return deny('outside', POLICY_MESSAGES.outside)
    // "Sempre neste projeto" nunca vale para editar (sugestão vazia).
    if (category === 'edit' && ctx.askEdits) return { decision: 'ask', suggestion: '' }
    return { decision: 'allow' }
  }

  if (category === 'command') {
    const command = typeof input['command'] === 'string' ? input['command'] : ''
    const segments = shellSegments(command)
    const commands: Cmd[] = []
    for (const s of segments) {
      const resolved = resolveCommands(s, ctx.aliases)
      if (typeof resolved === 'string') return deny('alias', resolved)
      commands.push(...resolved)
    }
    // Fase 5: esperar no shell nunca passa (nem com "sempre", nem no modo entrega).
    if (commands.some(isShellWait)) return deny('wait', POLICY_MESSAGES.wait)
    const delivery: DeliveryAction[] = []
    const others: Cmd[] = []
    for (const cmd of commands) {
      if (!ctx.delivery) {
        const blocked = blockedOutsideDelivery(cmd, ctx.repo ?? null)
        if (blocked) return blocked
        others.push(cmd)
        continue
      }
      const siblings = commands.filter((c) => c !== cmd)
      const v = deliveryVerdict(cmd.name, cmd.args, ctx.delivery, siblings)
      if (v === null) others.push(cmd)
      else if (!v.ok) {
        if ('needs' in v) return NEEDS_BRANCH
        return deny('delivery', v.reason)
      } else delivery.push({ kind: v.kind, event: v.event })
    }
    if (shellSegments(withoutDataHeredocs(command)).some((s) => escapesWorktree(s, ctx.worktree))) {
      return deny('outside', POLICY_MESSAGES.outside)
    }
    const rules =
      ctx.readOnly || ctx.askEdits ? [] : ctx.allowRules.filter((r) => r.tool === 'Bash')
    const repo = ctx.repo ?? null
    if (
      !ctx.delivery &&
      !ctx.readOnly &&
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
    const ruled = ruleSegments(command)
    if (ruled.length > 0 && ruled.every((s) => rules.some((r) => matchesRule(s, r.pattern)))) {
      return { decision: 'allow', reason: 'aprovado sempre neste projeto' }
    }
    // Fase 3: num passo só de leitura (ex.: o revisor), ler o git dentro da pasta não pergunta.
    if (
      ctx.readOnly &&
      !ctx.delivery &&
      commands.length > 0 &&
      !/[<>`]|\$\(/.test(command) &&
      commands.every(isGitRead)
    ) {
      return { decision: 'allow', reason: GIT_READ_ALLOWED }
    }
    return { decision: 'ask', suggestion: suggestPattern(command) }
  }

  // Testar no navegador: Playwright no localhost dos servidores de pé desta tarefa.
  if (isTaskBrowserUse(tool, input, ctx)) return { decision: 'allow', reason: BROWSER_ALLOWED }

  // WebFetch, WebSearch, MCP (menos `mcp__orkio__lembrar`, acima) e ferramentas desconhecidas: perguntar.
  return { decision: 'ask', suggestion: tool }
}

/** Linha do log quando o Playwright passa sem perguntar. */
export const BROWSER_ALLOWED = 'Liberado: navegador no servidor desta tarefa'

/** Playwright do catálogo (`playwright…`) ou do plugin do seu Claude (`plugin_playwright_…`). */
const PLAYWRIGHT_TOOL = /^mcp__[a-z0-9_-]*playwright[a-z0-9_-]*__browser_([a-z_]+)$/
/**
 * Ações do navegador sem endereço (agem na página aberta) ou só de leitura dela. Fora daqui (rodar
 * código, enviar arquivo, instalar, salvar PDF…) continua perguntando.
 */
const BROWSER_PAGE_ACTIONS = new Set([
  'navigate_back',
  'snapshot',
  'take_screenshot',
  'click',
  'type',
  'fill_form',
  'press_key',
  'hover',
  'select_option',
  'drag',
  'wait_for',
  'resize',
  'console_messages',
  'network_requests',
  'handle_dialog',
  'close',
  'tabs'
])

/** `http(s)://localhost|127.0.0.1|[::1]:<porta de servidor de pé desta tarefa>`. */
export function isTaskServerUrl(value: unknown, ports: readonly number[]): boolean {
  if (typeof value !== 'string') return false
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return false
  if (url.username || url.password) return false
  return ports.includes(Number(url.port))
}

/**
 * Servidores da tarefa de pé (`serverPorts`): navegar para um deles ou agir na página aberta passa
 * sem perguntar. Passo só de leitura continua perguntando (nada passa sozinho nele).
 */
function isTaskBrowserUse(
  tool: string,
  input: Record<string, unknown>,
  ctx: PolicyContext
): boolean {
  const ports = ctx.serverPorts ?? []
  if (ctx.readOnly || ports.length === 0) return false
  const action = PLAYWRIGHT_TOOL.exec(tool)?.[1]
  if (!action) return false
  if (action === 'navigate') return isTaskServerUrl(input['url'], ports)
  if (!BROWSER_PAGE_ACTIONS.has(action)) return false
  // Aba nova com endereço: só se for o servidor da tarefa.
  return input['url'] === undefined || isTaskServerUrl(input['url'], ports)
}
