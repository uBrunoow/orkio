/**
 * Integração com o plugin alva-flow (Etapa 5B): tipos compartilhados e as funções puras de
 * leitura das tasks do Backlog.md (frontmatter, status, critérios, perguntas em aberto).
 */

export type AlvaCheckState = 'ok' | 'missing' | 'warning'

export interface AlvaCheckItem {
  id: 'plugin' | 'backlog' | 'backlog_mcp' | 'gh' | 'python' | 'makefile' | 'docker'
  label: string
  state: AlvaCheckState
  detail: string
  /** Comando ou link para resolver (mostrado para copiar). */
  fix?: string
}

export interface AlvaPrecheck {
  /** Nenhum item faltando (avisos não bloqueiam). */
  ready: boolean
  pluginVersion: string | null
  hasDocker: boolean
  items: AlvaCheckItem[]
  checkedAt: string
}

/** Status do Backlog.md usados pelo alva-flow (o config do projeto pode ter outros). */
export const ALVA_STATUSES = [
  'To Do',
  'Requirements Defined',
  'Architected',
  'Executed',
  'Reviewed',
  'Done'
] as const

/** O que o Orkio lê de uma task do Backlog.md (nada de descrição, plano ou notas). */
export interface BacklogTaskInfo {
  id: string
  title: string
  status: string
  criteria: { done: number; total: number }
  /** Itens `- [ ]` na seção "Perguntas em aberto" da descrição. */
  openQuestions: number
}

/** Tamanho máximo do texto da task mostrado na tela (o resto é cortado, com aviso). */
export const BACKLOG_DOC_LIMIT = 60_000

/** A task do Backlog.md para leitura (spec, critérios e plano), só no renderer, nunca guardada. */
export interface BacklogTaskDocument {
  info: BacklogTaskInfo
  /** Markdown sem o frontmatter e sem os marcadores HTML; segredos ocultados no main. */
  body: string
  /** O texto passou do limite e foi cortado. */
  truncated: boolean
  /** Ainda não vinculada: o rascunho que o `/spec` desta tarefa está escrevendo no worktree. */
  draft?: boolean
}

/**
 * Corpo legível da task: tira o frontmatter e os marcadores (`<!-- AC:BEGIN -->`...), junta
 * linhas em branco e corta no limite (no fim de uma linha).
 */
export function backlogTaskBody(markdown: string): { body: string; truncated: boolean } {
  const withoutFrontmatter = markdown.replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n?/, '')
  const clean = withoutFrontmatter
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  if (clean.length <= BACKLOG_DOC_LIMIT) return { body: clean, truncated: false }
  const cut = clean.slice(0, BACKLOG_DOC_LIMIT)
  const lastBreak = cut.lastIndexOf('\n')
  return { body: (lastBreak > 0 ? cut.slice(0, lastBreak) : cut).trimEnd(), truncated: true }
}

function unquote(v: string): string {
  const t = v.trim()
  if ((t.startsWith("'") && t.endsWith("'")) || (t.startsWith('"') && t.endsWith('"'))) {
    return t.slice(1, -1).replace(/''/g, "'")
  }
  return t
}

/** Frontmatter + critérios + perguntas em aberto. `null` se não parece uma task do Backlog.md. */
export function parseBacklogTask(markdown: string): BacklogTaskInfo | null {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown)
  if (!fm) return null
  const fields: Record<string, string> = {}
  for (const line of fm[1]!.split(/\r?\n/)) {
    const m = /^(id|title|status):\s*(.*)$/.exec(line)
    if (m) fields[m[1]!] = unquote(m[2]!)
  }
  if (!fields['id'] || !fields['status']) return null

  const ac = /<!-- AC:BEGIN -->([\s\S]*?)<!-- AC:END -->/.exec(markdown)?.[1] ?? ''
  const items = [...ac.matchAll(/^\s*- \[( |x|X)\]/gm)]
  const description =
    /<!-- SECTION:DESCRIPTION:BEGIN -->([\s\S]*?)<!-- SECTION:DESCRIPTION:END -->/.exec(
      markdown
    )?.[1] ?? markdown
  const questions = /^##+\s*Perguntas em aberto\s*$([\s\S]*?)(?=^##+\s|$(?![\s\S]))/m.exec(
    description
  )?.[1]
  return {
    id: fields['id'],
    title: fields['title'] ?? '',
    status: fields['status'],
    criteria: {
      done: items.filter((m) => m[1] !== ' ').length,
      total: items.length
    },
    openQuestions: questions ? [...questions.matchAll(/^\s*- \[ \]/gm)].length : 0
  }
}

/**
 * Tamanho da demanda pela mensagem final do /spec ("**Tamanho:** Médio"), que só aparece no
 * Médio/Grande. Pequeno é reconhecido pelo status Reviewed depois do /spec (sinal confiável).
 */
export function sizeFromSpecResult(resultText: string): 'Médio' | 'Grande' | null {
  const m = /\*\*Tamanho:\*\*\s*(M[ée]dio|Grande)/i.exec(resultText)
  if (!m) return null
  return /grande/i.test(m[1]!) ? 'Grande' : 'Médio'
}

/** Arquivo de task do Backlog.md (`task-12 - Titulo.md`) → prefixo do id em minúsculas. */
export function taskFileId(fileName: string): string | null {
  return /^([A-Za-z]+-\d+(?:\.\d+)*) - .*\.md$/.exec(fileName)?.[1]?.toLowerCase() ?? null
}
