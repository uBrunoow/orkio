import { useState } from 'react'
import { Button } from '@astryxdesign/core/Button'
import { Card } from '@astryxdesign/core/Card'
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput'
import { Code } from '@astryxdesign/core/Code'
import { HStack } from '@astryxdesign/core/HStack'
import { RadioList, RadioListItem } from '@astryxdesign/core/RadioList'
import { Text } from '@astryxdesign/core/Text'
import { TextInput } from '@astryxdesign/core/TextInput'
import { VStack } from '@astryxdesign/core/VStack'
import type {
  CreateProjectInput,
  ProjectError,
  ProjectMutationResult,
  ProjectSelection
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
    <Card role="region" aria-labelledby="add-project-title" elevation="low">
      <VStack gap={4}>
        <VStack gap={1}>
          <Text as="h2" id="add-project-title" type="large" weight="semibold">
            Adicionar projeto
          </Text>
          <Text type="supporting">
            <Code>{selection.rootPath}</Code>
          </Text>
        </VStack>

        {selection.resolvedFromSubfolder && (
          <Alert tone="warning">
            Você escolheu uma subpasta. O Orkio vai usar a raiz do repositório:{' '}
            <Code>{selection.folderName}</Code>.
          </Alert>
        )}

        <Text color="secondary">
          Branch atual: <Code>{selection.branch ?? '(detached HEAD)'}</Code>
          {selection.dirty && ' · com alterações não commitadas'}
        </Text>

        {selection.candidates.length > 1 ? (
          <RadioList
            label="Qual repositório o Orkio deve acompanhar?"
            value={remoteName}
            onChange={chooseRemote}
            isDisabled={saving}
            {...(isFork
              ? {
                  description:
                    'Parece um fork: “origin” é a sua cópia e “upstream” o repositório original.'
                }
              : {})}
          >
            {selection.candidates.map((c) => (
              <RadioListItem
                key={c.remoteName}
                value={c.remoteName}
                label={`${c.remoteName} — ${c.owner}/${c.name} (${c.host})`}
              />
            ))}
          </RadioList>
        ) : (
          <Text>
            Repositório:{' '}
            <Text weight="semibold">
              {candidate.owner}/{candidate.name}
            </Text>{' '}
            <Text type="supporting">
              ({candidate.remoteName} · {candidate.host})
            </Text>
          </Text>
        )}

        {needsConfirmation && (
          <CheckboxInput
            value={confirmed}
            onChange={(checked) => setConfirmed(checked)}
            isDisabled={saving}
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

        <TextInput
          label="Nome no Orkio"
          value={name}
          onChange={(value) => {
            setName(value.slice(0, 80))
            setNameEdited(true)
          }}
          isDisabled={saving}
        />

        {error && (
          <Alert
            tone="danger"
            {...(error.action ? { action: <ActionLink action={error.action} /> } : {})}
          >
            {error.message}
          </Alert>
        )}

        <HStack gap={2}>
          <Button
            variant="primary"
            label={saving ? 'Verificando no GitHub…' : 'Adicionar projeto'}
            isLoading={saving}
            isDisabled={needsConfirmation && !confirmed}
            onClick={() => void submit()}
          />
          <Button label="Cancelar" onClick={onCancel} isDisabled={saving} />
        </HStack>
      </VStack>
    </Card>
  )
}
