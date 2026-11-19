/**
 * Política de permissões das execuções do Claude Code (Etapa 4A). Função pura, chamada pela
 * ferramenta de permissão (`--permission-prompt-tool`) para cada pedido do CLI.
 *
 * - Ler/editar DENTRO do worktree: permitido. Fora: bloqueado.
 * - `git push` (qualquer forma, ex. `git -C . push`), `gh pr`, `gh api`: sempre bloqueados nesta
 *   etapa, mesmo que o usuário tenha aprovado "sempre".
 * - Outros comandos de shell: perguntar ao usuário (uma vez / sempre neste projeto / negar).
 *   "Sempre" vale por prefixo de comando e só se TODOS os trechos (`&&`, `;`, `|`) casarem.
 * - `AskUserQuestion`: vira pergunta na tela.
 */
import { isAbsolute, normalize, relative, resolve, sep } from 'node:path'

export interface PermissionRequest {
  tool: string
  input: Record<string, unknown>
}

export interface AllowRule {
  tool: string
  pattern: string
}

export type PolicyDecision =
  | { decision: 'allow'; reason?: string }
  | { decision: 'deny'; reason: string }
  | { decision: 'ask'; suggestion: string }
  | { decision: 'question' }

const FILE_WRITE = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit'])
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
  push: 'Bloqueado pelo Orkio: git push não é permitido nesta etapa.',
  gh: 'Bloqueado pelo Orkio: comandos do GitHub CLI que publicam (gh pr, gh api) não são permitidos nesta etapa.'
} as const

export function isInside(path: string, worktree: string): boolean {
  const target = normalize(isAbsolute(path) ? path : resolve(worktree, path))
  const rel = relative(normalize(worktree), target)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel) && !rel.startsWith(`..${sep}`))
}

/** Trechos de um comando de shell (separados por ;, &&, ||, |, quebra de linha, $(…), `…`). */
export function shellSegments(command: string): string[] {
  return command
    .replace(/\$\(|`|\)/g, '\n')
    .split(/&&|\|\||[;|\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** Palavras de um trecho, respeitando aspas simples/duplas (sem expandir variáveis). */
export function shellWords(segment: string): string[] {
  const words: string[] = []
  const re = /"((?:\\.|[^"\\])*)"|'([^']*)'|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(segment))) words.push(m[1] ?? m[2] ?? m[3] ?? '')
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

/** Subcomando do git, pulando opções globais (`-C dir`, `-c k=v`, `--git-dir=…`, …). */
function gitSubcommand(args: string[]): string | null {
  const withValue = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path'])
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!
    if (withValue.has(a)) {
      i++
      continue
    }
    if (a.startsWith('-')) continue
    return a
  }
  return null
}

function blockedCommand(segment: string): string | null {
  const p = program(shellWords(segment))
  if (!p) return null
  if (p.name === 'git' && gitSubcommand(p.args) === 'push') return POLICY_MESSAGES.push
  if (p.name === 'gh' && ['pr', 'api', 'release'].includes(p.args[0] ?? ''))
    return POLICY_MESSAGES.gh
  return null
}

/** Caminhos absolutos/relativos que saem do worktree (heurística sobre as palavras). */
function escapesWorktree(segment: string, worktree: string): boolean {
  for (const w of shellWords(segment)) {
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

export function evaluatePermission(
  req: PermissionRequest,
  ctx: { worktree: string; allowRules: readonly AllowRule[] }
): PolicyDecision {
  const { tool, input } = req
  if (tool === 'AskUserQuestion') return { decision: 'question' }
  if (HARMLESS.has(tool)) return { decision: 'allow' }

  const path =
    (typeof input['file_path'] === 'string' && input['file_path']) ||
    (typeof input['notebook_path'] === 'string' && input['notebook_path']) ||
    (typeof input['path'] === 'string' && input['path']) ||
    null
  if (FILE_WRITE.has(tool) || FILE_READ.has(tool)) {
    if (path && !isInside(path, ctx.worktree))
      return { decision: 'deny', reason: POLICY_MESSAGES.outside }
    return { decision: 'allow' }
  }

  if (tool === 'Bash') {
    const command = typeof input['command'] === 'string' ? input['command'] : ''
    const segments = shellSegments(command)
    for (const s of segments) {
      const blocked = blockedCommand(s)
      if (blocked) return { decision: 'deny', reason: blocked }
    }
    if (segments.some((s) => escapesWorktree(s, ctx.worktree))) {
      return { decision: 'deny', reason: POLICY_MESSAGES.outside }
    }
    const rules = ctx.allowRules.filter((r) => r.tool === 'Bash')
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
