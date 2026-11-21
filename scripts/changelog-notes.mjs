#!/usr/bin/env node
/** `node scripts/changelog-notes.mjs <versão>`: imprime as notas da versão (seção do CHANGELOG). */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { extractNotes } from './release-lib.mjs'

const version = (process.argv[2] ?? '').replace(/^v/, '')
const notes = extractNotes(
  readFileSync(join(import.meta.dirname, '..', 'CHANGELOG.md'), 'utf8'),
  version
)
if (!notes) {
  console.error(`O CHANGELOG.md não tem a seção [${version}].`)
  process.exit(1)
}
process.stdout.write(`${notes}\n`)
