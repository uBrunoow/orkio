/** Cabeçalho dos cartões de configuração (conexões, Claude Code, bancos): ícone, título/descrição e status. */
export function PanelHeader({
  titleId,
  title,
  description,
  icon,
  badge
}: {
  titleId: string
  title: string
  description: string
  icon: React.ReactNode
  badge: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-3">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-border-soft bg-muted text-foreground">
        {icon}
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <h2 id={titleId} className="text-sm font-medium text-foreground">
          {title}
        </h2>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      {/* O status mantém o tamanho natural (não é truncado). */}
      <div className="shrink-0">{badge}</div>
    </div>
  )
}
