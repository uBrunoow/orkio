import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * A CSP de produção não aceita `<style>` em runtime. Partes do Radix (base do shadcn/ui) injetam
 * estilo: o Select e a ScrollArea sempre; Dialog/DropdownMenu/Popover no modo modal (via
 * react-remove-scroll). Este teste trava os usos no código do renderer; o E2E pega o resto
 * (`securitypolicyviolation`).
 */
const ROOT = join(import.meta.dirname, '..', 'src', 'renderer', 'src')

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return files(full)
    return /\.tsx?$/.test(name) && !name.endsWith('.test.ts') ? [full] : []
  })
}

/** Código sem comentários (os comentários explicam justamente o que é proibido). */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

const sources = files(ROOT).map((f) => ({
  file: relative(ROOT, f),
  text: code(readFileSync(f, 'utf8'))
}))

describe('renderer sem estilos injetados em runtime', () => {
  it('não usa o Select nem a ScrollArea do Radix', () => {
    const bad = sources.filter(({ text }) =>
      /\b(Select|ScrollArea)\s+as\s+\w+Primitive\b|@radix-ui\/react-(select|scroll-area)/.test(text)
    )
    expect(bad.map((s) => s.file)).toEqual([])
  })

  it('nunca liga o modo modal (react-remove-scroll injeta <style>)', () => {
    const bad = sources.filter(({ text }) => /\bmodal(=\{true\}|\s*=\s*true|\s*:\s*true)/.test(text))
    expect(bad.map((s) => s.file)).toEqual([])
  })

  it('os wrappers do shadcn forçam modal={false}', () => {
    const dialog = sources.find((s) => s.file === join('components', 'ui', 'dialog.tsx'))
    const menu = sources.find((s) => s.file === join('components', 'ui', 'dropdown-menu.tsx'))
    expect(dialog?.text).toContain('modal={false}')
    expect(menu?.text).toContain('modal = false')
  })

  it('sem <style>, dangerouslySetInnerHTML nem a Astryx', () => {
    const bad = sources.filter(({ text }) =>
      /<style\b|dangerouslySetInnerHTML|@astryxdesign\//.test(text)
    )
    expect(bad.map((s) => s.file)).toEqual([])
  })
})
