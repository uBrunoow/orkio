import { describe, expect, it } from 'vitest'
import type { MacConfiguration, NsisOptions, WindowsConfiguration } from 'electron-builder'
import { builderConfig, isMacSigned } from '../electron-builder'

describe('electron-builder.ts', () => {
  it('publica no repositório público de releases, como rascunho', () => {
    expect(builderConfig({}).publish).toEqual({
      provider: 'github',
      owner: 'uBrunoow',
      repo: 'orkio-releases',
      releaseType: 'draft'
    })
  })

  it('mantém RunAsNode ligado (ponte MCP) e não recompila nada nativo', () => {
    const c = builderConfig({})
    expect(c.electronFuses?.runAsNode).toBe(true)
    expect(c.electronFuses?.onlyLoadAppFromAsar).toBe(true)
    expect(c.npmRebuild).toBe(false)
    // O main e a ponte (out/main/permission-mcp.js) vão no asar; node_modules não é excluído.
    expect(c.files).toContain('out/**')
    expect(JSON.stringify(c.files)).not.toContain('!node_modules')
  })

  it('nomes com a arquitetura (site e auto-update dependem disso)', () => {
    const c = builderConfig({})
    expect((c.mac as MacConfiguration).artifactName).toBe(
      '${productName}-${version}-mac-${arch}.${ext}'
    )
    expect(c.dmg?.artifactName).toBe('${productName}-${version}-mac-${arch}.${ext}')
    expect((c.nsis as NsisOptions).artifactName).toBe(
      '${productName}-${version}-win-${arch}-setup.${ext}'
    )
    expect(JSON.stringify((c.mac as MacConfiguration).target)).toContain('"zip"')
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
})
