import { OrkioLogo } from '../../components/OrkioLogo/OrkioLogo'
import { NotionConnectionCard } from './NotionConnectionCard'
import { useNotionConnection, type UseNotionConnection } from './useNotionConnection'

export function IntegrationsPage(): React.JSX.Element {
  const notion = useNotionConnection()

  return (
    <div className="page">
      <header className="page__header">
        <h1 className="page__title">Integrações</h1>
        <p className="page__subtitle">
          Conecte as ferramentas que o Orkio usa para planejar e executar o desenvolvimento.
        </p>
      </header>

      {isNothingConnected(notion) && (
        <section className="empty-hero" aria-labelledby="empty-hero-title">
          <OrkioLogo variant="full" size={88} />
          <div>
            <p className="slogan">Do contexto ao commit</p>
            <h2 className="display-title" id="empty-hero-title">
              Conecte sua primeira ferramenta
            </h2>
            <p className="muted">Comece pelo Notion: é de lá que o Orkio vai ler o planejamento.</p>
          </div>
        </section>
      )}

      <NotionConnectionCard notion={notion} />
    </div>
  )
}

/** Nenhuma integração conectada (nem com credencial salva). Enquanto carrega, não mostramos nada. */
function isNothingConnected({ status }: UseNotionConnection): boolean {
  if (status === null || status.state === 'connected') return false
  return !(status.state === 'error' && status.hasStoredCredentials)
}
