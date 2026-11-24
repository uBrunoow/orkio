import { plural } from '../../lib/format'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { SelectField } from '@/components/form'
import { Spinner } from '@/components/Spinner'
import { Alert } from '../../components/Alert'
import { StatusToken } from '../../components/StatusToken'
import { ErrorAlert } from '../../components/ErrorAlert'
import { ipcResult } from '../../lib/ipc'
import { NOTION_COLOR_TONE } from '../../lib/status-text'
import {
  ExternalLinkIcon,
  LinkIcon,
  NotionLogo,
  RefreshIcon,
  TasksIcon,
  UnlinkIcon
} from '../../components/icons'
import { SignalsMessages } from './SignalsMessages'
import { TaskSignalsLine } from './TaskSignalsLine'
import { useTaskSignals } from './useTaskSignals'
import type {
  NotionProjectChoice,
  NotionTasksResult,
  NotionWorkspaceStatus
} from '../../../../shared/notion'
import type { ResultError } from '../../../../shared/result'
import type { ProjectView } from '../../../../shared/projects'
import { formatTime } from '../../lib/format'

type NotionError = ResultError

/** A sugestão automática só é pré-selecionada a partir desta semelhança de nome. */
const SUGGESTION_THRESHOLD = 0.5

/**
 * Vínculo do projeto local com uma página do banco de Projetos do Notion e lista (só leitura)
 * das tarefas ligadas a ela.
 */
export function ProjectNotionSection({
  project,
  workspace,
  onChanged,
  onOpenIntegrations
}: {
  project: ProjectView
  workspace: NotionWorkspaceStatus
  /** Recarrega a lista de projetos (vínculo mudou). */
  onChanged(): Promise<void>
  onOpenIntegrations(): void
}): React.JSX.Element {
  const [picking, setPicking] = useState(false)
  const [showTasks, setShowTasks] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<NotionError | null>(null)
  const linked = project.notionProject

  async function unlink(): Promise<void> {
    setBusy(true)
    setError(null)
    const result = await ipcResult(() => window.orkio.notionWorkspace.unlink(project.id))
    setBusy(false)
    if (!result.ok) setError(result.error)
    else {
      setShowTasks(false)
      await onChanged()
    }
  }

  if (!linked) {
    return picking ? (
      <LinkPicker
        project={project}
        onCancel={() => setPicking(false)}
        onLinked={async () => {
          setPicking(false)
          await onChanged()
          setShowTasks(true)
        }}
        onOpenIntegrations={onOpenIntegrations}
      />
    ) : (
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => setPicking(true)}>
          <NotionLogo />
          Vincular ao Notion
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <NotionLogo className="size-3.5 text-muted-foreground" />
        <span className="text-xs text-muted-foreground" data-testid="notion-link">
          {linked.name}
        </span>
        <Button
          size="sm"
          variant="outline"
          aria-expanded={showTasks}
          onClick={() => setShowTasks((v) => !v)}
        >
          <TasksIcon />
          {showTasks ? 'Ocultar tarefas' : 'Ver tarefas'}
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void unlink()}>
          {busy ? <Spinner /> : <UnlinkIcon />}
          Desvincular
        </Button>
      </div>
      {error && <Alert tone="danger">{error.message}</Alert>}
      {showTasks && (
        <TasksPanel
          project={project}
          workspace={workspace}
          onOpenIntegrations={onOpenIntegrations}
        />
      )}
    </div>
  )
}

function LinkPicker({
  project,
  onCancel,
  onLinked,
  onOpenIntegrations
}: {
  project: ProjectView
  onCancel(): void
  onLinked(): Promise<void>
  onOpenIntegrations(): void
}): React.JSX.Element {
  const [choices, setChoices] = useState<NotionProjectChoice[] | null>(null)
  const [truncated, setTruncated] = useState(false)
  const [error, setError] = useState<NotionError | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [linking, setLinking] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let active = true
    void ipcResult(() =>
      window.orkio.notionWorkspace.listProjectChoices(project.id, { force: reloadKey > 0 })
    ).then((result) => {
      if (!active) return
      if (!result.ok) {
        setError(result.error)
        setChoices([])
        return
      }
      setChoices(result.value.choices)
      setTruncated(result.value.truncated)
      const best = result.value.choices[0]
      if (best && !best.linkedTo && best.similarity >= SUGGESTION_THRESHOLD) {
        setSelected((current) => current ?? best.id)
      }
    })
    return () => {
      active = false
    }
  }, [project.id, reloadKey])

  async function link(): Promise<void> {
    if (!selected) return
    setLinking(true)
    setError(null)
    const result = await ipcResult(() => window.orkio.notionWorkspace.link(project.id, selected))
    setLinking(false)
    if (result.ok) await onLinked()
    else setError(result.error)
  }

  const suggestion = choices?.[0]
  const showSuggestion =
    suggestion && !suggestion.linkedTo && suggestion.similarity >= SUGGESTION_THRESHOLD

  return (
    <div
      role="group"
      aria-label={`Vincular ${project.name} ao Notion`}
      className="flex max-w-md flex-col gap-2"
    >
      {choices === null ? (
        <Skeleton className="h-10" aria-label="Carregando projetos do Notion" />
      ) : (
        <>
          <SelectField
            label="Projeto do Notion"
            options={choices.map((c) => ({
              value: c.id,
              label: c.title,
              ...(c.linkedTo && c.linkedTo.projectId !== project.id
                ? { description: `Já vinculado a “${c.linkedTo.name}”`, disabled: true }
                : {})
            }))}
            hasSearch
            searchPlaceholder="Buscar projeto…"
            placeholder="Escolha o projeto do Notion"
            value={selected}
            onChange={(value: string) => setSelected(value)}
          />
          {choices.length === 0 && (
            <p className="text-xs text-muted-foreground">Nenhum projeto no banco de Projetos</p>
          )}
          {showSuggestion && (
            <p className="text-xs text-muted-foreground">
              Sugestão pelo nome: “{suggestion.title}”.
            </p>
          )}
          {truncated && (
            <p className="text-xs text-muted-foreground">
              Mostrando os 500 primeiros projetos do Notion.
            </p>
          )}
        </>
      )}
      {error && <ErrorAlert error={error} onOpenIntegrations={onOpenIntegrations} />}
      <div className="flex gap-2">
        <Button size="sm" disabled={!selected || linking} onClick={() => void link()}>
          {linking ? <Spinner /> : <LinkIcon />}
          Vincular
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setError(null)
            setChoices(null)
            setReloadKey((n) => n + 1)
          }}
        >
          <RefreshIcon />
          Recarregar
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </div>
  )
}

function TasksPanel({
  project,
  workspace,
  onOpenIntegrations
}: {
  project: ProjectView
  workspace: NotionWorkspaceStatus
  onOpenIntegrations(): void
}): React.JSX.Element {
  const [result, setResult] = useState<NotionTasksResult | null>(null)
  const [error, setError] = useState<NotionError | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)
  const signals = useTaskSignals(project.id)
  const refreshSignals = signals.refresh

  useEffect(() => {
    let active = true
    void ipcResult(() =>
      window.orkio.notionWorkspace.listTasks(project.id, { force: refreshKey > 0 })
    ).then((r) => {
      if (!active) return
      setLoading(false)
      if (r.ok) {
        setResult(r.value)
        // Branches/PRs depois das tarefas; "Atualizar" também força o GitHub.
        void refreshSignals(refreshKey > 0)
      } else setError(r.error)
    })
    return () => {
      active = false
    }
  }, [project.id, refreshKey, refreshSignals])

  const hasPriority = Boolean(workspace.config?.mapping.priority)

  return (
    <section aria-label={`Tarefas de ${project.name}`} className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="ghost"
          disabled={loading && result !== null}
          onClick={() => {
            setLoading(true)
            setError(null)
            setRefreshKey((n) => n + 1)
          }}
        >
          {loading && result !== null ? <Spinner /> : <RefreshIcon />}
          Atualizar
        </Button>
        {result && (
          <span className="text-xs text-muted-foreground">
            {plural(result.tasks.length, 'tarefa', 'tarefas')} · atualizado às{' '}
            {formatTime(result.fetchedAt)}
          </span>
        )}
      </div>

      {!error && <SignalsMessages result={signals.result} />}
      {signals.error && !error && <Alert tone="warning">{signals.error.message}</Alert>}
      {signals.result && signals.result.tasksWithoutPrefix > 0 && (
        <p className="text-xs text-muted-foreground">
          {plural(signals.result.tasksWithoutPrefix, 'tarefa', 'tarefas')} sem prefixo no ID não
          podem ser ligadas a branches e PRs. Defina um prefixo na propriedade ID do Notion (ex.:
          ORK).
        </p>
      )}

      {error && <ErrorAlert error={error} onOpenIntegrations={onOpenIntegrations} />}

      {result?.truncated && (
        <Alert tone="warning">Mostrando as 500 tarefas mais recentes deste projeto.</Alert>
      )}

      {loading && result === null ? (
        <Skeleton className="h-10" aria-label="Carregando tarefas" />
      ) : result && result.tasks.length === 0 && !error ? (
        <p className="text-sm text-muted-foreground">
          Nenhuma tarefa ligada a este projeto no Notion.
        </p>
      ) : result && !error ? (
        <ul
          aria-label="Tarefas do Notion"
          className="overflow-hidden rounded-lg border border-border-soft bg-surface"
        >
          {result.tasks.map((task) => (
            <li
              key={task.id}
              aria-label={task.title}
              className="flex items-start gap-3 border-b border-border-soft px-3 py-2 last:border-b-0"
            >
              <code
                data-testid="task-id"
                className="mt-0.5 w-16 shrink-0 font-mono text-2xs text-subtle-foreground"
              >
                {task.displayId ?? '—'}
              </code>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="truncate text-sm text-foreground">{task.title}</span>
                <TaskSignalsLine signals={signals.result?.signals[task.id]} />
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {hasPriority && task.priority && (
                  <span className="text-xs text-muted-foreground" data-testid="task-priority">
                    {task.priority.name}
                  </span>
                )}
                {task.status && (
                  <StatusToken
                    label={task.status.name}
                    tone={NOTION_COLOR_TONE[task.status.color]}
                    data-testid="task-status"
                    data-color={task.status.color}
                  />
                )}
                {task.url && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Abrir ${task.displayId ?? task.title} no Notion`}
                    onClick={() => void window.orkio.openExternal(task.url!)}
                  >
                    <ExternalLinkIcon />
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
