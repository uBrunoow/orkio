import { memo } from 'react'
import { Markdown } from '@astryxdesign/core/Markdown'
import { Text } from '@astryxdesign/core/Text'

/**
 * Bloco de código do markdown sem o `CodeBlock` da Astryx (ele injeta `<style>` para o destaque
 * de sintaxe e quebraria a CSP). Texto puro, mono, com quebra de linha.
 */
function CodeFence({ code }: { code: string }): React.JSX.Element {
  return (
    <Text as="div" type="code" className="orkio-codeblock">
      {code}
    </Text>
  )
}
const MARKDOWN_COMPONENTS = { code: CodeFence }

/** Links do texto passam pela lista de endereços permitidos do main. */
function openLink(href: string): false {
  void window.orkio.openExternal(href)
  return false
}

/**
 * Markdown de texto do Claude Code ou de uma task do Backlog: títulos a partir do nível 4 (a tela
 * já tem o h1), espaçamento compacto, código sem destaque e links só pelo `openExternal`.
 */
export const MarkdownText = memo(function MarkdownText({
  text
}: {
  text: string
}): React.JSX.Element {
  return (
    <Markdown
      density="compact"
      headingLevelStart={4}
      components={MARKDOWN_COMPONENTS}
      onLinkClick={openLink}
    >
      {text}
    </Markdown>
  )
})
