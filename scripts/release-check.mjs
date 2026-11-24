#!/usr/bin/env node
/**
 * Usado pelo release.yml: `node scripts/release-check.mjs <tag>`.
 * Confere tag == "v" + versão do package.json e se o CHANGELOG tem a seção da versão.
 * No GitHub Actions, grava `version` e `prerelease` (true/false) em $GITHUB_OUTPUT.
 */
import { appendFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { changelogNotes } from '../src/shared/changelog.mts'
import { isPrerelease } from './release-lib.mts'

const ROOT = join(import.meta.dirname, '..')
const tag = (process.argv[2] ?? '').replace(/^refs\/tags\//, '')
const { version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))

function fail(message) {
  console.error(`::error::${message}`)
  process.exit(1)
}

if (tag !== `v${version}`)
  fail(`A tag (${tag}) não bate com a versão do package.json (v${version}).`)
let prerelease
try {
  prerelease = isPrerelease(version)
} catch (e) {
  fail(e instanceof Error ? e.message : String(e))
}
const notes = changelogNotes(readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8'), version)
if (!notes) fail(`O CHANGELOG.md não tem a seção "## [${version}]" (ou ela está vazia).`)

console.log(`Versão ${version} (${prerelease ? 'beta, pre-release' : 'estável'})`)
if (process.env['GITHUB_OUTPUT']) {
  appendFileSync(process.env['GITHUB_OUTPUT'], `version=${version}\nprerelease=${prerelease}\n`)
}
