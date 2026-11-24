/**
 * Manifesto dos arquivos de cada release (Etapa 6B): os alvos do empacotador e o nome de cada
 * arquivo. Uma fonte só para quem gera e quem lê os nomes:
 * - `electron-builder.ts` monta `target`/`artifactName` daqui;
 * - `scripts/release-assets.mts` lista os arquivos que o `release.yml` confere no rascunho;
 * - `updates.ts` acha o DMG do mac (auto-update manual);
 * - o site (`site/lib/releases.ts`) classifica pelos mesmos nomes (`test/site-contract.test.ts`).
 * Sem Node/DOM e só com sintaxe que o Node tira sozinho (os scripts rodam este arquivo direto).
 */

export const PRODUCT_NAME = 'Orkio'

export type ReleaseOs = 'mac' | 'windows' | 'linux'
export type ReleaseArch = 'arm64' | 'x64'
export type ReleaseTarget = 'dmg' | 'zip' | 'nsis' | 'AppImage' | 'deb'
/** Botão de download do site. */
export type DownloadKind = 'mac-arm64' | 'mac-x64' | 'windows' | 'linux-appimage' | 'linux-deb'

export interface ReleaseArtifact {
  target: ReleaseTarget
  os: ReleaseOs
  arch: ReleaseArch
  ext: string
  /** Botão de download do site; `null` = só para o auto-update (zip do mac). */
  download: DownloadKind | null
}

/** Um arquivo por linha. Novo alvo (ex.: Windows arm64) = uma linha aqui + o rótulo no site. */
export const RELEASE_ARTIFACTS: readonly ReleaseArtifact[] = [
  { target: 'dmg', os: 'mac', arch: 'arm64', ext: 'dmg', download: 'mac-arm64' },
  { target: 'dmg', os: 'mac', arch: 'x64', ext: 'dmg', download: 'mac-x64' },
  // O zip é o que o auto-update do mac baixa.
  { target: 'zip', os: 'mac', arch: 'arm64', ext: 'zip', download: null },
  { target: 'zip', os: 'mac', arch: 'x64', ext: 'zip', download: null },
  { target: 'nsis', os: 'windows', arch: 'x64', ext: 'exe', download: 'windows' },
  { target: 'AppImage', os: 'linux', arch: 'x64', ext: 'AppImage', download: 'linux-appimage' },
  { target: 'deb', os: 'linux', arch: 'x64', ext: 'deb', download: 'linux-deb' }
]

/** `artifactName` do electron-builder por sistema (variáveis dele: productName, version, arch, ext). */
export const ARTIFACT_NAME: Readonly<Record<ReleaseOs, string>> = {
  mac: '${productName}-${version}-mac-${arch}.${ext}',
  windows: '${productName}-${version}-win-${arch}-setup.${ext}',
  linux: '${productName}-${version}-linux-${arch}.${ext}'
}

/** O `${arch}` que o electron-builder escreve: x86_64 no AppImage e amd64 no .deb. */
function archInName(artifact: ReleaseArtifact): string {
  if (artifact.arch !== 'x64') return artifact.arch
  if (artifact.target === 'AppImage') return 'x86_64'
  if (artifact.target === 'deb') return 'amd64'
  return 'x64'
}

/** Nome do arquivo no release, ex.: `Orkio-1.2.0-mac-arm64.dmg`. */
export function artifactFileName(artifact: ReleaseArtifact, version: string): string {
  const values: Record<string, string> = {
    productName: PRODUCT_NAME,
    version: version.replace(/^v/, ''),
    arch: archInName(artifact),
    ext: artifact.ext
  }
  return ARTIFACT_NAME[artifact.os].replace(/\$\{(\w+)\}/g, (_, key: string) => values[key] ?? '')
}

/** Alvos de um sistema no formato do electron-builder (`{ target, arch: [...] }`, na ordem). */
export function builderTargets(os: ReleaseOs): { target: ReleaseTarget; arch: ReleaseArch[] }[] {
  const out: { target: ReleaseTarget; arch: ReleaseArch[] }[] = []
  for (const a of RELEASE_ARTIFACTS) {
    if (a.os !== os) continue
    const entry = out.find((t) => t.target === a.target)
    if (entry) entry.arch.push(a.arch)
    else out.push({ target: a.target, arch: [a.arch] })
  }
  return out
}

/** Arquivos do canal do auto-update (`latest*.yml` ou `beta*.yml`) que o release precisa ter. */
export function channelFiles(prerelease: boolean): string[] {
  const channel = prerelease ? 'beta' : 'latest'
  const suffix: Record<ReleaseOs, string> = { mac: '-mac', windows: '', linux: '-linux' }
  const oses = [...new Set(RELEASE_ARTIFACTS.map((a) => a.os))]
  return oses.map((os) => `${channel}${suffix[os]}.yml`)
}

/** O DMG do mac para a arquitetura do computador (outra arquitetura conta como x64). */
export function macDmg(arch: string): ReleaseArtifact | null {
  const wanted: ReleaseArch = arch === 'arm64' ? 'arm64' : 'x64'
  return RELEASE_ARTIFACTS.find((a) => a.target === 'dmg' && a.arch === wanted) ?? null
}
