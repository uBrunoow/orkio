import { ScreenTitle } from './ScreenTitle'

/**
 * Cabeçalho da seção (o único h1, 18 px como no mockup): título, uma linha de descrição e ações à
 * direita (no máximo uma primária). O projeto vai no caminho da barra, não aqui.
 */
export function PageHeader({
  title,
  subtitle,
  action
}: {
  title: string
  subtitle?: string
  action?: React.ReactNode
}): React.JSX.Element {
  return (
    <header className="flex flex-wrap items-end gap-3">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <ScreenTitle look={3}>{title}</ScreenTitle>
        {subtitle && <p className="text-[12.5px] text-muted-foreground">{subtitle}</p>}
      </div>
      {action && <div className="flex items-center gap-2">{action}</div>}
    </header>
  )
}
