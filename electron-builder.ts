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
 * Os nomes dos arquivos seguem o que o site (site/lib/releases.ts) e o auto-update (6C) esperam:
 * arquitetura no nome do dmg/zip do mac e do instalador do Windows.
 */
import type { Configuration } from 'electron-builder'

export const RELEASES_OWNER = 'uBrunoow'
export const RELEASES_REPO = 'orkio'

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
    productName: 'Orkio',
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
      owner: RELEASES_OWNER,
      repo: RELEASES_REPO,
      // Os jobs (mac, Windows e Linux) sobem para o mesmo rascunho; o release.yml publica no fim.
      releaseType: 'draft'
    },
    mac: {
      icon: 'build/icon.icns',
      category: 'public.app-category.developer-tools',
      target: [
        { target: 'dmg', arch: ['arm64', 'x64'] },
        // O zip é o que o auto-update do mac baixa.
        { target: 'zip', arch: ['arm64', 'x64'] }
      ],
      artifactName: '${productName}-${version}-mac-${arch}.${ext}',
      // Ad-hoc sem Developer ID (no Apple Silicon todo binário precisa de assinatura).
      ...(macSigned ? {} : { identity: '-' }),
      hardenedRuntime: macSigned,
      entitlements: 'build/entitlements.mac.plist',
      entitlementsInherit: 'build/entitlements.mac.plist',
      notarize: macSigned
    },
    dmg: { artifactName: '${productName}-${version}-mac-${arch}.${ext}' },
    win: {
      icon: 'build/icon.ico',
      // arm64 opcional: acrescente 'arm64' em arch.
      target: [{ target: 'nsis', arch: ['x64'] }],
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
      artifactName: '${productName}-${version}-win-${arch}-setup.${ext}',
      // Instalação por usuário, sem pedir administrador.
      oneClick: true,
      perMachine: false,
      createStartMenuShortcut: true,
      createDesktopShortcut: true,
      deleteAppDataOnUninstall: false
    },
    // Linux: AppImage (roda em qualquer distro e se atualiza sozinho pelo electron-updater, que lê o
    // latest-linux.yml) e .deb (instala no Ubuntu/Debian; atualização à mão). Só x64 por enquanto.
    linux: {
      // Pasta com um PNG por tamanho (gerada por `pnpm icons`): o tema hicolor do GNOME só procura
      // até 512×512, então só o 1024 deixava o atalho sem ícone.
      icon: 'build/icons',
      category: 'Development',
      executableName: 'orkio',
      synopsis: 'Orquestração de desenvolvimento com IA (Notion, GitHub, Claude Code)',
      maintainer: 'uBrunoow <uBrunoow@users.noreply.github.com>',
      target: [
        { target: 'AppImage', arch: ['x64'] },
        { target: 'deb', arch: ['x64'] }
      ]
    },
    // ${arch} vira x86_64 no AppImage e amd64 no .deb (nomes de cada formato).
    appImage: { artifactName: '${productName}-${version}-linux-${arch}.${ext}' },
    deb: { artifactName: '${productName}-${version}-linux-${arch}.${ext}' }
  }
}

export default builderConfig(process.env)
