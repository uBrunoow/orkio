import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type {
  Configuration,
  MacConfiguration,
  NsisOptions,
  WindowsConfiguration
} from 'electron-builder'
import { builderConfig, isMacSigned } from '../electron-builder'
import { releaseAssets } from '../scripts/release-assets.mjs'
import {
  RELEASE_ARTIFACTS,
  artifactFileName,
  type ReleaseOs
} from '../src/shared/release-artifacts.mjs'
import { RELEASES_REPO, macDownloadUrl } from '../src/shared/updates'

const ROOT = join(import.meta.dirname, '..')

/** Pares alvo × arquitetura que a config manda o electron-builder gerar, por sistema. */
function configuredTargets(c: Configuration): Set<string> {
  const out = new Set<string>()
  const bySystem: [ReleaseOs, unknown][] = [
    ['mac', c.mac?.target],
    ['windows', c.win?.target],
    ['linux', c.linux?.target]
  ]
  for (const [os, targets] of bySystem) {
    for (const t of targets as { target: string; arch: string[] }[]) {
      for (const arch of t.arch) out.add(`${os}:${t.target}:${arch}`)
    }
  }
  return out
}

describe('electron-builder.ts × manifesto dos releases', () => {
  it('gera exatamente os alvos do manifesto, com o nome de cada sistema', () => {
    const c = builderConfig({})
    expect(configuredTargets(c)).toEqual(
      new Set(RELEASE_ARTIFACTS.map((a) => `${a.os}:${a.target}:${a.arch}`))
    )
    // O que o electron-builder escreve: o artifactName do formato, com ${arch} = x86_64 no
    // AppImage e amd64 no .deb.
    const pattern = {
      dmg: c.dmg?.artifactName,
      zip: (c.mac as MacConfiguration).artifactName,
      nsis: (c.nsis as NsisOptions).artifactName,
      AppImage: c.appImage?.artifactName,
      deb: c.deb?.artifactName
    }
    const builderArch = (target: string, arch: string): string =>
      arch !== 'x64' ? arch : target === 'AppImage' ? 'x86_64' : target === 'deb' ? 'amd64' : arch
    for (const a of RELEASE_ARTIFACTS) {
      const rendered = (pattern[a.target] ?? '')
        .replace('${productName}', c.productName ?? '')
        .replace('${version}', '1.2.3')
        .replace('${arch}', builderArch(a.target, a.arch))
        .replace('${ext}', a.ext)
      expect(rendered, `${a.os} ${a.target} ${a.arch}`).toBe(artifactFileName(a, '1.2.3'))
    }
  })

  it('o release confere todos os pacotes e os .yml do canal', () => {
    const files = releaseAssets('v1.2.3')
    for (const a of RELEASE_ARTIFACTS) expect(files).toContain(artifactFileName(a, '1.2.3'))
    expect(files).toEqual(
      expect.arrayContaining(['latest-mac.yml', 'latest.yml', 'latest-linux.yml'])
    )
    expect(releaseAssets('1.3.0-beta.1')).toEqual(
      expect.arrayContaining(['beta-mac.yml', 'beta.yml', 'beta-linux.yml'])
    )
  })

  it('o auto-update manual do mac acha o DMG de cada arquitetura nos arquivos do release', () => {
    const files = RELEASE_ARTIFACTS.filter((a) => a.os === 'mac').map((a) =>
      artifactFileName(a, '1.2.3')
    )
    for (const arch of ['arm64', 'x64']) {
      const url = macDownloadUrl('1.2.3', files, arch)
      expect(url).toBe(
        `https://github.com/${RELEASES_REPO.owner}/${RELEASES_REPO.repo}/releases/download/v1.2.3/Orkio-1.2.3-mac-${arch}.dmg`
      )
    }
  })

  it('publica nos releases do repositório do app, como rascunho', () => {
    expect(builderConfig({}).publish).toMatchObject({
      provider: 'github',
      owner: RELEASES_REPO.owner,
      repo: RELEASES_REPO.repo,
      releaseType: 'draft'
    })
  })
})

describe('electron-builder.ts', () => {
  it('mantém RunAsNode ligado (ponte MCP) e não recompila nada nativo', () => {
    const c = builderConfig({})
    expect(c.electronFuses?.runAsNode).toBe(true)
    expect(c.electronFuses?.onlyLoadAppFromAsar).toBe(true)
    expect(c.npmRebuild).toBe(false)
    // O main e a ponte (out/main/permission-mcp.js) vão no asar; node_modules não é excluído.
    expect(c.files).toContain('out/**')
    expect(JSON.stringify(c.files)).not.toContain('!node_modules')
  })

  it('sem Developer ID: ad-hoc e sem hardened runtime', () => {
    const mac = builderConfig({}).mac as MacConfiguration
    expect(isMacSigned({})).toBe(false)
    expect(mac.identity).toBe('-')
    expect(mac.hardenedRuntime).toBe(false)
    expect(mac.notarize).toBe(false)
  })

  it('com CSC_LINK: identidade do certificado, hardened runtime e notarização', () => {
    const mac = builderConfig({ CSC_LINK: 'base64' }).mac as MacConfiguration
    expect(mac.identity).toBeUndefined()
    expect(mac.hardenedRuntime).toBe(true)
    expect(mac.notarize).toBe(true)
    expect(mac.entitlements).toBe('build/entitlements.mac.plist')
  })

  it('Windows: instalação por usuário; assinatura só com WIN_SIGNING=azure completo', () => {
    const c = builderConfig({})
    expect((c.nsis as NsisOptions).perMachine).toBe(false)
    expect((c.win as WindowsConfiguration).azureSignOptions).toBeUndefined()
    expect(
      (builderConfig({ WIN_SIGNING: 'azure' }).win as WindowsConfiguration).azureSignOptions
    ).toBeUndefined()
    const signed = builderConfig({
      WIN_SIGNING: 'azure',
      AZURE_SIGNING_ENDPOINT: 'https://eus.codesigning.azure.net',
      AZURE_SIGNING_ACCOUNT: 'conta',
      AZURE_SIGNING_PROFILE: 'perfil'
    }).win as WindowsConfiguration
    expect(signed.azureSignOptions?.codeSigningAccountName).toBe('conta')
  })

  it('Linux: os ícones por tamanho que a config aponta existem', () => {
    const c = builderConfig({})
    // Um PNG por tamanho: o tema hicolor só procura até 512×512 (só o 1024 = atalho sem ícone).
    for (const size of [16, 32, 48, 128, 256, 512]) {
      expect(existsSync(join(ROOT, String(c.linux?.icon), `${size}x${size}.png`))).toBe(true)
    }
  })
})
