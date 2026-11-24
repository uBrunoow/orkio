/**
 * Catálogo das ferramentas do Claude Code que o Orkio conhece (puro, sem Node/DOM). A política
 * (`main/claude/policy.ts`), o log (`main/claude/stream.ts`), o passo só de leitura
 * (`--disallowedTools`) e a conversa na tela (`categoryOf`) derivam daqui: uma ferramenta nova
 * entra uma vez.
 */

/**
 * - `edit`: escreve arquivo (dentro do worktree passa; o passo só de leitura não recebe).
 * - `read`/`search`: lê arquivo ou pasta (dentro do worktree passa).
 * - `command`: shell (a política decide comando a comando).
 * - `web`: rede (pergunta).
 * - `subagent`/`plan`: sem efeito fora da sessão (passa).
 * - `question`: pergunta do Claude (vira cartão na tela).
 */
export type ToolCategory =
  'edit' | 'read' | 'search' | 'command' | 'web' | 'subagent' | 'plan' | 'question'

export interface ClaudeTool {
  category: ToolCategory
  /** Campos da entrada com caminho (o primeiro presente vale; a política confere o worktree). */
  pathKeys?: readonly string[]
  /** O caminho é de um arquivo (lido/escrito): vai no `file` do log (ex.: `.env` lido vira segredo). */
  file?: boolean
  /** Campos da entrada que resumem a chamada no log (o primeiro presente vale). */
  summaryKeys?: readonly string[]
}

/** A ordem das ferramentas de edição é a do `--disallowedTools`. */
export const CLAUDE_TOOLS = {
  Edit: { category: 'edit', pathKeys: ['file_path'], file: true },
  Write: { category: 'edit', pathKeys: ['file_path'], file: true },
  MultiEdit: { category: 'edit', pathKeys: ['file_path'], file: true },
  NotebookEdit: { category: 'edit', pathKeys: ['notebook_path'], file: true },
  Read: { category: 'read', pathKeys: ['file_path'], file: true },
  LS: { category: 'read', pathKeys: ['path'] },
  Grep: { category: 'search', pathKeys: ['path'], summaryKeys: ['pattern'] },
  Glob: { category: 'search', pathKeys: ['path'], summaryKeys: ['pattern'] },
  Bash: { category: 'command', summaryKeys: ['command'] },
  WebFetch: { category: 'web', summaryKeys: ['url'] },
  WebSearch: { category: 'web', summaryKeys: ['query'] },
  Task: { category: 'subagent', summaryKeys: ['description'] },
  Agent: { category: 'subagent', summaryKeys: ['description'] },
  Skill: { category: 'plan', summaryKeys: ['skill', 'command'] },
  TodoWrite: { category: 'plan' },
  TaskCreate: { category: 'plan' },
  TaskUpdate: { category: 'plan' },
  TaskList: { category: 'plan' },
  ExitPlanMode: { category: 'plan' },
  AskUserQuestion: { category: 'question' }
} as const satisfies Record<string, ClaudeTool>

export type ClaudeToolName = keyof typeof CLAUDE_TOOLS

export function toolInfo(tool: string): ClaudeTool | null {
  return Object.hasOwn(CLAUDE_TOOLS, tool) ? CLAUDE_TOOLS[tool as ClaudeToolName] : null
}

export function toolCategory(tool: string): ToolCategory | null {
  return toolInfo(tool)?.category ?? null
}

/** Ferramentas de uma categoria, na ordem do catálogo. */
export function toolsIn(category: ToolCategory): ClaudeToolName[] {
  return (Object.keys(CLAUDE_TOOLS) as ClaudeToolName[]).filter(
    (t) => CLAUDE_TOOLS[t].category === category
  )
}

/** Caminho da entrada de uma ferramenta conhecida (`file_path`, `notebook_path`, `path`). */
export function toolPath(tool: string, input: unknown): string | null {
  const keys = toolInfo(tool)?.pathKeys ?? []
  if (typeof input !== 'object' || input === null) return null
  const rec = input as Record<string, unknown>
  for (const k of keys) {
    const v = rec[k]
    if (typeof v === 'string' && v) return v
  }
  return null
}
