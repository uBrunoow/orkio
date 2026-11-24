import { memo } from 'react'
import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

/** Links do texto passam pela lista de endereços permitidos do main. */
function openLink(href: string | undefined): void {
  if (href) void window.orkio.openExternal(href)
}

const COMPONENTS: Components = {
  // Texto de terceiros (comentários de PR): imagem remota avisaria o endereço ao abrir a tela.
  // Vira o texto alternativo; nada é carregado.
  img: ({ alt }) => (
    <span className="text-muted-foreground">{alt ? `[imagem: ${alt}]` : '[imagem]'}</span>
  ),
  h1: ({ children }) => <h4 className="mt-3 mb-1 text-sm font-semibold">{children}</h4>,
  h2: ({ children }) => <h4 className="mt-3 mb-1 text-sm font-semibold">{children}</h4>,
  h3: ({ children }) => <h5 className="mt-3 mb-1 text-sm font-medium">{children}</h5>,
  h4: ({ children }) => (
    <h5 className="mt-2 mb-1 text-[12.5px] font-medium text-muted-foreground">{children}</h5>
  ),
  h5: ({ children }) => <h6 className="mt-2 mb-1 text-xs font-medium">{children}</h6>,
  h6: ({ children }) => <h6 className="mt-2 mb-1 text-xs font-medium">{children}</h6>,
  p: ({ children }) => <p className="my-1.5 leading-relaxed">{children}</p>,
  ul: ({ children }) => <ul className="my-1.5 list-disc pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-1.5 list-decimal pl-5">{children}</ol>,
  li: ({ children }) => <li className="py-0.5">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-brand pl-3 text-muted-foreground">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-3 border-border-soft" />,
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto rounded-md border border-border-soft">
      <table className="w-full text-xs">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border-b border-border-soft px-2 py-1 text-left font-medium text-muted-foreground">
      {children}
    </th>
  ),
  td: ({ children }) => <td className="border-b border-border-soft px-2 py-1">{children}</td>,
  a: ({ href, children }) => (
    <a
      href={href}
      className="text-brand-tint-foreground underline-offset-2 hover:underline"
      onClick={(e) => {
        e.preventDefault()
        openLink(href)
      }}
    >
      {children}
    </a>
  ),
  pre: ({ children }) => <pre className="orkio-codeblock my-2">{children}</pre>,
  code: ({ children, className }) =>
    className ? (
      <code>{children}</code>
    ) : (
      <code className="rounded-sm bg-muted px-1 py-px font-mono text-[0.92em]">{children}</code>
    )
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
    <div className="min-w-0 text-sm break-words">
      <Markdown remarkPlugins={[remarkGfm]} components={COMPONENTS} skipHtml>
        {text}
      </Markdown>
    </div>
  )
})
