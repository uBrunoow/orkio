/**
 * Pasta de rascunho do Orkio no worktree da tarefa (`.orkio/`): briefing, anexos, revisão da PR e
 * o que mais o Orkio grava para o agente ler. Fica fora do git pelo `.orkio/.gitignore` (escrito só
 * por `ensureScratch`, `main/claude/scratch.ts`).
 *
 * `.orkio/agents/` NÃO é rascunho: os perfis dos agentes (8A) são versionados no repositório. O
 * `.gitignore` os deixa de fora do `*`, e `isScratchPath` não os esconde do resumo, do diff e dos
 * artefatos.
 */

export const SCRATCH_DIR = '.orkio'
export const BRIEFING_PATH = `${SCRATCH_DIR}/briefing.md`
export const ATTACHMENTS_DIR = `${SCRATCH_DIR}/attachments`
export const REVIEW_PATH = `${SCRATCH_DIR}/revisao.md`
/** Perfis dos agentes do repositório (versionados; não são rascunho). */
export const AGENTS_DIR = `${SCRATCH_DIR}/agents`

/** Conteúdo do `.orkio/.gitignore`: tudo, menos os perfis dos agentes. */
export const SCRATCH_GITIGNORE = '*\n!/agents/\n!/agents/**\n'

/** Caminho relativo à raiz do worktree (com `/`) é rascunho do Orkio? */
export function isScratchPath(rel: string): boolean {
  const p = rel.replace(/\\/g, '/').replace(/^\.\//, '')
  if (p !== SCRATCH_DIR && !p.startsWith(`${SCRATCH_DIR}/`)) return false
  return p !== AGENTS_DIR && !p.startsWith(`${AGENTS_DIR}/`)
}
