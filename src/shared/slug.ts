import { normalizeLabel } from './text'

/** "Sincronizar tarefas do Notion!" → "sincronizar-tarefas-do-notion" (máx. 40 caracteres). */
export function slugify(title: string, max = 40): string {
  const slug = normalizeLabel(title)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  const cut = slug.slice(0, max).replace(/-+$/g, '')
  return cut || 'tarefa'
}

/** Tipo da branch nova (convenção do time). `feat` é o padrão; troca-se à mão no formulário. */
export const BRANCH_KINDS = ['feat', 'fix', 'hotfix'] as const
export type BranchKind = (typeof BRANCH_KINDS)[number]

export function isBranchKind(value: unknown): value is BranchKind {
  return typeof value === 'string' && (BRANCH_KINDS as readonly string[]).includes(value)
}

/**
 * Branch nova da tarefa: `<tipo>/<ID>-<slug>` quando há ID do Notion (o ID no nome liga a branch e
 * a PR à tarefa pelos sinais da 2D) e `<tipo>/<slug>` sem ID (aí a ligação é o registro local em
 * `task_branches`, o link do Notion na PR ou o "Vincular branch").
 */
export function taskBranchName(
  displayId: string | null,
  title: string,
  kind: BranchKind = 'feat'
): string {
  const slug = slugify(title)
  return displayId ? `${kind}/${displayId}-${slug}` : `${kind}/${slug}`
}

/** Troca o tipo de uma branch montada por `taskBranchName` (`feat/x` → `fix/x`). */
export function withBranchKind(name: string, kind: BranchKind): string {
  const slash = name.indexOf('/')
  return `${kind}/${slash < 0 ? name : name.slice(slash + 1)}`
}

/** Mesmo nome com sufixo numérico quando já existe (`feat/x` → `feat/x-2`). */
export function uniqueBranchName(name: string, taken: ReadonlySet<string>): string {
  if (!taken.has(name)) return name
  for (let i = 2; i < 100; i++) {
    const candidate = `${name}-${i}`
    if (!taken.has(candidate)) return candidate
  }
  return `${name}-${Date.now()}`
}

/** Id de página do Notion sem hífens e em minúsculas (como aparece nas URLs). */
export function normalizePageId(id: string): string {
  return id.replace(/-/g, '').toLowerCase()
}

/**
 * Ids de páginas do Notion citadas num texto (corpo de PR): links `notion.so`/`notion.com`/`notion.site` terminam
 * com o id de 32 caracteres hexadecimais (com ou sem hífens). Devolve normalizados, sem repetir.
 */
export function notionPageIdsIn(text: string | null | undefined): string[] {
  if (!text) return []
  const out = new Set<string>()
  const url = /https?:\/\/(?:www\.)?[a-z0-9-]*\.?notion\.(?:so|com|site)\/[^\s)\]>"']+/gi
  for (const m of text.matchAll(url)) {
    const path = m[0].split(/[?#]/)[0] ?? ''
    const id = /([0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(
      path
    )
    if (id?.[1]) out.add(normalizePageId(id[1]))
  }
  return [...out]
}
