import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const DIST = resolve(__dirname, '..', 'dist')

export interface PackagedApp {
  /** Executável do app. */
  executable: string
  /** Pasta resources (onde ficam app.asar e app.asar.unpacked). */
  resources: string
}

/**
 * Acha o app empacotado em dist/ para o SO atual. `ORKIO_PACKAGED_APP` força o executável
 * (ex.: o app instalado). Lança erro claro se não houver build.
 */
export function findPackagedApp(): PackagedApp {
  const forced = process.env['ORKIO_PACKAGED_APP']
  if (forced) return { executable: forced, resources: resourcesFor(forced) }
  const candidates =
    process.platform === 'darwin'
      ? [
          join(DIST, process.arch === 'arm64' ? 'mac-arm64' : 'mac', 'Orkio.app'),
          join(DIST, 'mac-universal', 'Orkio.app')
        ].map((app) => join(app, 'Contents', 'MacOS', 'Orkio'))
      : process.platform === 'win32'
        ? [join(DIST, 'win-unpacked', 'Orkio.exe'), join(DIST, 'win-arm64-unpacked', 'Orkio.exe')]
        : [join(DIST, 'linux-unpacked', 'orkio'), join(DIST, 'linux-arm64-unpacked', 'orkio')]
  const executable = candidates.find((c) => existsSync(c))
  if (!executable) {
    throw new Error(
      `App empacotado não encontrado em dist/ (procurei: ${candidates.join(', ')}). ` +
        'Rode `pnpm dist:dir` antes ou defina ORKIO_PACKAGED_APP.'
    )
  }
  return { executable, resources: resourcesFor(executable) }
}

function resourcesFor(executable: string): string {
  // macOS: Orkio.app/Contents/MacOS/Orkio → Orkio.app/Contents/Resources
  if (process.platform === 'darwin') return resolve(executable, '..', '..', 'Resources')
  return resolve(executable, '..', 'resources')
}
