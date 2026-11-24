#!/usr/bin/env node
/**
 * `node scripts/release-assets.mjs <versão>`: um arquivo por linha, os que o release da versão
 * precisa ter (pacotes do manifesto `src/shared/release-artifacts.mts` + os `.yml` do canal do
 * auto-update; beta → `beta*.yml`). O release.yml confere o rascunho com esta lista.
 */
import {
  RELEASE_ARTIFACTS,
  artifactFileName,
  channelFiles
} from '../src/shared/release-artifacts.mts'
import { isPrerelease } from './release-lib.mjs'

export function releaseAssets(version) {
  const v = version.replace(/^v/, '')
  return [...RELEASE_ARTIFACTS.map((a) => artifactFileName(a, v)), ...channelFiles(isPrerelease(v))]
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const version = process.argv[2] ?? ''
  try {
    process.stdout.write(`${releaseAssets(version).join('\n')}\n`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
