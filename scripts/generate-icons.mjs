/**
 * Gera os ícones do app a partir de brand/orkio-app-icon-1024.png.
 *
 *   pnpm icons
 *
 * Saídas:
 *   build/icon.icns     macOS (electron-builder)
 *   build/icon.ico      Windows (electron-builder)
 *   build/icon.png      Linux (electron-builder; 1024×1024)
 *   resources/icon.png  ícone da janela em runtime (BrowserWindow / dock em dev)
 *
 * Usa png2icons (JavaScript puro, sem dependências nativas): roda igual em macOS, Windows e Linux.
 */
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs'
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

console.log('Ícones gerados em build/ e resources/')
