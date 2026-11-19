import { IntegrationsPage } from './features/integrations/IntegrationsPage'

export function App(): React.JSX.Element {
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand__mark" aria-hidden="true">
            O
          </span>
          Orkio
        </div>
        <nav className="nav" aria-label="Navegação principal">
          <span className="nav__label">Configurações</span>
          <span className="nav__item nav__item--active" aria-current="page">
            Integrações
          </span>
        </nav>
      </aside>
      <main className="main">
        <IntegrationsPage />
      </main>
    </div>
  )
}
