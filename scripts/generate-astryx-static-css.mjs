/**
 * Gera, como arquivo estático, o CSS que a Astryx injetaria em runtime via <style> nas
 * camadas (Layer: popovers, tooltips). A CSP de produção bloqueia <style> injetado; com o
 * arquivo carregado no index.html com o mesmo id, `ensureSlideRules` não injeta nada.
 *
 *   pnpm astryx:static-css   (rode de novo depois de atualizar @astryxdesign/core)
 *
 * test/astryx-static-css.test.ts falha se o arquivo divergir da versão instalada.
 */
import { writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// O pacote não exporta este caminho: lemos o arquivo instalado diretamente.
const slideRules = await import(
  pathToFileURL(resolve(root, 'node_modules/@astryxdesign/core/dist/Layer/layerSlideRules.js')).href
)

const out = resolve(root, 'src/renderer/public', `${slideRules.SLIDE_RULES_ID}.css`)
writeFileSync(
  out,
  `/* Gerado por scripts/generate-astryx-static-css.mjs — não editar. */\n${slideRules.slideRulesCss()}\n`
)
console.log(`Escrito ${out}`)
