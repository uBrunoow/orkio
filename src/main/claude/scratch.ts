/** Escrita da pasta de rascunho do Orkio no worktree (`shared/orkio-scratch.ts`). */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { SCRATCH_DIR, SCRATCH_GITIGNORE } from '../../shared/orkio-scratch'

/**
 * Cria `.orkio/` e o `.gitignore` dela (único escritor; no worktree, `.git` é um arquivo e o
 * `info/exclude` é do repositório inteiro). Devolve o caminho absoluto da pasta.
 */
export async function ensureScratch(worktree: string): Promise<string> {
  const dir = join(worktree, SCRATCH_DIR)
  await mkdir(dir, { recursive: true })
  const ignore = join(dir, '.gitignore')
  const current = await readFile(ignore, 'utf8').catch(() => null)
  if (current !== SCRATCH_GITIGNORE) await writeFile(ignore, SCRATCH_GITIGNORE, 'utf8')
  return dir
}
