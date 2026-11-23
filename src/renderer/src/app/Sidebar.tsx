import { useEffect, useState } from 'react'
import { Divider } from '@astryxdesign/core/Divider'
import { DropdownMenu } from '@astryxdesign/core/DropdownMenu'
import { HStack } from '@astryxdesign/core/HStack'
import { Icon } from '@astryxdesign/core/Icon'
import { Item } from '@astryxdesign/core/Item'
import { Kbd } from '@astryxdesign/core/Kbd'
import { SideNav, SideNavItem, SideNavSection } from '@astryxdesign/core/SideNav'
import { StackItem } from '@astryxdesign/core/Stack'
import { Text } from '@astryxdesign/core/Text'
import { Token } from '@astryxdesign/core/Token'
import { VStack } from '@astryxdesign/core/VStack'
import type { ProjectView } from '../../../shared/ipc-contract'
import {
  AgentsIcon,
  BoardIcon,
  SearchIcon,
  SettingsIcon,
  TONE_DOT_ICONS
} from '../components/icons'
import { OrkioLogo } from '../components/OrkioLogo/OrkioLogo'
import { ROUTE_TITLES, type Route } from './routes'
import { SHORTCUTS } from './shortcuts'
import type { SidebarTask, TaskGroups } from './task-groups'

const isMac = (): boolean => navigator.userAgent.includes('Mac')

/** `aria-keyshortcuts` e o atalho visível (Kbd) de uma tela do menu. */
function shortcutOf(route: Route['name']): { aria: string; keys: string } | null {
  const keys = SHORTCUTS.find((s) => s.route.name === route)?.keys
  if (!keys) return null
  return { aria: keys.replace('mod', isMac() ? 'Meta' : 'Control'), keys }
}

/** Versão do app (rodapé da marca). Só leitura; sem versão, nada aparece. */
function useAppVersion(): string | null {
  const [version, setVersion] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    void window.orkio.updates
      .status()
      .then((s) => alive && setVersion(s.currentVersion))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])
  return version
}

/** Atalho visível; o leitor de tela recebe o mesmo atalho por `aria-keyshortcuts`. */
function Shortcut({ keys }: { keys: string }): React.JSX.Element {
  return (
    <HStack aria-hidden="true">
      <Kbd keys={keys} />
    </HStack>
  )
}

/** Linha de tarefa: ponto do estado, ID em mono apagado e o título. */
function TaskRow({
  task,
  isSelected,
  onOpen
}: {
  task: SidebarTask
  isSelected: boolean
  onOpen(): void
}): React.JSX.Element {
  return (
    <Item
      as="li"
      density="compact"
      isSelected={isSelected}
      startContent={<Icon icon={TONE_DOT_ICONS[task.tone]} size="sm" />}
      label={
        <HStack gap={2} vAlign="center">
          {task.displayId && (
            <Text type="supporting" color="secondary" className="orkio-mono">
              {`${task.displayId} ·`}
            </Text>
          )}
          <StackItem size="fill">
            <Text maxLines={1}>{task.title}</Text>
          </StackItem>
        </HStack>
      }
      onClick={onOpen}
    />
  )
}

/**
 * Lista lateral (mockup da reestruturação): marca e versão, projeto atual, "Buscar tarefa", as
 * tarefas do projeto pelo que fazer agora e, embaixo, as três telas com o atalho.
 */
export function Sidebar({
  route,
  project,
  projects,
  groups,
  setupMissing,
  onChooseProject,
  onManageProjects,
  onSearch,
  onOpenTask,
  onNavigate,
  onContinueSetup,
  account
}: {
  /** Conta da pessoa no rodapé (`AccountMenu`). */
  account: React.ReactNode
  route: Route
  project: ProjectView | null
  projects: ProjectView[] | null
  groups: TaskGroups | null
  setupMissing: number
  onChooseProject(id: string): void
  onManageProjects(): void
  onSearch(): void
  onOpenTask(task: SidebarTask): void
  onNavigate(route: Route): void
  onContinueSetup(): void
}): React.JSX.Element {
  const version = useAppVersion()

  const section = (
    title: string,
    items: SidebarTask[],
    extra?: React.ReactNode
  ): React.ReactNode =>
    items.length === 0 ? null : (
      <SideNavSection
        title={title}
        endContent={
          <Text type="supporting" color="secondary" className="orkio-mono">
            {items.length}
          </Text>
        }
      >
        {items.map((t) => (
          <TaskRow
            key={t.taskId}
            task={t}
            isSelected={route.name === 'task' && route.taskId === t.taskId}
            onOpen={() => onOpenTask(t)}
          />
        ))}
        {extra}
      </SideNavSection>
    )

  const navItem = (
    name: 'board' | 'agents' | 'settings',
    icon: typeof BoardIcon
  ): React.ReactNode => {
    const sc = shortcutOf(name)
    return (
      <SideNavItem
        label={ROUTE_TITLES[name]}
        icon={icon}
        isSelected={route.name === name || (name === 'board' && route.name === 'task')}
        {...(sc ? { 'aria-keyshortcuts': sc.aria, endContent: <Shortcut keys={sc.keys} /> } : {})}
        onClick={() => onNavigate({ name })}
      />
    )
  }

  return (
    <SideNav
      aria-label="Navegação principal"
      header={
        <HStack gap={2} vAlign="center">
          <StackItem size="fill">
            <OrkioLogo variant="simple" withWordmark size={18} />
          </StackItem>
          {version && <Token size="sm" label={`v${version}`} className="orkio-mono" />}
        </HStack>
      }
      topContent={
        <VStack gap={2}>
          <DropdownMenu
            button={{
              label: project ? project.name : 'Nenhum projeto',
              variant: 'secondary',
              width: '100%',
              'aria-label': `Projeto atual: ${project ? project.name : 'nenhum'}. Trocar projeto`
            }}
            items={[
              ...(projects ?? []).map((p) => ({
                label: p.id === project?.id ? `${p.name} (atual)` : p.name,
                onClick: () => onChooseProject(p.id)
              })),
              { label: 'Gerenciar projetos…', onClick: onManageProjects }
            ]}
          />
          <Item
            density="compact"
            startContent={<Icon icon={SearchIcon} size="sm" />}
            label="Buscar tarefa"
            description="No Notion, em todos os projetos"
            onClick={onSearch}
          />
        </VStack>
      }
      footer={
        <VStack gap={2}>
          <SideNavSection title="Telas" isHeaderHidden>
            {navItem('board', BoardIcon)}
            {navItem('agents', AgentsIcon)}
            {navItem('settings', SettingsIcon)}
          </SideNavSection>
          <Divider />
          {account}
        </VStack>
      }
    >
      {project && setupMissing > 0 && (
        <SideNavSection title="Configuração" isHeaderHidden>
          <Item
            as="li"
            density="compact"
            startContent={<Icon icon={TONE_DOT_ICONS.warning} size="sm" />}
            label={`Falta ${setupMissing} ${setupMissing === 1 ? 'passo' : 'passos'} · continuar`}
            onClick={onContinueSetup}
          />
        </SideNavSection>
      )}
      {groups && (
        <>
          {section('Esperando você', groups.waiting)}
          {section('Rodando', groups.running)}
          {section(
            'A fazer',
            groups.todo,
            groups.todoTotal > groups.todo.length ? (
              <Item
                as="li"
                density="compact"
                label={`Ver todas (${groups.todoTotal})`}
                onClick={() => onNavigate({ name: 'board' })}
              />
            ) : undefined
          )}
        </>
      )}
    </SideNav>
  )
}
