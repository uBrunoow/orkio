import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { CheckboxField, RadioListField, TextField } from '@/components/form'
import { Spinner } from '@/components/Spinner'
import type {
  CreateProjectInput,
  ProjectError,
  ProjectMutationResult,
  ProjectSelection
} from '../../../../shared/ipc-contract'
import { Alert } from '../../components/Alert'
import { ActionLink } from './ActionLink'

const mono = 'font-mono text-xs text-muted-foreground'

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
  const needsConfirmation = candidate.hostKind !== 'github'
  const isFork = selection.candidates.some((c) => c.remoteName === 'upstream')

  function chooseRemote(next: string): void {
    const chosen = selection.candidates.find((c) => c.remoteName === next)
    if (!chosen) return
    setRemoteName(chosen.remoteName)
    setConfirmed(false)
    setError(null)
    if (!nameEdited) setName(chosen.name)
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
    <section
      aria-labelledby="add-project-title"
      className="flex flex-col gap-4 rounded-xl border border-border-soft bg-card p-5"
    >
      <div className="flex flex-col gap-1">
        <h2 id="add-project-title" className="text-base font-medium">
          Adicionar projeto
        </h2>
        <p>
          <code className={mono}>{selection.rootPath}</code>
        </p>
      </div>

      {selection.resolvedFromSubfolder && (
        <Alert tone="warning">
          Você escolheu uma subpasta. O Orkio vai usar a raiz do repositório:{' '}
          <code className="font-mono text-xs">{selection.folderName}</code>.
        </Alert>
      )}

      <p className="text-sm text-muted-foreground">
        Branch atual: <code className={mono}>{selection.branch ?? '(detached HEAD)'}</code>
        {selection.dirty && ' · com alterações não commitadas'}
      </p>

      {selection.candidates.length > 1 ? (
        <RadioListField
          label="Qual repositório o Orkio deve acompanhar?"
          value={remoteName}
          onChange={chooseRemote}
          {...(isFork
            ? {
                description:
                  'Parece um fork: “origin” é a sua cópia e “upstream” o repositório original.'
              }
            : {})}
          options={selection.candidates.map((c) => ({
            value: c.remoteName,
            label: `${c.remoteName} — ${c.owner}/${c.name} (${c.host})`,
            disabled: saving
          }))}
        />
      ) : (
        <p className="text-sm">
          Repositório:{' '}
          <span className="font-medium">
            {candidate.owner}/{candidate.name}
          </span>{' '}
          <span className="text-xs text-muted-foreground">
            ({candidate.remoteName} · {candidate.host})
          </span>
        </p>
      )}

      {needsConfirmation && (
        <CheckboxField
          checked={confirmed}
          onChange={(checked) => setConfirmed(checked)}
          disabled={saving}
          label={
            candidate.hostKind === 'ssh-alias'
              ? `Confirmo que ${candidate.host} é um alias do meu ~/.ssh/config para o github.com.`
              : `Confirmo que ${candidate.host} é um GitHub Enterprise.`
          }
          {...(candidate.hostKind === 'enterprise'
            ? {
                description:
                  'O Orkio ainda não verifica repositórios do GitHub Enterprise: o projeto fica como “não verificado”.'
              }
            : {})}
        />
      )}

      <TextField
        label="Nome no Orkio"
        value={name}
        onChange={(value) => {
          setName(value.slice(0, 80))
          setNameEdited(true)
        }}
        disabled={saving}
        className="max-w-sm"
      />

      {error && (
        <Alert
          tone="danger"
          {...(error.action ? { action: <ActionLink action={error.action} /> } : {})}
        >
          {error.message}
        </Alert>
      )}

      <div className="flex gap-2">
        <Button
          disabled={saving || (needsConfirmation && !confirmed)}
          onClick={() => void submit()}
        >
          {saving && <Spinner />}
          {saving ? 'Verificando no GitHub…' : 'Adicionar projeto'}
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={saving}>
          Cancelar
        </Button>
      </div>
    </section>
  )
}
