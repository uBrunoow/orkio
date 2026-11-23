/**
 * Gera os ícones do app a partir de brand/orkio-app-icon-1024.png.
 *
 *   pnpm icons
 *
 * Saídas:
 *   build/icon.icns     macOS (electron-builder)
 *   build/icon.ico      Windows (electron-builder)
 *   build/icon.png      Linux (fonte; 1024×1024)
 *   build/icons/NxN.png Linux: um PNG por tamanho do tema hicolor (16 a 512). O GNOME só procura
 *                       até 512×512; com só o 1024 o atalho aparecia sem ícone.
 *   resources/icon.png  ícone da janela em runtime (BrowserWindow / dock em dev)
 *
 * Usa png2icons (JavaScript puro, sem dependências nativas): roda igual em macOS, Windows e Linux.
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import png2icons from 'png2icons'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = resolve(root, 'brand/orkio-app-icon-1024.png')
const input = readFileSync(source)

// BICUBIC = melhor qualidade de redimensionamento; 0 = sem compressão extra de cores.
const icns = png2icons.createICNS(input, png2icons.BICUBIC, 0)
// usePNG=false gera BMPs para os tamanhos pequenos (compatível com Windows antigos); 256px vai em PNG.
const ico = png2icons.createICO(input, png2icons.BICUBIC, 0, false, true)
if (!icns || !ico) throw new Error('Falha ao gerar ícones a partir de ' + source)

writeFileSync(resolve(root, 'build/icon.icns'), icns)
writeFileSync(resolve(root, 'build/icon.ico'), ico)
copyFileSync(source, resolve(root, 'build/icon.png'))
copyFileSync(source, resolve(root, 'resources/icon.png'))

// Linux: tamanhos do tema hicolor, com o decodificador/redimensionador que o png2icons já traz.
const require = createRequire(import.meta.url)
const UPNG = require('png2icons/lib/UPNG.js')
const resize = require('png2icons/lib/resize2.js')
const decoded = UPNG.decode(input.buffer.slice(input.byteOffset, input.byteOffset + input.length))
const src = {
  width: decoded.width,
  height: decoded.height,
  data: new Uint8ClampedArray(UPNG.toRGBA8(decoded)[0])
}
const linuxDir = resolve(root, 'build/icons')
mkdirSync(linuxDir, { recursive: true })
for (const size of [16, 24, 32, 48, 64, 128, 256, 512]) {
  const dst = { width: size, height: size, data: new Uint8ClampedArray(size * size * 4) }
  resize.bicubicInterpolation(src, dst, null)
  const png = UPNG.encode([dst.data.buffer], size, size, 0)
  writeFileSync(resolve(linuxDir, `${size}x${size}.png`), Buffer.from(png))
}

console.log('Ícones gerados em build/ e resources/')
