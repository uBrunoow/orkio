import { useId, useState } from 'react'
import type {
  CreateProjectInput,
  ProjectError,
  ProjectMutationResult,
  ProjectSelection,
  RemoteCandidate
} from '../../../../shared/ipc-contract'
import { Alert } from '../../components/Alert'
import { ActionLink } from './ActionLink'

/** Segundo passo do "Adicionar projeto": confirma remote, host e nome. */
export function AddProjectPanel({
  selection,
  onCreate,
  onCancel
}: {
  selection: ProjectSelection
  onCreate(input: CreateProjectInput): Promise<ProjectMutationResult>
  onCancel(): void
}): React.JSX.Element {
  const [remoteName, setRemoteName] = useState(selection.suggestedRemote)
  const [confirmed, setConfirmed] = useState(false)
  const candidate =
    selection.candidates.find((c) => c.remoteName === remoteName) ?? selection.candidates[0]!
  const [name, setName] = useState(candidate.name)
  const [nameEdited, setNameEdited] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<ProjectError | null>(null)
  const nameId = useId()
  const needsConfirmation = candidate.hostKind !== 'github'

  function chooseRemote(next: RemoteCandidate): void {
    setRemoteName(next.remoteName)
    setConfirmed(false)
    setError(null)
    if (!nameEdited) setName(next.name)
  }

  async function submit(): Promise<void> {
    setSaving(true)
    setError(null)
    const result = await onCreate({
      selectionId: selection.selectionId,
      remoteName,
      hostConfirmed: confirmed,
      name
    })
    setSaving(false)
    if (!result.ok && !result.cancelled) setError(result.error)
  }

  return (
    <section className="card add-project" aria-labelledby="add-project-title">
      <header className="card__header">
        <div>
          <h2 className="card__title" id="add-project-title">
            Adicionar projeto
          </h2>
          <p className="card__description mono">{selection.rootPath}</p>
        </div>
      </header>

      <div className="card__body">
        {selection.resolvedFromSubfolder && (
          <Alert tone="warning">
            Você escolheu uma subpasta. O Orkio vai usar a raiz do repositório:{' '}
            <span className="mono">{selection.folderName}</span>.
          </Alert>
        )}

        <p className="muted">
          Branch atual: <span className="mono">{selection.branch ?? '(detached HEAD)'}</span>
          {selection.dirty && ' · com alterações não commitadas'}
        </p>

        {selection.candidates.length > 1 && (
          <fieldset className="remote-choice">
            <legend className="field__label">Qual repositório o Orkio deve acompanhar?</legend>
            {selection.candidates.some((c) => c.remoteName === 'upstream') && (
              <p className="field__hint">
                Parece um fork: “origin” é a sua cópia e “upstream” o repositório original.
              </p>
            )}
            {selection.candidates.map((c) => (
              <label key={c.remoteName} className="remote-choice__option">
                <input
                  type="radio"
                  name="remote"
                  checked={c.remoteName === remoteName}
                  onChange={() => chooseRemote(c)}
                  disabled={saving}
                />
                <span>
                  <span className="mono">{c.remoteName}</span> —{' '}
                  <strong>
                    {c.owner}/{c.name}
                  </strong>{' '}
                  <span className="muted">({c.host})</span>
                </span>
              </label>
            ))}
          </fieldset>
        )}

        {selection.candidates.length === 1 && (
          <p>
            Repositório:{' '}
            <strong>
              {candidate.owner}/{candidate.name}
            </strong>{' '}
            <span className="muted">
              ({candidate.remoteName} · {candidate.host})
            </span>
          </p>
        )}

        {needsConfirmation && (
          <label className="confirm-host">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              disabled={saving}
            />
            <span>
              {candidate.hostKind === 'ssh-alias' ? (
                <>
                  Confirmo que <span className="mono">{candidate.host}</span> é um alias do meu
                  ~/.ssh/config para o github.com.
                </>
              ) : (
                <>
                  Confirmo que <span className="mono">{candidate.host}</span> é um GitHub
                  Enterprise.
                  <span className="field__hint">
                    {' '}
                    O Orkio ainda não verifica repositórios do GitHub Enterprise: o projeto fica
                    como “não verificado”.
                  </span>
                </>
              )}
            </span>
          </label>
        )}

        <div className="field">
          <label className="field__label" htmlFor={nameId}>
            Nome no Orkio
          </label>
          <input
            id={nameId}
            className="input input--text"
            value={name}
            maxLength={80}
            onChange={(e) => {
              setName(e.target.value)
              setNameEdited(true)
            }}
            disabled={saving}
          />
        </div>

        {error && (
          <Alert tone="danger">
            {error.message}
            {error.action && <ActionLink action={error.action} />}
          </Alert>
        )}

        <div className="card__actions">
          <button
            type="button"
            className="button button--primary"
            onClick={() => void submit()}
            disabled={saving || (needsConfirmation && !confirmed)}
          >
            {saving && <span className="spinner" aria-hidden="true" />}
            {saving ? 'Verificando no GitHub…' : 'Adicionar projeto'}
          </button>
          <button type="button" className="button" onClick={onCancel} disabled={saving}>
            Cancelar
          </button>
        </div>
      </div>
    </section>
  )
}
