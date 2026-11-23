import { plural } from '../../lib/format'
import { useEffect, useState } from 'react'
import { Button } from '@astryxdesign/core/Button'
import { Code } from '@astryxdesign/core/Code'
import { HStack } from '@astryxdesign/core/HStack'
import { Icon } from '@astryxdesign/core/Icon'
import { Item } from '@astryxdesign/core/Item'
import { IconButton } from '@astryxdesign/core/IconButton'
import { List } from '@astryxdesign/core/List'
import { Selector } from '@astryxdesign/core/Selector'
import { Skeleton } from '@astryxdesign/core/Skeleton'
import { Text } from '@astryxdesign/core/Text'
import { Token } from '@astryxdesign/core/Token'
import { VStack } from '@astryxdesign/core/VStack'
import type {
  NotionProjectChoice,
  NotionResult,
  NotionTasksResult,
  NotionWorkspaceStatus,
  ProjectView
} from '../../../../shared/ipc-contract'
import { Alert } from '../../components/Alert'
import {
  ExternalLinkIcon,
  LinkIcon,
  NotionLogo,
  RefreshIcon,
  TasksIcon,
  UnlinkIcon
} from '../../components/icons'
import { ActionLink } from '../projects/ActionLink'
import { call } from './NotionWorkspaceCard'
import { TaskSignalsLine } from './TaskSignalsLine'
import { useTaskSignals } from './useTaskSignals'
import { tokenColor } from './notion-colors'

type NotionError = Extract<NotionResult<never>, { ok: false }>['error']

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
    const result = await call(() => window.orkio.notionWorkspace.unlink(project.id))
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
      <HStack gap={2} vAlign="center">
        <Button
          size="sm"
          label="Vincular ao Notion"
          icon={<Icon icon={NotionLogo} />}
          onClick={() => setPicking(true)}
        />
      </HStack>
    )
  }

  return (
    <VStack gap={2}>
      <HStack gap={2} vAlign="center" wrap="wrap">
        <Icon icon={NotionLogo} size="sm" color="secondary" />
        <Text type="supporting" data-testid="notion-link">
          {linked.name}
        </Text>
        <Button
          size="sm"
          variant="secondary"
          label={showTasks ? 'Ocultar tarefas' : 'Ver tarefas'}
          icon={<Icon icon={TasksIcon} />}
          aria-expanded={showTasks}
          onClick={() => setShowTasks((v) => !v)}
        />
        <Button
          size="sm"
          variant="ghost"
          label="Desvincular"
          icon={<Icon icon={UnlinkIcon} />}
          isLoading={busy}
          onClick={() => void unlink()}
        />
      </HStack>
      {error && <Alert tone="danger">{error.message}</Alert>}
      {showTasks && (
        <TasksPanel
          project={project}
          workspace={workspace}
          onOpenIntegrations={onOpenIntegrations}
        />
      )}
    </VStack>
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
    void call(() =>
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
    const result = await call(() => window.orkio.notionWorkspace.link(project.id, selected))
    setLinking(false)
    if (result.ok) await onLinked()
    else setError(result.error)
  }

  const suggestion = choices?.[0]
  const showSuggestion =
    suggestion && !suggestion.linkedTo && suggestion.similarity >= SUGGESTION_THRESHOLD

  return (
    <VStack gap={2} role="group" aria-label={`Vincular ${project.name} ao Notion`}>
      {choices === null ? (
        <Skeleton height={40} aria-label="Carregando projetos do Notion" />
      ) : (
        <>
          <Selector
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
            emptyText="Nenhum projeto no banco de Projetos"
            emptySearchText="Nenhum projeto encontrado"
            {...(selected ? { value: selected } : {})}
            onChange={(value: string) => setSelected(value)}
          />
          {showSuggestion && (
            <Text type="supporting">Sugestão pelo nome: “{suggestion.title}”.</Text>
          )}
          {truncated && (
            <Text type="supporting">Mostrando os 500 primeiros projetos do Notion.</Text>
          )}
        </>
      )}
      {error && (
        <Alert
          tone="danger"
          {...(error.canReconnect || error.code === 'not_configured'
            ? {
                action: (
                  <Button
                    size="sm"
                    variant="ghost"
                    label="Ir para Integrações"
                    onClick={onOpenIntegrations}
                  />
                )
              }
            : {})}
        >
          {error.message}
        </Alert>
      )}
      <HStack gap={2}>
        <Button
          size="sm"
          variant="primary"
          label="Vincular"
          icon={<Icon icon={LinkIcon} />}
          isDisabled={!selected}
          isLoading={linking}
          onClick={() => void link()}
        />
        <Button
          size="sm"
          variant="ghost"
          label="Recarregar"
          icon={<Icon icon={RefreshIcon} />}
          onClick={() => {
            setError(null)
            setChoices(null)
            setReloadKey((n) => n + 1)
          }}
        />
        <Button size="sm" variant="ghost" label="Cancelar" onClick={onCancel} />
      </HStack>
    </VStack>
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
    void call(() =>
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
    <VStack gap={2} role="region" aria-label={`Tarefas de ${project.name}`}>
      <HStack gap={2} vAlign="center">
        <Button
          size="sm"
          variant="ghost"
          label="Atualizar"
          icon={<Icon icon={RefreshIcon} />}
          isLoading={loading && result !== null}
          onClick={() => {
            setLoading(true)
            setError(null)
            setRefreshKey((n) => n + 1)
          }}
        />
        {result && (
          <Text type="supporting">
            {plural(result.tasks.length, 'tarefa', 'tarefas')} · atualizado às{' '}
            {formatTime(result.fetchedAt)}
          </Text>
        )}
      </HStack>

      {signals.result && signals.result.messages.length > 0 && !error && (
        <Alert
          tone="warning"
          {...(signals.result.action
            ? { action: <ActionLink action={signals.result.action} /> }
            : {})}
        >
          <VStack gap={1}>
            {signals.result.messages.map((m) => (
              <Text key={m}>{m}</Text>
            ))}
          </VStack>
        </Alert>
      )}
      {signals.error && !error && <Alert tone="warning">{signals.error.message}</Alert>}
      {signals.result && signals.result.tasksWithoutPrefix > 0 && (
        <Text type="supporting">
          {plural(signals.result.tasksWithoutPrefix, 'tarefa', 'tarefas')} sem prefixo no ID não
          podem ser ligadas a branches e PRs. Defina um prefixo na propriedade ID do Notion (ex.:
          ORK).
        </Text>
      )}

      {error && (
        <Alert
          tone="danger"
          {...(error.canReconnect || error.code === 'broken' || error.code === 'not_configured'
            ? {
                action: (
                  <Button
                    size="sm"
                    variant="ghost"
                    label="Ir para Integrações"
                    onClick={onOpenIntegrations}
                  />
                )
              }
            : {})}
        >
          {error.message}
        </Alert>
      )}

      {result?.truncated && (
        <Alert tone="warning">Mostrando as 500 tarefas mais recentes deste projeto.</Alert>
      )}

      {loading && result === null ? (
        <Skeleton height={40} aria-label="Carregando tarefas" />
      ) : result && result.tasks.length === 0 && !error ? (
        <Text color="secondary">Nenhuma tarefa ligada a este projeto no Notion.</Text>
      ) : result && !error ? (
        <List hasDividers density="compact" aria-label="Tarefas do Notion">
          {result.tasks.map((task) => (
            <Item
              as="li"
              key={task.id}
              aria-label={task.title}
              startContent={<Code data-testid="task-id">{task.displayId ?? '—'}</Code>}
              label={task.title}
              description={<TaskSignalsLine signals={signals.result?.signals[task.id]} />}
              endContent={
                <HStack gap={2} vAlign="center">
                  {hasPriority && task.priority && (
                    <Text type="supporting" color="secondary" data-testid="task-priority">
                      {task.priority.name}
                    </Text>
                  )}
                  {task.status && (
                    <Token
                      label={task.status.name}
                      color={tokenColor(task.status.color)}
                      size="sm"
                      data-testid="task-status"
                      data-color={task.status.color}
                    />
                  )}
                  {task.url && (
                    <IconButton
                      variant="ghost"
                      size="sm"
                      label={`Abrir ${task.displayId ?? task.title} no Notion`}
                      icon={<Icon icon={ExternalLinkIcon} />}
                      onClick={() => void window.orkio.openExternal(task.url!)}
                    />
                  )}
                </HStack>
              }
            />
          ))}
        </List>
      ) : null}
    </VStack>
  )
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}
