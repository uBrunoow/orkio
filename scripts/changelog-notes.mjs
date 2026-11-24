#!/usr/bin/env node
/** `node scripts/changelog-notes.mjs <versão>`: imprime as notas da versão (seção do CHANGELOG). */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { changelogNotes } from '../src/shared/changelog.mts'

const version = (process.argv[2] ?? '').replace(/^v/, '')
const notes = changelogNotes(
  readFileSync(join(import.meta.dirname, '..', 'CHANGELOG.md'), 'utf8'),
  version
)
if (!notes) {
  console.error(`O CHANGELOG.md não tem a seção [${version}].`)
  process.exit(1)
}
process.stdout.write(`${notes}\n`)
