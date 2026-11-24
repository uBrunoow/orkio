/**
 * Formato do `CHANGELOG.md` (Keep a Changelog, pt-BR): seções `## [Não lançado]` e
 * `## [X.Y.Z] - AAAA-MM-DD`. Leitor único: o `pnpm release`/`release.yml` (`scripts/release-lib.mts`
 * e `changelog-notes.mjs`, que importam este arquivo pelo Node) e o "O que há de novo" do app (`updates.ts`). Sem Node/DOM e
 * sem sintaxe que o Node não consiga tirar (só tipos): os scripts rodam este arquivo direto.
 */

export const CHANGELOG_UNRELEASED = 'Não lançado'

export function changelogLines(changelog: string): string[] {
  return changelog.replace(/\r\n/g, '\n').split('\n')
}

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Linhas da seção `## [titulo]` (título exato, entre colchetes) até a próxima `## `. */
export function changelogSectionRange(
  lines: readonly string[],
  title: string
): { start: number; end: number } | null {
  const head = new RegExp(`^## \\[${escapeRegExp(title)}\\](\\s|$)`)
  const start = lines.findIndex((l) => head.test(l))
  if (start < 0) return null
  let end = lines.findIndex((l, i) => i > start && /^## /.test(l))
  if (end < 0) end = lines.length
  return { start, end }
}

/** Conteúdo da seção (sem o título), aparado; `''` se vazia e `null` se não existir. */
export function changelogNotes(changelog: string, title: string): string | null {
  const lines = changelogLines(changelog)
  const range = changelogSectionRange(lines, title)
  if (!range) return null
  return lines
    .slice(range.start + 1, range.end)
    .join('\n')
    .trim()
}
