/**
 * Configuração do empacotador (electron-builder), Etapa 6B. Ícones gerados por `pnpm icons`.
 *
 * O modo de assinatura sai do ambiente (`builderConfig(env)` é pura e testada em
 * `test/electron-builder-config.test.ts`):
 * - macOS assinado: só com `CSC_LINK` (certificado .p12 em base64) ou `CSC_NAME` (no Keychain).
 *   Hardened runtime + entitlements mínimos; a notarização roda quando as variáveis da Apple
 *   existem (`APPLE_API_KEY…` ou `APPLE_ID…`), senão o electron-builder pula.
 * - macOS sem Developer ID: assinatura ad-hoc (`identity: '-'`) e hardened runtime desligado
 *   (com ad-hoc ele faria a validação de bibliotecas recusar o Electron Framework).
 * - Windows: sem assinatura, a menos que `WIN_SIGNING=azure` (Artifact Signing, ver docs/releases.md).
 *
 * Alvos e nomes dos arquivos vêm do manifesto `src/shared/release-artifacts.mts`, o mesmo que o
 * release.yml, o auto-update (6C) e o site usam.
 */
import type { Configuration } from 'electron-builder'
import { ARTIFACT_NAME, PRODUCT_NAME, builderTargets } from './src/shared/release-artifacts.mjs'
import { RELEASES_REPO } from './src/shared/updates'

type Env = Readonly<Record<string, string | undefined>>

const has = (env: Env, key: string): boolean => (env[key] ?? '').trim() !== ''

/** macOS assinado com Developer ID? (sem isso: ad-hoc). */
export function isMacSigned(env: Env): boolean {
  return has(env, 'CSC_LINK') || has(env, 'CSC_NAME')
}

/** Assinatura do Windows ligada? Só com `WIN_SIGNING=azure` e as variáveis da conta. */
export function isWinSigned(env: Env): boolean {
  return (
    env['WIN_SIGNING'] === 'azure' &&
    ['AZURE_SIGNING_ENDPOINT', 'AZURE_SIGNING_ACCOUNT', 'AZURE_SIGNING_PROFILE'].every((k) =>
      has(env, k)
    )
  )
}

export function builderConfig(env: Env): Configuration {
  const macSigned = isMacSigned(env)
  return {
    appId: 'com.orkio.app',
    productName: PRODUCT_NAME,
    directories: { buildResources: 'build', output: 'dist' },
    // Sem dependências de runtime hoje (tudo vai no bundle do Vite). Não excluímos node_modules:
    // o electron-updater (6C) entra em "dependencies" e precisa ir no pacote.
    files: ['out/**', 'resources/**', 'package.json'],
    asarUnpack: ['resources/**'],
    // node:sqlite é embutido no Electron: nada nativo para recompilar.
    npmRebuild: false,
    electronFuses: {
      // A ponte MCP de permissões (out/main/permission-mcp.js) roda com ELECTRON_RUN_AS_NODE=1.
      runAsNode: true,
      enableCookieEncryption: true,
      enableNodeOptionsEnvironmentVariable: false,
      enableNodeCliInspectArguments: false,
      onlyLoadAppFromAsar: true
      // enableEmbeddedAsarIntegrityValidation: pendente de teste no macOS/Windows empacotados.
    },
    publish: {
      provider: 'github',
      owner: RELEASES_REPO.owner,
      repo: RELEASES_REPO.repo,
      // Os jobs (mac, Windows e Linux) sobem para o mesmo rascunho; o release.yml publica no fim.
      releaseType: 'draft'
    },
    mac: {
      icon: 'build/icon.icns',
      category: 'public.app-category.developer-tools',
      target: builderTargets('mac'),
      artifactName: ARTIFACT_NAME.mac,
      // Ad-hoc sem Developer ID (no Apple Silicon todo binário precisa de assinatura).
      ...(macSigned ? {} : { identity: '-' }),
      hardenedRuntime: macSigned,
      entitlements: 'build/entitlements.mac.plist',
      entitlementsInherit: 'build/entitlements.mac.plist',
      notarize: macSigned
    },
    dmg: { artifactName: ARTIFACT_NAME.mac },
    win: {
      icon: 'build/icon.ico',
      target: builderTargets('windows'),
      ...(isWinSigned(env)
        ? {
            azureSignOptions: {
              publisherName: env['WIN_PUBLISHER_NAME'] ?? 'Orkio',
              endpoint: env['AZURE_SIGNING_ENDPOINT'] ?? '',
              codeSigningAccountName: env['AZURE_SIGNING_ACCOUNT'] ?? '',
              certificateProfileName: env['AZURE_SIGNING_PROFILE'] ?? ''
            }
          }
        : {})
    },
    nsis: {
      artifactName: ARTIFACT_NAME.windows,
      // Instalação por usuário, sem pedir administrador.
      oneClick: true,
      perMachine: false,
      createStartMenuShortcut: true,
      createDesktopShortcut: true,
      deleteAppDataOnUninstall: false
    },
    // Linux: AppImage (roda em qualquer distro e se atualiza sozinho pelo electron-updater, que lê o
    // latest-linux.yml) e .deb (instala no Ubuntu/Debian; atualização à mão).
    linux: {
      // Pasta com um PNG por tamanho (gerada por `pnpm icons`): o tema hicolor do GNOME só procura
      // até 512×512, então só o 1024 deixava o atalho sem ícone.
      icon: 'build/icons',
      category: 'Development',
      executableName: 'orkio',
      synopsis: 'Orquestração de desenvolvimento com IA (Notion, GitHub, Claude Code)',
      maintainer: 'uBrunoow <uBrunoow@users.noreply.github.com>',
      target: builderTargets('linux')
    },
    appImage: { artifactName: ARTIFACT_NAME.linux },
    deb: { artifactName: ARTIFACT_NAME.linux }
  }
}

export default builderConfig(process.env)
