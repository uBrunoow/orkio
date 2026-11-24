/**
 * O release (`scripts/changelog-notes.mjs`/`release-check.mjs`: notas do GitHub e conferência do `pnpm release`) e o app
 * ("O que há de novo", `changelogSection`) leem o CHANGELOG pelo mesmo leitor
 * (`src/shared/changelog.mts`). Antes eram dois parsers: um título que o app aceitava e o release
 * não (ou o contrário) sumia de um dos lados.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { changelogNotes } from '../src/shared/changelog.mjs'
import { changelogSection } from '../src/shared/updates'

const CHANGELOG = readFileSync(join(import.meta.dirname, '..', 'CHANGELOG.md'), 'utf8')

describe('CHANGELOG: release e app leem igual', () => {
  it('toda versão do CHANGELOG.md real dá o mesmo texto nos dois', () => {
    const versions = [...CHANGELOG.matchAll(/^## \[(\d+\.\d+\.\d+[^\]]*)\]/gm)].map((m) => m[1]!)
    expect(versions.length).toBeGreaterThan(0)
    for (const version of versions) {
      const notes = changelogNotes(CHANGELOG, version)
      expect(notes, version).toBeTruthy()
      expect(changelogSection(CHANGELOG, version), version).toBe(notes)
      expect(changelogSection(CHANGELOG, `v${version}`), version).toBe(notes)
    }
  })

  it('título fora do formato `## [X.Y.Z]` não vale para nenhum dos dois', () => {
    const odd =
      '# Changelog\n\n## 1.0.1 - 2026-01-02\n\n- sem colchetes\n\n## [v1.0.0]\n\n- com v\n'
    for (const version of ['1.0.1', '1.0.0']) {
      expect(changelogNotes(odd, version), version).toBeNull()
      expect(changelogSection(odd, version), version).toBeNull()
    }
  })
})
