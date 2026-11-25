import { cn } from '@/lib/utils'

/**
 * "Vale para: …" no topo de cada seção de Configurações: a quem a mudança vale (este computador,
 * todos os projetos, o projeto X...). A coluna (`SettingsLayout`) põe acima do h1 da seção, igual
 * em todas; telas com cabeçalho próprio (Skills, MCP, Segredos) podem usar este mesmo componente.
 */
export function ScopeNote({
  scope,
  picker,
  className
}: {
  scope: string
  /** Telas por projeto: o seletor do projeto no lugar do nome (não muda o projeto atual). */
  picker?: React.ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <div
      data-testid="settings-scope"
      className={cn('flex items-center gap-2 text-xs text-subtle-foreground', className)}
    >
      Vale para: {picker ?? <span className="text-muted-foreground">{scope}</span>}
    </div>
  )
}
