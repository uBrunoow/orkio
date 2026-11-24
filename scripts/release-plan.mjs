#!/usr/bin/env node
/**
 * `LABELS='["release:minor"]' RELEASE_NOTE='Título da PR' node scripts/release-plan.mjs`
 * (usado pelos workflows de release). Sem rótulo = patch; `release:none` = não lança.
 * Lê os rótulos da PR (JSON ou texto, um por linha), decide se há release, qual versão sai e
 * confere o CHANGELOG, sem escrever nada. No GitHub Actions grava `release`, `kind` e `version`
 * em $GITHUB_OUTPUT e um resumo em $GITHUB_STEP_SUMMARY. Erro → `::error::` e saída 1.
 */
import { appendFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { planRelease, releaseDate } from './release-lib.mjs'

const ROOT = join(import.meta.dirname, '..')

function fail(message) {
  console.error(`::error::${message}`)
  process.exit(1)
}

function parseLabels(raw) {
  const text = (raw ?? '').trim()
  if (text === '') return []
  if (text.startsWith('[')) {
    const parsed = JSON.parse(text)
    if (!Array.isArray(parsed) || parsed.some((l) => typeof l !== 'string')) {
      throw new Error('LABELS precisa ser uma lista de textos.')
    }
    return parsed
  }
  return text.split(/\r?\n/).filter(Boolean)
}

let plan
try {
  const { version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  plan = planRelease({
    labels: parseLabels(process.env['LABELS']),
    currentVersion: version,
    changelog: readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8'),
    today: releaseDate(new Date()),
    note: process.env['RELEASE_NOTE'] ?? null
  })
} catch (e) {
  fail(e instanceof Error ? e.message : String(e))
}

const plain = plan.release
  ? `Ao mergear, sai a versão v${plan.version} (${plan.prerelease ? 'beta, pre-release' : 'estável'}, release:${plan.kind}).`
  : 'PR com release:none: ao mergear, nenhuma versão é lançada.'
console.log(plain)
const summary = plain.replace(/(v\d[^ ]*)/, '**$1**')
if (process.env['GITHUB_OUTPUT']) {
  appendFileSync(
    process.env['GITHUB_OUTPUT'],
    plan.release ? `release=true\nkind=${plan.kind}\nversion=${plan.version}\n` : 'release=false\n'
  )
}
if (process.env['GITHUB_STEP_SUMMARY'])
  appendFileSync(process.env['GITHUB_STEP_SUMMARY'], `${summary}\n`)
