/**
 * O xterm.js sob a CSP estrita do Orkio (`style-src 'self'`, sem `'unsafe-inline'`).
 *
 * O xterm cria `<style>` em runtime (barra de rolagem do Viewport; tema e medidas do renderizador
 * DOM) e, no renderizador DOM, cores 24 bits com `setAttribute('style', …)`. A CSP bloquearia os
 * dois (e o E2E falha com qualquer violação). Enquanto um terminal está montado, e só então:
 * - `document.createElement('style')` devolve um elemento nosso que aplica o CSS por uma folha
 *   construída (`CSSStyleSheet` + `adoptedStyleSheets`, que a CSP não bloqueia);
 * - `setAttribute('style', v)` vira `el.style.cssText = v` (CSSOM, o mesmo que o React faz).
 * Ao desmontar o último terminal, tudo volta ao normal. O WebGL (padrão) não usa o renderizador
 * DOM; ele só entra se o WebGL faltar.
 */

const TAG = 'orkio-xterm-style'

class XtermStyle extends HTMLElement {
  private readonly sheet = new CSSStyleSheet()
  private css = ''

  connectedCallback(): void {
    const doc = this.ownerDocument
    if (!doc.adoptedStyleSheets.includes(this.sheet)) {
      doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, this.sheet]
    }
  }

  disconnectedCallback(): void {
    const doc = this.ownerDocument
    doc.adoptedStyleSheets = doc.adoptedStyleSheets.filter((s) => s !== this.sheet)
  }

  override get textContent(): string {
    return this.css
  }

  override set textContent(value: string | null) {
    this.css = value ?? ''
    try {
      this.sheet.replaceSync(this.css)
    } catch {
      // CSS inválido: o terminal segue sem esse pedaço.
    }
  }
}

let mounted = 0
let restore: (() => void) | null = null

function install(): () => void {
  if (!customElements.get(TAG)) customElements.define(TAG, XtermStyle)
  const doc = document
  const original = Document.prototype.createElement
  const patchedCreate = function (
    this: Document,
    tagName: string,
    options?: ElementCreationOptions
  ): HTMLElement {
    if (typeof tagName === 'string' && tagName.toLowerCase() === 'style') {
      return original.call(this, TAG)
    }
    return original.call(this, tagName, options)
  }
  Object.defineProperty(doc, 'createElement', {
    value: patchedCreate,
    configurable: true,
    writable: true
  })
  const originalSet = Element.prototype.setAttribute
  Element.prototype.setAttribute = function (this: Element, name: string, value: string): void {
    if (name.toLowerCase() === 'style' && this instanceof HTMLElement) {
      this.style.cssText = value
      return
    }
    originalSet.call(this, name, value)
  }
  return () => {
    delete (doc as { createElement?: unknown }).createElement
    Element.prototype.setAttribute = originalSet
  }
}

/** Um terminal vai montar: liga o ajuste (contado). Devolve o "desmontou". */
export function acquireXtermCsp(): () => void {
  if (mounted === 0) restore = install()
  mounted++
  let released = false
  return () => {
    if (released) return
    released = true
    mounted--
    if (mounted === 0 && restore) {
      restore()
      restore = null
    }
  }
}
