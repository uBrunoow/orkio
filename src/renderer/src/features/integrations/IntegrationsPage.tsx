import { NotionConnectionCard } from './NotionConnectionCard'

export function IntegrationsPage(): React.JSX.Element {
  return (
    <div className="page">
      <header className="page__header">
        <h1 className="page__title">Integrações</h1>
        <p className="page__subtitle">
          Conecte as ferramentas que o Orkio usa para planejar e executar o desenvolvimento.
        </p>
      </header>
      <NotionConnectionCard />
    </div>
  )
}
