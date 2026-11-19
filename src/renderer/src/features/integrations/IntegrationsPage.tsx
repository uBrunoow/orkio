import type { ConnectionStatus } from '../../../../shared/ipc-contract'
import { OrkioLogo } from '../../components/OrkioLogo/OrkioLogo'
import { GitHubConnectionCard } from './GitHubConnectionCard'
import { NotionConnectionCard } from './NotionConnectionCard'
import { useGitHubConnection } from './useGitHubConnection'
import { useNotionConnection } from './useNotionConnection'

export function IntegrationsPage(): React.JSX.Element {
  const notion = useNotionConnection()
  const github = useGitHubConnection()
  const nothingConnected = [notion.status, github.status].every(isEmpty)

  return (
    <div className="page page--wide">
      <header className="page__header">
        <h1 className="page__title">Integrações</h1>
        <p className="page__subtitle">
          Conecte as ferramentas que o Orkio usa para planejar e executar o desenvolvimento.
        </p>
      </header>

      {nothingConnected && (
        <section className="empty-hero" aria-labelledby="empty-hero-title">
          <OrkioLogo variant="full" size={88} />
          <div>
            <p className="slogan">Do contexto ao commit</p>
            <h2 className="display-title" id="empty-hero-title">
              Conecte suas ferramentas
            </h2>
            <p className="muted">
              Notion para o planejamento, GitHub para o código. O Orkio liga os dois.
            </p>
          </div>
        </section>
      )}

      <div className="integrations-grid">
        <NotionConnectionCard notion={notion} />
        <GitHubConnectionCard github={github} />
      </div>
    </div>
  )
}

/**
 * Sem conexão nem credencial salva. Enquanto carrega (`null`), não conta como vazio,
 * para o destaque não "piscar".
 */
function isEmpty(status: ConnectionStatus | null): boolean {
  if (status === null || status.state === 'connected') return false
  return !(status.state === 'error' && status.hasStoredCredentials)
}
