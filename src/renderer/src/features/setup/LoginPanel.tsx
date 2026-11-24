import { Button } from '@/components/ui/button'
import { Alert } from '../../components/Alert'
import { GitHubLogo } from '../../components/icons'
import { DeviceFlowView } from '../integrations/DeviceFlowView'
import type { UseConnection } from '../integrations/useConnection'

/**
 * Entrada do app: login com a conta do GitHub pelo Device Flow de Integrações (mesma conexão: o
 * token fica no main, cifrado). Conectar aqui já liga a integração do GitHub; depois o checklist
 * pede o Notion e o projeto. O GitHub é obrigatório: o projeto é verificado nele.
 */
export function LoginPanel({
  github,
  onUseToken
}: {
  github: UseConnection
  onUseToken(): void
}): React.JSX.Element {
  const oauth = github.authOptions?.oauth ?? false
  const error = github.status?.state === 'error' ? github.status.message : null
  return (
    <div role="region" aria-label="Entrar no Orkio" className="flex flex-col gap-4">
      {error && github.activity !== 'authorizing' && <Alert tone="danger">{error}</Alert>}
      {github.activity === 'authorizing' ? (
        <div className="rounded-xl border border-border-soft bg-card p-4">
          <DeviceFlowView flow={github.deviceFlow} onCancel={github.cancelAuthorize} />
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {oauth ? (
            <Button onClick={() => void github.authorize()}>
              <GitHubLogo />
              {error ? 'Tentar de novo' : 'Entrar com GitHub'}
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground">
              Este build não tem o login do GitHub configurado. Conecte com um token.
            </p>
          )}
          <Button variant="outline" onClick={onUseToken}>
            Usar um token
          </Button>
        </div>
      )}
    </div>
  )
}
