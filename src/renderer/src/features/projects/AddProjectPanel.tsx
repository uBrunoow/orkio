import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { CheckboxField, RadioListField, TextField } from '@/components/form'
import { Spinner } from '@/components/Spinner'
import { Alert } from '../../components/Alert'
import { ActionLink } from './ActionLink'
import type {
  CreateProjectInput,
  ProjectError,
  ProjectMutationResult,
  ProjectSelection
} from '../../../../shared/projects'
import { SURFACE } from '../../components/surface'
import { DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { FolderPlusIcon } from '../../components/icons'

const mono = 'font-mono text-xs text-muted-foreground'

/** Erros do GitHub do Orkio em que dá para seguir só com o git e o `gh` desta máquina. */
const GIT_ONLY_FALLBACK = new Set<ProjectError['code']>([
  'github_disconnected',
  'no_access',
  'sso_required',
  'oauth_restricted',
  'github_error'
])

export function AddProjectPanel({
  selection,
  onCreate,
  onCancel,
  bare = false
}: {
  /** Dentro de um modal: sem moldura, título do diálogo e botões à direita. */
  bare?: boolean
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

  async function submit(gitOnly = false): Promise<void> {
    setSaving(true)
    setError(null)
    const result = await onCreate({
      selectionId: selection.selectionId,
      remoteName,
      hostConfirmed: confirmed,
      name,
      ...(gitOnly ? { gitOnly: true } : {})
    })
    setSaving(false)
    if (!result.ok && !result.cancelled) setError(result.error)
  }

  return (
    <section
      {...(bare
        ? { 'aria-label': 'Adicionar projeto', className: 'flex flex-col gap-4' }
        : { 'aria-labelledby': 'add-project-title', className: SURFACE.section })}
    >
      {bare ? (
        <div className="flex items-center gap-3 pr-8">
          <span
            aria-hidden="true"
            className="grid size-9 shrink-0 place-items-center rounded-lg border border-border-soft bg-muted text-muted-foreground"
          >
            <FolderPlusIcon className="size-[18px]" />
          </span>
          <div className="flex min-w-0 flex-col">
            <DialogTitle className="text-base font-medium">Adicionar projeto</DialogTitle>
            <DialogDescription asChild>
              <code className={cn(mono, 'truncate')}>{selection.rootPath}</code>
            </DialogDescription>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          <h2 id="add-project-title" className="text-base font-medium">
            Adicionar projeto
          </h2>
          <p>
            <code className={mono}>{selection.rootPath}</code>
          </p>
        </div>
      )}

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
      {error && GIT_ONLY_FALLBACK.has(error.code) && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border-soft bg-card px-3 py-2.5">
          <p className="min-w-0 flex-1 text-xs text-muted-foreground">
            Sem o GitHub do Orkio, o projeto usa o seu git e o seu{' '}
            <code className="font-mono">gh</code>: push e PR saem por eles. PRs e CI no quadro
            chegam depois.
          </p>
          <Button
            size="sm"
            variant="outline"
            disabled={saving || (needsConfirmation && !confirmed)}
            onClick={() => void submit(true)}
          >
            Usar só o git desta máquina
          </Button>
        </div>
      )}

      <div className={cn('flex gap-2', bare && 'flex-row-reverse justify-start')}>
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
