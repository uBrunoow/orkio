/**
 * Listas de caminhos dos workflows: "o que não é o app" é a mesma no CI, no release ao mergear e no
 * rótulo da PR (antes uma PR só do site recebia "Ao mergear, sai a versão vX" e nada saía), e o
 * workflow do site dispara também com o lado app do contrato app ↔ site.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(import.meta.dirname, '..')
const workflow = (name: string): string =>
  readFileSync(join(ROOT, '.github', 'workflows', name), 'utf8')

/** Cada `paths-ignore: [...]` (uma linha) do arquivo, como lista. */
function pathsIgnore(text: string): string[][] {
  return [...text.matchAll(/^\s*paths-ignore:\s*\[(.*)\]\s*$/gm)].map((m) =>
    m[1]!.split(',').map((p) => p.trim().replace(/^'|'$/g, ''))
  )
}

/** A lista `paths:` em bloco (`- '...'`) logo depois da primeira ocorrência. */
function pathsBlock(text: string): string[] {
  const start = text.indexOf('paths:')
  const out: string[] = []
  for (const line of text.slice(start).split('\n').slice(1)) {
    const m = /^\s*-\s*'([^']+)'\s*$/.exec(line)
    if (!m) break
    out.push(m[1]!)
  }
  return out
}

describe('workflows', () => {
  it('ci, release-on-merge e release-label ignoram os mesmos caminhos (fora do app)', () => {
    const lists = [
      ...pathsIgnore(workflow('ci.yml')),
      ...pathsIgnore(workflow('release-on-merge.yml')),
      ...pathsIgnore(workflow('release-label.yml'))
    ]
    expect(lists).toHaveLength(4) // ci: push + pull_request
    for (const list of lists) expect(list).toEqual(lists[0])
    expect(lists[0]).toContain('site/**')
    // Nada do app fica de fora (src, e2e, scripts, configs).
    for (const glob of lists[0]!) expect(glob).not.toMatch(/^(src|e2e|scripts|test)\//)
  })

  it('o workflow do site roda com o lado app do contrato, e os caminhos existem', () => {
    const paths = pathsBlock(workflow('site.yml'))
    expect(paths).toEqual(
      expect.arrayContaining([
        'site/**',
        'src/main/connectors/**',
        'src/shared/site-contract.ts',
        'test/site-contract.test.ts',
        'e2e/site-oauth.spec.ts'
      ])
    )
    for (const p of paths) {
      const dir = p.endsWith('/**') ? p.slice(0, -3) : p
      expect(existsSync(join(ROOT, dir)), p).toBe(true)
    }
  })
})
