import { useEffect, useState } from 'react'
import type {
  ProjectError,
  ProjectHealthState,
  ProjectSelection,
  ProjectView
} from '../../../../shared/ipc-contract'
import { Alert } from '../../components/Alert'
import { ActionLink } from './ActionLink'
import { AddProjectPanel } from './AddProjectPanel'
import { useProjects } from './useProjects'

const HEALTH: Record<
  ProjectHealthState,
  { label: string; tone: '' | 'success' | 'warning' | 'danger' }
> = {
  checking: { label: 'Verificando…', tone: '' },
  ok: { label: 'OK', tone: 'success' },
  missing_folder: { label: 'Pasta não encontrada', tone: 'danger' },
  not_a_repo: { label: 'Não é repositório', tone: 'danger' },
  repo_mismatch: { label: 'Outro repositório', tone: 'danger' },
  no_access: { label: 'Sem acesso', tone: 'danger' },
  github_disconnected: { label: 'GitHub desconectado', tone: 'warning' },
  unverified: { label: 'Não verificado', tone: 'warning' },
  git_error: { label: 'Erro do git', tone: 'danger' }
}

export function ProjectsPage({
  onOpenIntegrations
}: {
  onOpenIntegrations(): void
}): React.JSX.Element {
  const projects = useProjects()
  const [picking, setPicking] = useState(false)
  const [selection, setSelection] = useState<ProjectSelection | null>(null)
  const [pickError, setPickError] = useState<ProjectError | null>(null)
  const githubConnected = useGitHubConnected()

  async function addProject(): Promise<void> {
    setPicking(true)
    setPickError(null)
    const result = await projects.pickFolder()
    setPicking(false)
    if (result.ok) setSelection(result.selection)
    else if (!result.cancelled) setPickError(result.error)
  }

  const list = projects.projects

  return (
    <div className="page page--wide">
      <header className="page__header page__header--row">
        <div>
          <h1 className="page__title">Projetos</h1>
          <p className="page__subtitle">
            Pastas locais ligadas a repositórios do GitHub. O Orkio acompanha a branch atual.
          </p>
        </div>
        <button
          type="button"
          className="button button--primary"
          onClick={() => void addProject()}
          disabled={picking || selection !== null}
        >
          {picking && <span className="spinner" aria-hidden="true" />}
          {picking ? 'Analisando pasta…' : 'Adicionar projeto'}
        </button>
      </header>

      <div className="stack">
        {projects.warning && <Alert tone="warning">{projects.warning}</Alert>}

        {githubConnected === false && (
          <Alert tone="warning">
            Conecte sua conta do GitHub para adicionar e verificar projetos.{' '}
            <button type="button" className="link-button action-link" onClick={onOpenIntegrations}>
              Ir para Integrações
            </button>
          </Alert>
        )}

        {pickError && (
          <Alert tone="danger">
            {pickError.message}
            {pickError.action && <ActionLink action={pickError.action} />}
          </Alert>
        )}

        {selection && (
          <AddProjectPanel
            key={selection.selectionId}
            selection={selection}
            onCreate={async (input) => {
              const result = await projects.create(input)
              if (result.ok) setSelection(null)
              return result
            }}
            onCancel={() => setSelection(null)}
          />
        )}

        {list === null ? (
          <div className="project-list" aria-label="Carregando projetos">
            <div className="skeleton skeleton--row" />
            <div className="skeleton skeleton--row" />
          </div>
        ) : list.length === 0 ? (
          !selection && (
            <section className="empty-state" aria-labelledby="projects-empty-title">
              <h2 className="empty-state__title" id="projects-empty-title">
                Nenhum projeto ainda
              </h2>
              <p className="muted">
                Escolha a pasta de um repositório clonado no seu computador. O Orkio detecta o
                repositório do GitHub automaticamente.
              </p>
            </section>
          )
        ) : (
          <ul className="project-list" aria-label="Projetos" aria-busy={projects.revalidating}>
            {list.map((project) => (
              <ProjectRow
                key={project.id}
                project={project}
                onRelocate={() => projects.relocate(project.id)}
                onRemove={() => projects.remove(project.id)}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function ProjectRow({
  project,
  onRelocate,
  onRemove
}: {
  project: ProjectView
  onRelocate(): Promise<unknown>
  onRemove(): Promise<boolean>
}): React.JSX.Element {
  const [busy, setBusy] = useState<'relocate' | 'remove' | null>(null)
  const [confirmingRemove, setConfirmingRemove] = useState(false)
  const [relocateError, setRelocateError] = useState<ProjectError | null>(null)
  const health = HEALTH[project.health.state]
  const folderProblem =
    project.health.state === 'missing_folder' ||
    project.health.state === 'not_a_repo' ||
    project.health.state === 'repo_mismatch'

  async function relocate(): Promise<void> {
    setBusy('relocate')
    setRelocateError(null)
    const result = (await onRelocate()) as
      { ok: true } | { ok: false; cancelled: boolean; error?: ProjectError }
    setBusy(null)
    if (!result.ok && !result.cancelled && result.error) setRelocateError(result.error)
  }

  return (
    <li className="project" aria-label={project.name}>
      <div className="project__main">
        <div className="project__title-row">
          <h3 className="project__name">{project.name}</h3>
          <span
            className={`badge${health.tone ? ` badge--${health.tone}` : ''}`}
            data-health={project.health.state}
          >
            {health.label}
          </span>
        </div>
        <div className="project__meta">
          {project.repo && (
            <span>
              {project.repo.owner}/{project.repo.name}
            </span>
          )}
          {project.local && (
            <>
              <span className="project__branch mono" title="Branch atual">
                {project.local.branch ?? '(detached HEAD)'}
              </span>
              {project.local.dirty && (
                <span className="project__dirty" title="Há alterações não commitadas">
                  ● alterações não commitadas
                </span>
              )}
            </>
          )}
        </div>
        <div className="project__path mono">{project.localPath}</div>

        {project.health.message && project.health.state !== 'ok' && (
          <p className={`project__message project__message--${health.tone || 'neutral'}`}>
            {project.health.message}
            {project.health.action && <ActionLink action={project.health.action} />}
          </p>
        )}
        {project.notices.map((notice) => (
          <p key={notice.code} className="project__message project__message--warning">
            {notice.message}
          </p>
        ))}
        {relocateError && (
          <Alert tone="danger">
            {relocateError.message}
            {relocateError.action && <ActionLink action={relocateError.action} />}
          </Alert>
        )}
      </div>

      <div className="project__actions">
        <button
          type="button"
          className={`button${folderProblem ? ' button--primary' : ''}`}
          onClick={() => void relocate()}
          disabled={busy !== null}
        >
          {busy === 'relocate' ? 'Escolhendo…' : 'Reapontar pasta'}
        </button>
        {confirmingRemove ? (
          <span
            className="confirm"
            role="group"
            aria-label={`Confirmar remoção de ${project.name}`}
          >
            <span>Remover do Orkio? Nenhum arquivo será apagado.</span>
            <button type="button" className="button" onClick={() => setConfirmingRemove(false)}>
              Cancelar
            </button>
            <button
              type="button"
              className="button button--danger-solid"
              onClick={() => {
                setBusy('remove')
                void onRemove().finally(() => {
                  setBusy(null)
                  setConfirmingRemove(false)
                })
              }}
              disabled={busy !== null}
              autoFocus
            >
              Remover
            </button>
          </span>
        ) : (
          <button
            type="button"
            className="button button--danger"
            onClick={() => setConfirmingRemove(true)}
            disabled={busy !== null}
          >
            Remover
          </button>
        )}
      </div>
    </li>
  )
}

/** `null` enquanto carrega. Só para a dica "conecte o GitHub". */
function useGitHubConnected(): boolean | null {
  const [connected, setConnected] = useState<boolean | null>(null)
  useEffect(() => {
    let active = true
    void window.orkio.github
      .getStatus()
      .then((status) => {
        if (active) setConnected(status.state === 'connected' || status.state === 'error')
      })
      .catch(() => {
        if (active) setConnected(null)
      })
    return () => {
      active = false
    }
  }, [])
  return connected
}
