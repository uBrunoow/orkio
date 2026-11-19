import { useEffect, useState } from 'react'
import { Button } from '@astryxdesign/core/Button'
import { Icon } from '@astryxdesign/core/Icon'
import { FolderPlusIcon, FolderSearchIcon, TrashIcon } from '../../components/icons'
import { Code } from '@astryxdesign/core/Code'
import { EmptyState } from '@astryxdesign/core/EmptyState'
import { HStack } from '@astryxdesign/core/HStack'
import { Item } from '@astryxdesign/core/Item'
import { List } from '@astryxdesign/core/List'
import { Skeleton } from '@astryxdesign/core/Skeleton'
import { Text } from '@astryxdesign/core/Text'
import { Token } from '@astryxdesign/core/Token'
import { VStack } from '@astryxdesign/core/VStack'
import type {
  ProjectError,
  ProjectHealthState,
  ProjectMutationResult,
  ProjectSelection,
  ProjectView
} from '../../../../shared/ipc-contract'
import { Alert } from '../../components/Alert'
import { PageHeader } from '../../components/PageHeader'
import { ProjectNotionSection } from '../notion-workspace/ProjectNotionSection'
import { useNotionWorkspace } from '../notion-workspace/useNotionWorkspace'
import { ActionLink } from './ActionLink'
import { AddProjectPanel } from './AddProjectPanel'
import { useProjects } from './useProjects'

type TokenColor = 'default' | 'green' | 'yellow' | 'red'

const HEALTH: Record<ProjectHealthState, { label: string; color: TokenColor }> = {
  checking: { label: 'Verificando…', color: 'default' },
  ok: { label: 'OK', color: 'green' },
  missing_folder: { label: 'Pasta não encontrada', color: 'red' },
  not_a_repo: { label: 'Não é repositório', color: 'red' },
  repo_mismatch: { label: 'Outro repositório', color: 'red' },
  no_access: { label: 'Sem acesso', color: 'red' },
  github_disconnected: { label: 'GitHub desconectado', color: 'yellow' },
  unverified: { label: 'Não verificado', color: 'yellow' },
  git_error: { label: 'Erro do git', color: 'red' }
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
  const [githubCheck, setGithubCheck] = useState(0)
  const githubConnected = useGitHubConnected(githubCheck)
  const notionWorkspace = useNotionWorkspace().status

  async function addProject(): Promise<void> {
    setGithubCheck((n) => n + 1)
    setPicking(true)
    setPickError(null)
    const result = await projects.pickFolder()
    setPicking(false)
    if (result.ok) setSelection(result.selection)
    else if (!result.cancelled) setPickError(result.error)
  }

  const list = projects.projects

  return (
    <VStack gap={5} maxWidth={1080}>
      <PageHeader
        title="Projetos"
        subtitle="Pastas locais ligadas a repositórios do GitHub. O Orkio acompanha a branch atual."
        action={
          <Button
            variant="primary"
            label={picking ? 'Analisando pasta…' : 'Adicionar projeto'}
            icon={<Icon icon={FolderPlusIcon} />}
            isLoading={picking}
            isDisabled={selection !== null}
            onClick={() => void addProject()}
          />
        }
      />

      {projects.warning && <Alert tone="warning">{projects.warning}</Alert>}

      {githubConnected === false && (
        <Alert
          tone="warning"
          action={
            <Button
              variant="ghost"
              size="sm"
              label="Ir para Integrações"
              onClick={onOpenIntegrations}
            />
          }
        >
          Conecte sua conta do GitHub para adicionar e verificar projetos.
        </Alert>
      )}

      {pickError && (
        <Alert
          tone="danger"
          {...(pickError.action ? { action: <ActionLink action={pickError.action} /> } : {})}
        >
          {pickError.message}
        </Alert>
      )}

      {selection && (
        <AddProjectPanel
          key={selection.selectionId}
          selection={selection}
          onCreate={async (input) => {
            const result = await projects.create(input)
            setGithubCheck((n) => n + 1)
            if (result.ok) setSelection(null)
            return result
          }}
          onCancel={() => setSelection(null)}
        />
      )}

      {list === null ? (
        <VStack gap={3} aria-label="Carregando projetos">
          <Skeleton height={72} />
          <Skeleton height={72} index={1} />
        </VStack>
      ) : list.length === 0 ? (
        !selection && (
          <EmptyState
            title="Nenhum projeto ainda"
            description="Escolha a pasta de um repositório clonado no seu computador. O Orkio detecta o repositório do GitHub automaticamente."
            headingLevel={2}
          />
        )
      ) : (
        <List
          hasDividers
          density="balanced"
          aria-label="Projetos"
          aria-busy={projects.revalidating}
        >
          {list.map((project) => (
            <ProjectRow
              key={project.id}
              project={project}
              onRelocate={() => projects.relocate(project.id)}
              onRemove={() => projects.remove(project.id)}
              notion={
                notionWorkspace?.config ? (
                  <ProjectNotionSection
                    project={project}
                    workspace={notionWorkspace}
                    onChanged={projects.refresh}
                    onOpenIntegrations={onOpenIntegrations}
                  />
                ) : null
              }
            />
          ))}
        </List>
      )}
    </VStack>
  )
}

function ProjectRow({
  project,
  onRelocate,
  onRemove,
  notion
}: {
  project: ProjectView
  onRelocate(): Promise<ProjectMutationResult>
  onRemove(): Promise<boolean>
  /** Vínculo com o Notion e tarefas (quando os bancos estão configurados). */
  notion: React.ReactNode
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
    const result = await onRelocate()
    setBusy(null)
    if (!result.ok && !result.cancelled) setRelocateError(result.error)
  }

  return (
    <Item
      as="li"
      aria-label={project.name}
      align="start"
      label={
        <HStack gap={2} vAlign="center">
          <Text weight="semibold" type="large">
            {project.name}
          </Text>
          <Token
            label={health.label}
            color={health.color}
            size="sm"
            data-health={project.health.state}
          />
        </HStack>
      }
      description={
        <VStack gap={1}>
          <HStack gap={3} vAlign="center" wrap="wrap">
            {project.repo && (
              <Text type="supporting">
                {project.repo.owner}/{project.repo.name}
              </Text>
            )}
            {project.local && (
              <>
                <Code data-testid="project-branch">
                  {project.local.branch ?? '(detached HEAD)'}
                </Code>
                {project.local.dirty && (
                  <Token label="alterações não commitadas" color="yellow" size="sm" />
                )}
              </>
            )}
          </HStack>
          <Text type="supporting">
            <Code color="secondary">{project.localPath}</Code>
          </Text>
          {project.health.message && project.health.state !== 'ok' && (
            <HStack gap={2} vAlign="center" wrap="wrap">
              <Text type="supporting">{project.health.message}</Text>
              {project.health.action && <ActionLink action={project.health.action} />}
            </HStack>
          )}
          {project.notices.map((notice) => (
            <Text key={notice.code} type="supporting">
              {notice.message}
            </Text>
          ))}
          {notion}
          {relocateError && (
            <Alert
              tone="danger"
              {...(relocateError.action
                ? { action: <ActionLink action={relocateError.action} /> }
                : {})}
            >
              {relocateError.message}
            </Alert>
          )}
        </VStack>
      }
      endContent={
        confirmingRemove ? (
          <HStack
            gap={2}
            vAlign="center"
            role="group"
            aria-label={`Confirmar remoção de ${project.name}`}
          >
            <Text type="supporting">Remover do Orkio? Nenhum arquivo será apagado.</Text>
            <Button label="Cancelar" onClick={() => setConfirmingRemove(false)} />
            <Button
              variant="destructive"
              label="Remover"
              isLoading={busy === 'remove'}
              onClick={() => {
                setBusy('remove')
                void onRemove().finally(() => {
                  setBusy(null)
                  setConfirmingRemove(false)
                })
              }}
            />
          </HStack>
        ) : (
          <HStack gap={2}>
            <Button
              variant={folderProblem ? 'primary' : 'secondary'}
              label={busy === 'relocate' ? 'Escolhendo…' : 'Reapontar pasta'}
              icon={<Icon icon={FolderSearchIcon} />}
              isLoading={busy === 'relocate'}
              isDisabled={busy !== null && busy !== 'relocate'}
              onClick={() => void relocate()}
            />
            <Button
              variant="destructive"
              label="Remover"
              icon={<Icon icon={TrashIcon} />}
              isDisabled={busy !== null}
              onClick={() => setConfirmingRemove(true)}
            />
          </HStack>
        )
      }
    />
  )
}

/**
 * `null` enquanto carrega. Só para a dica "conecte o GitHub": relê ao voltar para a janela e
 * quando `refreshKey` muda (ex.: depois de adicionar um projeto).
 */
function useGitHubConnected(refreshKey: number): boolean | null {
  const [connected, setConnected] = useState<boolean | null>(null)
  useEffect(() => {
    let active = true
    const check = (): void => {
      void window.orkio.github
        .getStatus()
        .then((status) => {
          if (active) setConnected(status.state === 'connected' || status.state === 'error')
        })
        .catch(() => {})
    }
    check()
    window.addEventListener('focus', check)
    return () => {
      active = false
      window.removeEventListener('focus', check)
    }
  }, [refreshKey])
  return connected
}
