import { Button } from '@/components/ui/button'
import { Alert } from './Alert'
import type { ResultError } from '../../../shared/result'

/** O erro se resolve em Integrações: o main disse (`fixAt`) ou é reconectar o Notion. */
export function fixesInIntegrations(error: Pick<ResultError, 'fixAt' | 'canReconnect'>): boolean {
  return error.fixAt === 'integrations' || error.canReconnect === true
}

/**
 * Erro de uma chamada ao main com a saída dele: fora de Integrações, "Ir para Integrações" quando
 * é lá que se resolve; dentro, "Reconectar com Notion" quando reconectar resolve.
 */
export function ErrorAlert({
  error,
  tone = 'danger',
  onOpenIntegrations,
  onReconnect
}: {
  error: ResultError
  tone?: 'danger' | 'warning'
  onOpenIntegrations?: (() => void) | undefined
  onReconnect?: (() => Promise<unknown>) | undefined
}): React.JSX.Element {
  const action =
    onReconnect && error.canReconnect ? (
      <Button size="sm" variant="outline" onClick={() => void onReconnect()}>
        Reconectar com Notion
      </Button>
    ) : onOpenIntegrations && fixesInIntegrations(error) ? (
      <Button size="sm" variant="ghost" onClick={onOpenIntegrations}>
        Ir para Integrações
      </Button>
    ) : null
  return (
    <Alert tone={tone} {...(action ? { action } : {})}>
      {error.message}
    </Alert>
  )
}
