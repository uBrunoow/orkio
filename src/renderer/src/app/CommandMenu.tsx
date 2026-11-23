import { useMemo, useRef } from 'react'
import { CommandPalette } from '@astryxdesign/core/CommandPalette'
import { Code } from '@astryxdesign/core/Code'
import { HStack } from '@astryxdesign/core/HStack'
import { Kbd } from '@astryxdesign/core/Kbd'
import { StackItem } from '@astryxdesign/core/Stack'
import { Text } from '@astryxdesign/core/Text'
import type { SearchableItem, SearchSource } from '@astryxdesign/core/Typeahead'
import type { BoardCard, ProjectView } from '../../../shared/ipc-contract'
import { SETTINGS_TITLES, type Route, type SettingsSection } from './routes'
import { SHORTCUTS } from './shortcuts'

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

export type CommandItem = SearchableItem<CommandData>

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
  // id → comando, dos itens já mostrados (a seleção só devolve o id).
  const index = useRef(new Map<string, CommandData>())
  const source = useMemo((): SearchSource<CommandItem> => {
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
      const items = [...(await tasks), ...navigationItems(projects.length > 0), ...switchItems]
      for (const item of items)
        if (item.auxiliaryData) index.current.set(item.id, item.auxiliaryData)
      return items
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
      const items = await searchNotionTasks(query, await board)
      for (const item of items)
        if (item.auxiliaryData) index.current.set(item.id, item.auxiliaryData)
      return items
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
        const q = normalize(query)
        const items = await all()
        return items.filter((i) => normalize(i.label).includes(q)).slice(0, 50)
      }
    }
    // Recria a fonte (e relê as tarefas) a cada abertura.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, currentProjectId, isOpen, mode])

  return (
    <CommandPalette<CommandItem>
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      label={mode === 'tasks' ? 'Buscar tarefas no Notion' : 'Buscar tarefas e comandos'}
      searchSource={source}
      value=""
      onValueChange={(id) => {
        const data = index.current.get(id)
        if (data) onRun(data)
      }}
      emptySearchText={
        mode === 'tasks' ? 'Nenhuma tarefa sua com esse ID ou título' : 'Nada encontrado'
      }
      emptyBootstrapText={
        mode === 'tasks' ? 'Nenhuma tarefa sua nos projetos vinculados' : 'Digite para buscar'
      }
      renderItem={(item) => <CommandRow item={item} />}
    />
  )
}

function CommandRow({ item }: { item: CommandItem }): React.JSX.Element {
  const data = item.auxiliaryData
  if (data?.taskRef) {
    const title = data.taskRef.displayId
      ? item.label.slice(data.taskRef.displayId.length).trim()
      : item.label
    return (
      <HStack gap={2} vAlign="center" width="100%">
        {data.taskRef.displayId && <Code>{data.taskRef.displayId}</Code>}
        <StackItem size="fill">
          <Text>{title}</Text>
        </StackItem>
        <Text type="supporting" color="secondary">
          {data.taskRef.where}
        </Text>
      </HStack>
    )
  }
  return (
    <HStack gap={2} vAlign="center" width="100%">
      <StackItem size="fill">
        <Text>{item.label}</Text>
      </StackItem>
      {data?.keys && <Kbd keys={data.keys} />}
    </HStack>
  )
}

/** Busca sem diferenciar maiúsculas e acentos. */
function normalize(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}
