import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  SLIDE_RULES_ID,
  slideRulesCss
} from '../node_modules/@astryxdesign/core/dist/Layer/layerSlideRules.js'

/**
 * A Astryx injeta este CSS via <style> em runtime, o que a CSP de produção bloqueia. O Orkio o
 * entrega como arquivo estático com o mesmo id; este teste falha se o arquivo divergir da
 * versão instalada da Astryx (rode `pnpm astryx:static-css`).
 */
describe('CSS estático das camadas da Astryx', () => {
  const root = join(__dirname, '..')

  it('arquivo gerado bate com a versão instalada', () => {
    const file = readFileSync(join(root, 'src/renderer/public', `${SLIDE_RULES_ID}.css`), 'utf8')
    expect(file).toContain(slideRulesCss())
  })

  it('index.html carrega o arquivo com o id que a Astryx procura', () => {
    const html = readFileSync(join(root, 'src/renderer/index.html'), 'utf8')
    expect(html).toContain(
      `<link id="${SLIDE_RULES_ID}" rel="stylesheet" href="./${SLIDE_RULES_ID}.css" />`
    )
  })
})
