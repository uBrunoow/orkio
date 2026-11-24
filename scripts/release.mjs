#!/usr/bin/env node
/**
 * `pnpm release <patch|minor|major|beta> [--beta]` (Etapa 6B).
 * Atualiza a versão do package.json, move "[Não lançado]" do CHANGELOG para a seção da versão,
 * faz o commit `chore(release): vX.Y.Z` e cria a tag anotada `vX.Y.Z`. NÃO faz push.
 * Com `RELEASE_NOTE` no ambiente e "[Não lançado]" vazio, a nota vira o item da versão.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  fillUnreleased,
  nextVersion,
  parseReleaseArgs,
  releaseChangelog,
  releaseDate
} from './release-lib.mjs'

const ROOT = join(import.meta.dirname, '..')
const git = (...args) =>
  execFileSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim()

function fail(message) {
  console.error(`✖ ${message}`)
  process.exit(1)
}

let opts
try {
  opts = parseReleaseArgs(process.argv.slice(2))
} catch (e) {
  fail(e instanceof Error ? e.message : String(e))
}

if (git('status', '--porcelain') !== '') {
  fail('Há mudanças não commitadas. Faça commit (ou stash) antes de lançar.')
}
const branch = git('rev-parse', '--abbrev-ref', 'HEAD')
if (branch !== 'main') fail(`Lance a partir da main (branch atual: ${branch}).`)

const pkgPath = join(ROOT, 'package.json')
const changelogPath = join(ROOT, 'CHANGELOG.md')
const pkgText = readFileSync(pkgPath, 'utf8')
const pkg = JSON.parse(pkgText)
let version
let changelog
try {
  version = nextVersion(pkg.version, opts.kind, { beta: opts.beta })
  const today = releaseDate(new Date())
  const current = fillUnreleased(readFileSync(changelogPath, 'utf8'), process.env['RELEASE_NOTE'])
  changelog = releaseChangelog(current, version, today)
} catch (e) {
  fail(e instanceof Error ? e.message : String(e))
}
const tag = `v${version}`
if (git('tag', '--list', tag) !== '') fail(`A tag ${tag} já existe.`)

// Troca só o campo "version" (mantém a formatação do arquivo).
const nextPkg = pkgText.replace(/("version"\s*:\s*)"[^"]*"/, `$1"${version}"`)
if (nextPkg === pkgText) fail('Não achei o campo "version" no package.json.')
writeFileSync(pkgPath, nextPkg)
writeFileSync(changelogPath, changelog)

git('add', 'package.json', 'CHANGELOG.md')
git('commit', '-m', `chore(release): ${tag}`)
git('tag', '-a', tag, '-m', tag)

console.log(`✔ ${pkg.version} → ${version} (commit e tag ${tag} criados)`)
console.log('Para publicar, envie o commit e a tag:')
console.log('  git push --follow-tags')
