import { useEffect, useMemo, useState } from 'react'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem as CommandRowItem,
  CommandList
} from '@/components/ui/command'
import { Kbd } from '@/components/ui/kbd'
import { Spinner } from '@/components/Spinner'
import type { Route } from './routes'
import {
  commandLabel,
  paletteGroup,
  type Command,
  type CommandState,
  type PaletteMode
} from './commands'
import { formatKeys as formatKeysFor } from './keys'
import type { BoardCard } from '../../../shared/board'
import type { ProjectView } from '../../../shared/projects'
import { normalizeLabel } from '../../../shared/text'
import { isMac } from '../lib/platform'
import { readBoard, useSources, type AppSources } from './sources'
import { ipcResult } from '../lib/ipc'

export interface CommandData {
  group: string
  /** Comando do registro (`commands.ts`) a rodar. */
  commandId?: string
  route?: Route
  projectId?: string
  taskRef?: { displayId: string | null; where: string }
  keys?: string
  /** Tarefa fora do quadro: abre a página no Notion. */
  url?: string
}

export interface CommandItem {
  id: string
  label: string
  /** Palavras a mais para a busca (não aparecem). */
  keywords?: readonly string[]
  auxiliaryData?: CommandData
}

interface SearchSource {
  bootstrap(): Promise<CommandItem[]>
  search(query: string): Promise<CommandItem[]>
}

/** Comandos do registro que a paleta mostra agora (telas, seções, ações). */
function commandItems(commands: readonly Command[], ctx: CommandState): CommandItem[] {
  return commands.map((c) => ({
    id: `cmd:${c.id}`,
    label: commandLabel(c, ctx),
    keywords: c.keywords ?? [],
    auxiliaryData: {
      group: paletteGroup(c),
      commandId: c.id,
      ...(c.keys ? { keys: c.keys } : {})
    }
  }))
}

/** Tarefas de todos os projetos vinculados (o main responde do cache de 60 s quando pode). */
async function loadTasks(
  board: AppSources['board'],
  projects: readonly ProjectView[]
): Promise<CommandItem[]> {
  const views = await Promise.all(projects.map((p) => readBoard(board, p.id)))
  return views.flatMap((view) => {
    if (!view?.config) return []
    const stageName = (card: BoardCard): string =>
      view.config?.stages.find((s) => s.id === card.stageId)?.name ?? 'Sem etapa'
    return view.cards.map((card) => ({
      id: `task:${view.projectId}:${card.taskId}`,
      label: `${card.displayId ?? ''} ${card.title}`.trim(),
      auxiliaryData: {
        group: 'Tarefas',
        route: { name: 'task', projectId: view.projectId, taskId: card.taskId },
        taskRef: {
          displayId: card.displayId,
          where: `${view.projectName} · ${stageName(card)}`
        }
      }
    }))
  })
}

/**
 * Busca no banco de Tarefas do Notion inteiro (`searchTasks`: título ou ID, qualquer pessoa e
 * projeto). Tarefa que está no quadro de um projeto vinculado abre no Orkio; as outras abrem a
 * página no Notion.
 */
async function searchNotionTasks(
  query: string,
  onBoard: ReadonlySet<string>
): Promise<CommandItem[]> {
  const r = await ipcResult(() => window.orkio.notionWorkspace.searchTasks(query))
  if (!r.ok) return []
  return r.value.tasks.map((t) => {
    const inOrkio = !!t.projectId && onBoard.has(`${t.projectId}:${t.id}`)
    const where = [
      t.projectName ?? 'Sem projeto no Orkio',
      t.status?.name,
      t.assignees.length > 0 ? t.assignees.join(', ') : null,
      inOrkio ? null : 'abre no Notion'
    ]
      .filter(Boolean)
      .join(' · ')
    return {
      id: `notion:${t.id}`,
      label: `${t.displayId ?? ''} ${t.title}`.trim(),
      auxiliaryData: {
        group: 'Tarefas',
        ...(inOrkio
          ? { route: { name: 'task' as const, projectId: t.projectId!, taskId: t.id } }
          : t.url
            ? { url: t.url }
            : {}),
        taskRef: { displayId: t.displayId, where }
      }
    }
  })
}

/**
 * Paleta (Ctrl/Cmd+K): "fazer qualquer coisa". Telas, seções e ações do registro de comandos,
 * troca de projeto e as tarefas dos quadros. `mode="tasks"` (Buscar tarefa, Ctrl/Cmd+P) busca só
 * tarefas, direto no Notion; `mode="projects"` (Trocar de projeto) só os projetos. Nada aqui
 * escreve no Notion nem roda agentes: as ações são as mesmas dos menus.
 */
export function CommandMenu({
  isOpen,
  onOpenChange,
  projects,
  currentProjectId,
  commands,
  commandState,
  onRun,
  mode = 'all'
}: {
  mode?: PaletteMode
  isOpen: boolean
  onOpenChange(isOpen: boolean): void
  projects: readonly ProjectView[]
  currentProjectId: string | null
  /** Comandos disponíveis agora (`paletteCommands`). */
  commands: readonly Command[]
  commandState: CommandState
  onRun(item: CommandData): void
}): React.JSX.Element {
  const { board } = useSources()
  const source = useMemo((): SearchSource => {
    const switchItems: CommandItem[] = projects
      .filter((p) => p.id !== currentProjectId)
      .map((p) => ({
        id: `project:${p.id}`,
        label: `Trocar para ${p.name}`,
        auxiliaryData: { group: 'Projetos', projectId: p.id }
      }))
    const actions = commandItems(commands, commandState)
    let tasks: Promise<CommandItem[]> | null = null
    const all = async (): Promise<CommandItem[]> => {
      tasks ??= loadTasks(board, projects)
      return [...(await tasks), ...actions, ...switchItems]
    }
    let onBoard: Promise<Set<string>> | null = null
    const notion = async (query: string): Promise<CommandItem[]> => {
      onBoard ??= loadTasks(board, projects).then(
        (items) =>
          new Set(
            items.flatMap((i) =>
              i.auxiliaryData?.route?.name === 'task'
                ? [`${i.auxiliaryData.route.projectId}:${i.auxiliaryData.route.taskId}`]
                : []
            )
          )
      )
      return searchNotionTasks(query, await onBoard)
    }
    const matches = (item: CommandItem, q: string): boolean =>
      [item.label, ...(item.keywords ?? [])].some((t) => normalizeLabel(t).includes(q))
    if (mode === 'tasks') {
      return { bootstrap: () => notion(''), search: (query) => notion(query) }
    }
    if (mode === 'projects') {
      return {
        bootstrap: () => Promise.resolve(switchItems),
        search: (query) =>
          Promise.resolve(switchItems.filter((i) => matches(i, normalizeLabel(query))))
      }
    }
    return {
      bootstrap: async () => {
        const items = await all()
        const tasksOnly = items.filter((i) => i.auxiliaryData?.group === 'Tarefas').slice(0, 5)
        return [...items.filter((i) => i.auxiliaryData?.group !== 'Tarefas'), ...tasksOnly]
      },
      search: async (query) => {
        const q = normalizeLabel(query)
        const items = await all()
        return items.filter((i) => matches(i, q)).slice(0, 50)
      }
    }
    // Recria a fonte (e relê as tarefas) a cada abertura.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, currentProjectId, isOpen, mode])

  const [query, setQuery] = useState('')
  const [items, setItems] = useState<CommandItem[] | null>(null)
  // Ao fechar, limpa a busca (ajuste de estado durante a renderização, sem efeito).
  const [wasOpen, setWasOpen] = useState(isOpen)
  if (wasOpen !== isOpen) {
    setWasOpen(isOpen)
    if (!isOpen) {
      setQuery('')
      setItems(null)
    }
  }
  useEffect(() => {
    if (!isOpen) return
    let alive = true
    const delay = mode === 'tasks' && query.trim() ? 250 : 0
    const timer = window.setTimeout(() => {
      const run = query.trim() ? source.search(query) : source.bootstrap()
      void run.then((list) => alive && setItems(list))
    }, delay)
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [isOpen, query, source, mode])

  const groups = useMemo(() => {
    const map = new Map<string, CommandItem[]>()
    for (const item of items ?? []) {
      const g = item.auxiliaryData?.group ?? ''
      map.set(g, [...(map.get(g) ?? []), item])
    }
    return [...map.entries()]
  }, [items])

  const label =
    mode === 'tasks'
      ? 'Buscar tarefas no Notion'
      : mode === 'projects'
        ? 'Trocar de projeto'
        : 'Buscar tarefas e comandos'
  return (
    <CommandDialog
      open={isOpen}
      onOpenChange={onOpenChange}
      title={label}
      description={
        mode === 'tasks'
          ? 'Título ou ID de qualquer tarefa do banco de Tarefas do Notion.'
          : mode === 'projects'
            ? 'Projetos do Orkio.'
            : 'Telas, ações, tarefas e projetos.'
      }
      showCloseButton={false}
      shouldFilter={false}
    >
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder={
          mode === 'tasks'
            ? 'Título ou ID (ex.: ORK-142)…'
            : mode === 'projects'
              ? 'Nome do projeto…'
              : 'Buscar tarefa, tela ou ação…'
        }
        aria-label={label}
      />
      <CommandList className="max-h-[60vh]">
        {items === null ? (
          <div className="flex items-center gap-2 px-4 py-6 text-xs text-muted-foreground">
            <Spinner /> Buscando…
          </div>
        ) : (
          <CommandEmpty>
            {query.trim()
              ? mode === 'tasks'
                ? 'Nenhuma tarefa com esse ID ou título'
                : 'Nada encontrado'
              : mode === 'tasks'
                ? 'Nenhuma tarefa nos projetos vinculados'
                : 'Digite para buscar'}
          </CommandEmpty>
        )}
        {groups.map(([group, list]) => (
          <CommandGroup key={group} heading={group}>
            {list.map((item) => (
              <CommandRowItem
                key={item.id}
                value={item.id}
                onSelect={() => {
                  if (item.auxiliaryData) onRun(item.auxiliaryData)
                  onOpenChange(false)
                }}
              >
                <CommandRow item={item} />
              </CommandRowItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
      <div
        aria-hidden="true"
        className="flex items-center gap-3 border-t border-border-soft px-3 py-2 text-2xs text-subtle-foreground"
      >
        <span className="flex items-center gap-1">
          <Kbd>↑↓</Kbd> mover
        </span>
        <span className="flex items-center gap-1">
          <Kbd>Enter</Kbd> abrir
        </span>
        <span className="ml-auto flex items-center gap-1">
          <Kbd>Esc</Kbd> fechar
        </span>
      </div>
    </CommandDialog>
  )
}

function CommandRow({ item }: { item: CommandItem }): React.JSX.Element {
  const data = item.auxiliaryData
  if (data?.taskRef) {
    const title = data.taskRef.displayId
      ? item.label.slice(data.taskRef.displayId.length).trim()
      : item.label
    return (
      <span className="flex w-full min-w-0 items-center gap-2">
        {data.taskRef.displayId && (
          <span className="shrink-0 font-mono text-xs text-subtle-foreground">
            {data.taskRef.displayId}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate">{title}</span>
        <span className="shrink-0 truncate text-xs text-muted-foreground">
          {data.taskRef.where}
        </span>
      </span>
    )
  }
  return (
    <span className="flex w-full items-center gap-2">
      <span className="flex-1">{item.label}</span>
      {data?.keys && <Kbd>{formatKeys(data.keys)}</Kbd>}
    </span>
  )
}

/** "mod+1" → "Ctrl 1" / "⌘ 1" (formato de `keys.ts`). */
export function formatKeys(keys: string): string {
  return formatKeysFor(keys, isMac())
}
