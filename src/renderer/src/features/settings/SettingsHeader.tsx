import { cn } from '@/lib/utils'

/**
 * "Vale para: …" no topo de cada seção de Configurações: a quem a mudança vale (este computador,
 * todos os projetos, o projeto X...). A coluna (`SettingsLayout`) põe acima do h1 da seção, igual
 * em todas; telas com cabeçalho próprio (Skills, MCP, Segredos) podem usar este mesmo componente.
 */
export function ScopeNote({
  scope,
  className
}: {
  scope: string
  className?: string
}): React.JSX.Element {
  return (
    <p data-testid="settings-scope" className={cn('text-xs text-subtle-foreground', className)}>
      Vale para: <span className="text-muted-foreground">{scope}</span>
    </p>
  )
}
