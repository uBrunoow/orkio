import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/PageState'
import { Spinner } from '@/components/Spinner'
import { cn } from '@/lib/utils'
import {
  BoardIcon,
  GitBranchIcon,
  FolderPlusIcon,
  FolderSearchIcon,
  GitHubLogo,
  MoreIcon
} from '../../components/icons'
import { StatusBadge } from '../../components/StatusToken'
import { PROJECT_HEALTH } from '../../lib/status-text'
import { Alert } from '../../components/Alert'
import { PageHeader } from '../../components/PageHeader'
import { ProjectNotionSection } from '../notion-workspace/ProjectNotionSection'
import { useNotionWorkspace } from '../notion-workspace/useNotionWorkspace'
import { ActionLink } from './ActionLink'
import { missingSteps, projectChecks, type ProjectCheck } from './project-checks'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { AddProjectPanel } from './AddProjectPanel'
import { useProjects } from './useProjects'
import { PAGE_WIDTH } from '../../components/page-width'
import type {
  ProjectError,
  ProjectMutationResult,
  ProjectSelection,
  ProjectView
} from '../../../../shared/projects'
import { useIpcResource } from '../../lib/ipc'
import { readBoard, useSources } from '../../app/sources'
import { useConnectionStatus } from '../integrations/useConnection'
import { isFolderProblem } from '../../../../shared/projects'
import { ProjectAvatar } from '../../components/ProjectAvatar'

export function ProjectsPage({
  onOpenIntegrations,
  onOpenBoard,
  onContinueSetup
}: {
  onOpenIntegrations(): void
  /** Abre o Quadro do projeto (e o torna o projeto atual). */
  onOpenBoard(projectId: string): void
  onContinueSetup(projectId: string): void
}): React.JSX.Element {
  const projects = useProjects({ revalidate: true })
  const boardStages = useBoardStages(projects.projects)
  const [picking, setPicking] = useState(false)
  const [selection, setSelection] = useState<ProjectSelection | null>(null)
  const [pickError, setPickError] = useState<ProjectError | null>(null)
  // Só para a dica "conecte o GitHub" (o status salvo, relido ao voltar para a janela).
  const github = useConnectionStatus('github')
  const notionWorkspace = useNotionWorkspace().status

  async function addProject(): Promise<void> {
    setPicking(true)
    setPickError(null)
    const result = await projects.pickFolder()
    setPicking(false)
    if (result.ok) setSelection(result.selection)
    else if (!result.cancelled) setPickError(result.error)
  }

  const list = projects.projects
  const active = (list ?? []).filter((p) => !p.archived)
  const archivedList = (list ?? []).filter((p) => p.archived)
  const rows = (items: ProjectView[]): React.ReactNode => (
    <>
      {items.map((project) => (
        <ProjectRow
          key={project.id}
          project={project}
          onRelocate={() => projects.relocate(project.id)}
          onRemove={() => projects.remove(project.id)}
          onArchive={(archived) => projects.setArchived(project.id, archived)}
          onOpenBoard={() => onOpenBoard(project.id)}
          onContinueSetup={() => onContinueSetup(project.id)}
          checks={projectChecks({
            project,
            boardStages: boardStages[project.id] ?? null
          })}
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
    </>
  )

  return (
    <div className={cn('flex flex-col gap-[18px]', PAGE_WIDTH.list)}>
      <PageHeader
        title="Projetos"
        subtitle="Pastas locais ligadas a repositórios do GitHub. O Orkio acompanha a branch atual."
        action={
          <Button disabled={picking || selection !== null} onClick={() => void addProject()}>
            {picking ? <Spinner /> : <FolderPlusIcon />}
            {picking ? 'Analisando pasta…' : 'Adicionar projeto'}
          </Button>
        }
      />

      {projects.warning && <Alert tone="warning">{projects.warning}</Alert>}

      {github?.state === 'disconnected' && (
        <Alert
          tone="warning"
          action={
            <Button variant="ghost" size="sm" onClick={onOpenIntegrations}>
              Ir para Integrações
            </Button>
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

      <Dialog open={selection !== null} onOpenChange={(open) => !open && setSelection(null)}>
        <DialogContent className="max-h-[85vh] gap-0 overflow-y-auto sm:max-w-xl">
          {selection && (
            <AddProjectPanel
              key={selection.selectionId}
              bare
              selection={selection}
              onCreate={async (input) => {
                const result = await projects.create(input)
                if (result.ok) setSelection(null)
                return result
              }}
              onCancel={() => setSelection(null)}
            />
          )}
        </DialogContent>
      </Dialog>

      {list === null ? (
        <div className="flex flex-col gap-3" aria-label="Carregando projetos">
          <Skeleton className="h-[72px]" />
          <Skeleton className="h-[72px]" />
        </div>
      ) : list.length === 0 ? (
        !selection && (
          <EmptyState
            title="Nenhum projeto ainda"
            description="Escolha a pasta de um repositório clonado no seu computador. O Orkio detecta o repositório do GitHub automaticamente."
          />
        )
      ) : (
        <>
          <ul
            aria-label="Projetos"
            aria-busy={projects.revalidating}
            className="flex flex-col gap-3"
          >
            {rows(active)}
          </ul>
          {archivedList.length > 0 && (
            <section aria-labelledby="archived-projects" className="flex flex-col gap-2.5">
              <div className="flex flex-col gap-0.5 px-0.5">
                <h2 id="archived-projects" className="text-sm font-medium text-foreground">
                  Arquivados{' '}
                  <span className="tabular text-subtle-foreground">{archivedList.length}</span>
                </h2>
                <p className="text-xs text-muted-foreground">
                  Guardados com o quadro, os fluxos e o histórico. Sem automações, orquestrador nem
                  lugar no quadro e na lista lateral até desarquivar.
                </p>
              </div>
              <ul aria-label="Projetos arquivados" className="flex flex-col gap-3">
                {rows(archivedList)}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  )
}

function ProjectRow({
  project,
  onRelocate,
  onRemove,
  onArchive,
  onOpenBoard,
  onContinueSetup,
  checks,
  notion
}: {
  project: ProjectView
  onRelocate(): Promise<ProjectMutationResult>
  onRemove(): Promise<boolean>
  onArchive(archived: boolean): Promise<boolean>
  onOpenBoard(): void
  onContinueSetup(): void
  checks: ProjectCheck[]
  notion: React.ReactNode
}): React.JSX.Element {
  const [busy, setBusy] = useState<'relocate' | 'remove' | null>(null)
  const [confirmingRemove, setConfirmingRemove] = useState(false)
  const [relocateError, setRelocateError] = useState<ProjectError | null>(null)
  const health = PROJECT_HEALTH[project.health.state]
  const folderProblem = isFolderProblem(project.health.state)

  async function relocate(): Promise<void> {
    setBusy('relocate')
    setRelocateError(null)
    const result = await onRelocate()
    setBusy(null)
    if (!result.ok && !result.cancelled) setRelocateError(result.error)
  }

  const missing = checks.filter((c) => c.state !== 'ok')
  const doneCount = checks.length - missing.length
  const notices = [
    ...(project.health.message && project.health.state !== 'ok'
      ? [{ key: 'health', text: project.health.message, action: project.health.action }]
      : []),
    ...project.notices.map((n) => ({ key: n.code, text: n.message, action: undefined }))
  ]

  return (
    <li
      aria-label={project.name}
      className={cn(
        '@container flex flex-col overflow-hidden rounded-xl border border-border-soft bg-card',
        project.archived && 'opacity-80'
      )}
    >
      {/* Cabeçalho: quem é, em que pé está e o próximo passo. */}
      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-3 px-4 py-3.5">
        <ProjectAvatar size="md" project={project} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-medium text-foreground">{project.name}</h3>
            <StatusBadge
              label={health.label}
              tone={health.tone}
              data-health={project.health.state}
            />
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            {project.repo ? (
              <span className="inline-flex min-w-0 items-center gap-1">
                <GitHubLogo aria-hidden="true" className="size-3.5 shrink-0" />
                <span className="truncate font-mono">
                  {project.repo.owner}/{project.repo.name}
                </span>
              </span>
            ) : (
              <span>Sem repositório no GitHub</span>
            )}
            {project.local && (
              <span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5">
                <GitBranchIcon aria-hidden="true" className="size-3 shrink-0" />
                <code data-testid="project-branch" className="font-mono text-2xs text-foreground">
                  {project.local.branch ?? '(detached HEAD)'}
                </code>
              </span>
            )}
            {project.local?.dirty && (
              <StatusBadge label="alterações não commitadas" tone="warning" />
            )}
          </div>
        </div>

        {confirmingRemove ? (
          <div
            role="group"
            aria-label={`Confirmar remoção de ${project.name}`}
            className="flex shrink-0 flex-wrap items-center gap-2 @max-[36rem]:basis-full @max-[36rem]:pl-[46px]"
          >
            <span className="text-xs text-muted-foreground">
              Remover do Orkio? Nenhum arquivo será apagado.
            </span>
            <Button variant="outline" size="sm" onClick={() => setConfirmingRemove(false)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={busy === 'remove'}
              onClick={() => {
                setBusy('remove')
                void onRemove().finally(() => {
                  setBusy(null)
                  setConfirmingRemove(false)
                })
              }}
            >
              {busy === 'remove' && <Spinner />}
              Remover
            </Button>
          </div>
        ) : (
          <div className="flex shrink-0 items-center gap-1.5 @max-[36rem]:basis-full @max-[36rem]:pl-[46px]">
            {folderProblem ? (
              // A pasta sumiu ou mudou: reapontar é a correção, fica à vista.
              <Button
                size="sm"
                variant="outline"
                disabled={busy !== null}
                onClick={() => void relocate()}
              >
                {busy === 'relocate' ? <Spinner /> : <FolderSearchIcon />}
                {busy === 'relocate' ? 'Escolhendo…' : 'Reapontar pasta'}
              </Button>
            ) : missingSteps(checks) > 0 ? (
              <Button size="sm" onClick={onContinueSetup}>
                Continuar configuração
              </Button>
            ) : (
              <Button size="sm" variant="outline" onClick={onOpenBoard}>
                <BoardIcon />
                Abrir quadro
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Mais ações de ${project.name}`}
                  disabled={busy !== null}
                >
                  <MoreIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {!folderProblem && (
                  <DropdownMenuItem onSelect={() => void relocate()}>
                    Reapontar pasta
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onSelect={() => void onArchive(!project.archived)}>
                  {project.archived ? 'Desarquivar' : 'Arquivar'}
                </DropdownMenuItem>
                <DropdownMenuItem variant="destructive" onSelect={() => setConfirmingRemove(true)}>
                  Remover do Orkio
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>

      {(notices.length > 0 || relocateError) && (
        <div className="flex flex-col gap-2 px-4 pb-3">
          {notices.map((n) => (
            <Alert
              key={n.key}
              tone="warning"
              {...(n.action ? { action: <ActionLink action={n.action} /> } : {})}
            >
              {n.text}
            </Alert>
          ))}
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
        </div>
      )}

      {/* Detalhes em linhas rotuladas, uma coisa por linha. */}
      <dl className="divide-y divide-border-soft border-t border-border-soft text-xs">
        <DetailRow term="Pasta">
          <span className="font-mono wrap-anywhere text-muted-foreground" title={project.localPath}>
            {project.localPath}
          </span>
        </DetailRow>
        <DetailRow term="Configuração">
          <div className="flex flex-wrap items-center gap-1.5" data-testid="project-checks">
            <span className="mr-1 text-muted-foreground tabular-nums">
              {doneCount} de {checks.length}
            </span>
            {checks.map((c) => (
              <span
                key={c.id}
                className={cn(
                  'inline-flex h-5 items-center gap-1 rounded-full border px-2 text-2xs',
                  c.state === 'ok' && 'border-border-soft text-muted-foreground',
                  c.state === 'warning' && 'border-warn/30 bg-warn-tint text-warn',
                  c.state === 'problem' && 'border-danger/30 bg-danger-tint text-danger'
                )}
              >
                <span aria-hidden="true" className={c.state === 'ok' ? 'text-ok' : undefined}>
                  {c.state === 'ok' ? '✓' : '!'}
                </span>
                {c.label}
              </span>
            ))}
          </div>
        </DetailRow>
        {notion && <DetailRow term="Notion">{notion}</DetailRow>}
      </dl>
    </li>
  )
}

function DetailRow({
  term,
  children
}: {
  term: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex gap-4 px-4 py-2 @max-[36rem]:flex-col @max-[36rem]:gap-0">
      <dt className="flex h-7 w-24 shrink-0 items-center text-subtle-foreground">{term}</dt>
      <dd className="flex min-h-7 min-w-0 flex-1 flex-col justify-center">{children}</dd>
    </div>
  )
}

/** Colunas do quadro de cada projeto vinculado (`null` = sem quadro). Lê do main (cache). */
function useBoardStages(projects: ProjectView[] | null): Record<string, number | null> {
  const { board } = useSources()
  const ids = (projects ?? [])
    .filter((p) => p.notionProject)
    .map((p) => p.id)
    .join(',')
  return (
    useIpcResource(ids || null, async (key) => {
      const entries = await Promise.all(
        key.split(',').map(async (id) => {
          const view = await readBoard(board, id)
          return view ? ([id, view.config?.stages.length ?? null] as const) : null
        })
      )
      return Object.fromEntries(entries.filter((e) => e !== null))
    }).value ?? {}
  )
}
