import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MarkdownText } from './MarkdownText'

describe('MarkdownText', () => {
  it('imagem de terceiros vira texto: nenhum <img> (nada é carregado)', () => {
    const html = renderToStaticMarkup(
      createElement(MarkdownText, {
        text: 'veja ![print](https://evil.example/p.png) e <img src="https://evil.example/x.png">'
      })
    )
    expect(html).not.toContain('<img')
    expect(html).not.toContain('evil.example')
    expect(html).toContain('[imagem: print]')
  })
})
