import { useState } from 'react'
import { OrkioLogo } from './components/OrkioLogo/OrkioLogo'
import { IntegrationsPage } from './features/integrations/IntegrationsPage'
import { ProjectsPage } from './features/projects/ProjectsPage'

type Page = 'projects' | 'integrations'

const PAGES: { id: Page; label: string }[] = [
  { id: 'projects', label: 'Projetos' },
  { id: 'integrations', label: 'Integrações' }
]

export function App(): React.JSX.Element {
  const [page, setPage] = useState<Page>('projects')

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <OrkioLogo variant="simple" withWordmark size={26} />
        </div>
        <nav className="nav" aria-label="Navegação principal">
          {PAGES.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`nav__item${page === item.id ? ' nav__item--active' : ''}`}
              aria-current={page === item.id ? 'page' : undefined}
              onClick={() => setPage(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </aside>
      <main className="main">
        {page === 'projects' ? (
          <ProjectsPage onOpenIntegrations={() => setPage('integrations')} />
        ) : (
          <IntegrationsPage />
        )}
      </main>
    </div>
  )
}
