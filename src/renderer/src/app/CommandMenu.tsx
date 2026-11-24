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
import { SETTINGS_TITLES, type Route, type SettingsSection } from './routes'
import { SHORTCUTS } from './shortcuts'
import type { BoardCard } from '../../../shared/board'
import type { ProjectView } from '../../../shared/projects'
import { normalizeLabel } from '../../../shared/text'

export interface CommandData {
  group: string
  /** Rota de destino (Ir para, tarefas). */
  route?: Route
  /** Trocar o projeto atual. */
  projectId?: string
  /** ID da tarefa (mono) e onde ela está. */
  taskRef?: { displayId: string | null; where: string }
  keys?: string
  /** Tarefa fora do quadro: abre a página no Notion. */
  url?: string
}

export interface CommandItem {
  id: string
  label: string
  auxiliaryData?: CommandData
}

interface SearchSource {
  bootstrap(): Promise<CommandItem[]>
  search(query: string): Promise<CommandItem[]>
}

/** Comandos fixos de navegação, com o atalho de cada um, e as seções de Configurações. */
function navigationItems(hasProject: boolean): CommandItem[] {
  const group = 'Ir para'
  const items: CommandItem[] = SHORTCUTS.filter((s) => hasProject || !s.isProjectScreen).map(
    (s) => ({
      id: `go:${s.route.name}`,
      label: s.label,
      auxiliaryData: { group, route: s.route, keys: s.keys }
    })
  )
  const sections = (Object.keys(SETTINGS_TITLES) as SettingsSection[]).filter(
    (section) => hasProject || (section !== 'board' && section !== 'agents')
  )
  for (const section of sections) {
    items.push({
      id: `go:settings:${section}`,
      label: SETTINGS_TITLES[section],
      auxiliaryData: { group, route: { name: 'settings', section } }
    })
  }
  if (hasProject) {
    items.push({
      id: 'go:settings:board:flows',
      label: 'Modelos do alva-flow',
      auxiliaryData: { group, route: { name: 'settings', section: 'board', tab: 'flows' } }
    })
  }
  return items
}

/** Tarefas de todos os projetos vinculados (o main responde do cache de 60 s quando pode). */
async function loadTasks(projects: readonly ProjectView[]): Promise<CommandItem[]> {
  const views = await Promise.all(
    projects.map((p) =>
      window.orkio.board
        .get(p.id)
        .then((r) => (r.ok ? r.value : null))
        .catch(() => null)
    )
  )
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
  const r = await window.orkio.notionWorkspace.searchTasks(query).catch(() => null)
  if (!r?.ok) return []
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
 * Command Palette (Ctrl/Cmd+K): tarefas, telas e troca de projeto. `mode="tasks"` (botão "Buscar
 * tarefa" da lateral) busca só tarefas, direto no Notion. Só navega; nada aqui escreve
 * no Notion nem roda agentes.
 */
export function CommandMenu({
  isOpen,
  onOpenChange,
  projects,
  currentProjectId,
  onRun,
  mode = 'all'
}: {
  mode?: 'all' | 'tasks'
  isOpen: boolean
  onOpenChange(isOpen: boolean): void
  projects: readonly ProjectView[]
  currentProjectId: string | null
  onRun(item: CommandData): void
}): React.JSX.Element {
  const source = useMemo((): SearchSource => {
    let tasks: Promise<CommandItem[]> | null = null
    const all = async (): Promise<CommandItem[]> => {
      tasks ??= loadTasks(projects)
      const switchItems: CommandItem[] = projects
        .filter((p) => p.id !== currentProjectId)
        .map((p) => ({
          id: `project:${p.id}`,
          label: `Trocar para ${p.name}`,
          auxiliaryData: { group: 'Projetos', projectId: p.id }
        }))
      return [...(await tasks), ...navigationItems(projects.length > 0), ...switchItems]
    }
    // Modo tarefas: tarefas do quadro (para saber o que abre no Orkio) + busca no Notion.
    let board: Promise<Set<string>> | null = null
    const notion = async (query: string): Promise<CommandItem[]> => {
      board ??= loadTasks(projects).then(
        (items) =>
          new Set(
            items.flatMap((i) =>
              i.auxiliaryData?.route?.name === 'task'
                ? [`${i.auxiliaryData.route.projectId}:${i.auxiliaryData.route.taskId}`]
                : []
            )
          )
      )
      return searchNotionTasks(query, await board)
    }
    if (mode === 'tasks') {
      return { bootstrap: () => notion(''), search: (query) => notion(query) }
    }
    return {
      bootstrap: async () => {
        const items = await all()
        // Sem busca: as telas primeiro, e só algumas tarefas.
        const tasksOnly = items.filter((i) => i.auxiliaryData?.group === 'Tarefas').slice(0, 5)
        return [...items.filter((i) => i.auxiliaryData?.group !== 'Tarefas'), ...tasksOnly]
      },
      search: async (query) => {
        const q = normalizeLabel(query)
        const items = await all()
        return items.filter((i) => normalizeLabel(i.label).includes(q)).slice(0, 50)
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
    // Busca no Notion com um respiro entre teclas; a lista local responde na hora.
    const delay = mode === 'tasks' && query.trim() ? 250 : 0
    const timer = window.setTimeout(() => {
      const run = query.trim() ? source.search(query) : source.bootstrap()
      void run.then((list) => alive && setItems(list)).catch(() => alive && setItems([]))
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

  const label = mode === 'tasks' ? 'Buscar tarefas no Notion' : 'Buscar tarefas e comandos'
  return (
    <CommandDialog
      open={isOpen}
      onOpenChange={onOpenChange}
      title={label}
      description={
        mode === 'tasks'
          ? 'Título ou ID de qualquer tarefa do banco de Tarefas do Notion.'
          : 'Tarefas, telas e projetos.'
      }
      showCloseButton={false}
      shouldFilter={false}
    >
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder={
          mode === 'tasks' ? 'Título ou ID (ex.: ORK-142)…' : 'Buscar tarefa, tela ou projeto…'
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

/** "mod+1" → "Ctrl 1" / "⌘ 1". */
export function formatKeys(keys: string): string {
  const mac = navigator.userAgent.includes('Mac')
  return keys
    .split('+')
    .map((k) => (k === 'mod' ? (mac ? '⌘' : 'Ctrl') : k.length === 1 ? k.toUpperCase() : k))
    .join(' ')
}
