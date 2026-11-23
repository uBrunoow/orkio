import { useEffect, useState } from 'react'
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
import { BoardIcon, FolderPlusIcon, FolderSearchIcon, MoreIcon } from '../../components/icons'
import { StatusToken, toneOf } from '../../components/StatusToken'
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
import { missingSteps, projectChecks, type ProjectCheck } from './project-checks'
import { AddProjectPanel } from './AddProjectPanel'
import { useProjects } from './useProjects'
import { PAGE_WIDTH } from '../../components/page-width'

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

/** Cor do quadradinho do projeto (inicial), estável pelo id (igual à lista lateral). */
const PROJECT_TINTS = [
  'bg-brand text-black',
  'bg-info text-black',
  'bg-ok text-black',
  'bg-warn text-black',
  'bg-danger text-black'
]
function projectTint(id: string): string {
  let h = 0
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return PROJECT_TINTS[h % PROJECT_TINTS.length]!
}

/** Colunas da lista (cabeçalho e linhas). */
const STATE_COL = 'w-[220px] shrink-0'

export function ProjectsPage({
  onOpenIntegrations,
  onOpenBoard,
  onContinueSetup
}: {
  onOpenIntegrations(): void
  /** Abre o Quadro do projeto (e o torna o projeto atual). */
  onOpenBoard(projectId: string): void
  /** Primeiros passos só com o que falta para este projeto. */
  onContinueSetup(projectId: string): void
}): React.JSX.Element {
  const projects = useProjects()
  const boardStages = useBoardStages(projects.projects)
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

      {githubConnected === false && (
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
        <div className="overflow-hidden rounded-xl border border-border-soft bg-card">
          {/* Cabeçalho das colunas (só visual: cada linha já diz o projeto e o estado). */}
          <div
            aria-hidden="true"
            className="flex gap-3.5 border-b border-border-soft px-4 py-2 text-2xs tracking-wider text-subtle-foreground uppercase"
          >
            <span className="w-8 shrink-0" />
            <span className="flex-1">Projeto</span>
            <span className={STATE_COL}>Estado</span>
            <span className="w-[200px] shrink-0" />
          </div>
          <ul aria-label="Projetos" aria-busy={projects.revalidating}>
            {list.map((project) => (
              <ProjectRow
                key={project.id}
                project={project}
                onRelocate={() => projects.relocate(project.id)}
                onRemove={() => projects.remove(project.id)}
                onOpenBoard={() => onOpenBoard(project.id)}
                onContinueSetup={() => onContinueSetup(project.id)}
                checks={projectChecks({
                  project,
                  boardStages: boardStages[project.id] ?? null,
                  precheck: null
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
          </ul>
        </div>
      )}
    </div>
  )
}

function ProjectRow({
  project,
  onRelocate,
  onRemove,
  onOpenBoard,
  onContinueSetup,
  checks,
  notion
}: {
  project: ProjectView
  onRelocate(): Promise<ProjectMutationResult>
  onRemove(): Promise<boolean>
  onOpenBoard(): void
  onContinueSetup(): void
  checks: ProjectCheck[]
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
    <li
      aria-label={project.name}
      className="flex flex-col gap-2.5 border-b border-border-soft px-4 py-3 last:border-b-0"
    >
      <div className="flex items-start gap-3.5">
        <span
          aria-hidden="true"
          className={cn(
            'grid size-8 shrink-0 place-items-center rounded-lg text-sm font-semibold',
            projectTint(project.id)
          )}
        >
          {project.name.slice(0, 1).toUpperCase()}
        </span>

        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="font-medium text-foreground">{project.name}</span>
            <span className="font-mono text-[11.5px] break-all text-subtle-foreground">
              <span>{project.localPath}</span>
              {project.repo && (
                <>
                  <span aria-hidden="true"> · </span>
                  <span>
                    {project.repo.owner}/{project.repo.name}
                  </span>
                </>
              )}
              {project.local && (
                <>
                  <span aria-hidden="true"> · </span>
                  <code data-testid="project-branch">
                    {project.local.branch ?? '(detached HEAD)'}
                  </code>
                </>
              )}
            </span>
          </div>
          {project.local?.dirty && <StatusToken label="alterações não commitadas" tone="warning" />}
          <div
            className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-xs"
            data-testid="project-checks"
          >
            {checks.map((c) => (
              <span
                key={c.id}
                className={cn(
                  'inline-flex items-center gap-1',
                  c.state === 'ok' ? 'text-muted-foreground' : 'text-foreground',
                  c.state === 'problem' && 'text-danger'
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'font-medium',
                    c.state === 'ok'
                      ? 'text-ok'
                      : c.state === 'warning'
                        ? 'text-warn'
                        : 'text-danger'
                  )}
                >
                  {c.state === 'ok' ? '✓' : '!'}
                </span>
                {c.label}
              </span>
            ))}
          </div>
        </div>

        {confirmingRemove ? (
          <div
            role="group"
            aria-label={`Confirmar remoção de ${project.name}`}
            className="flex shrink-0 flex-wrap items-center gap-2 self-center"
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
          <>
            <span className={cn(STATE_COL, 'self-center')}>
              <StatusToken
                label={health.label}
                tone={toneOf(health.color)}
                data-health={project.health.state}
              />
            </span>
            <div className="flex shrink-0 items-center justify-end gap-1.5 self-center">
              {folderProblem ? (
                // A pasta sumiu ou mudou: reapontar é a correção, fica à vista.
                <Button variant="outline" disabled={busy !== null} onClick={() => void relocate()}>
                  {busy === 'relocate' ? <Spinner /> : <FolderSearchIcon />}
                  {busy === 'relocate' ? 'Escolhendo…' : 'Reapontar pasta'}
                </Button>
              ) : missingSteps(checks) > 0 ? (
                <Button onClick={onContinueSetup}>Continuar configuração</Button>
              ) : (
                <Button variant="outline" onClick={onOpenBoard}>
                  <BoardIcon />
                  Abrir quadro
                </Button>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
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
                  <DropdownMenuItem onSelect={() => setConfirmingRemove(true)}>
                    Remover do Orkio
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </>
        )}
      </div>
      {/* Detalhes (aviso, Notion e tarefas) em largura cheia, alinhados ao nome do projeto. */}
      <div className="flex min-w-0 flex-col gap-2 pl-[46px] empty:hidden">
        {project.health.message && project.health.state !== 'ok' && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>{project.health.message}</span>
            {project.health.action && <ActionLink action={project.health.action} />}
          </div>
        )}
        {project.notices.map((notice) => (
          <p key={notice.code} className="text-xs text-muted-foreground">
            {notice.message}
          </p>
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
      </div>
    </li>
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

/** Colunas do quadro de cada projeto vinculado (`null` = sem quadro). Lê do main (cache). */
function useBoardStages(projects: ProjectView[] | null): Record<string, number | null> {
  const [stages, setStages] = useState<Record<string, number | null>>({})
  const ids = (projects ?? [])
    .filter((p) => p.notionProject)
    .map((p) => p.id)
    .join(',')
  useEffect(() => {
    let active = true
    for (const id of ids ? ids.split(',') : []) {
      void window.orkio.board
        .get(id)
        .then((r) => {
          if (active && r.ok) {
            setStages((s) => ({ ...s, [id]: r.value.config?.stages.length ?? null }))
          }
        })
        .catch(() => undefined)
    }
    return () => {
      active = false
    }
  }, [ids])
  return stages
}
