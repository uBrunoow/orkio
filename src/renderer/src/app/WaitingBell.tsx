import { Badge } from '@astryxdesign/core/Badge'
import { DropdownMenu } from '@astryxdesign/core/DropdownMenu'
import { HStack } from '@astryxdesign/core/HStack'
import { Icon } from '@astryxdesign/core/Icon'
import { IconButton } from '@astryxdesign/core/IconButton'
import type { BoardTaskRef } from '../../../shared/ipc-contract'
import { PR_REASON_LABEL, type OverviewSnapshot, type OverviewTask } from '../../../shared/overview'
import { BellIcon } from '../components/icons'

type MenuItem = { label: string; description?: string; onClick?: () => void; isDisabled?: boolean }
type MenuSection = { type: 'section'; title: string; id: string; items: MenuItem[] }

function taskLabel(task: OverviewTask): string {
  return `${task.displayId ?? 'Tarefa'} · ${task.title ?? 'Tarefa do Notion'}`
}

/**
 * Sino da barra superior: tudo que espera você em todos os projetos (substitui a Visão geral) e as
 * PRs com atenção. O número também vai para o ícone do app (pelo main, sem mudança).
 */
export function WaitingBell({
  snapshot,
  onOpen
}: {
  snapshot: OverviewSnapshot | null
  onOpen(ref: BoardTaskRef): void
}): React.JSX.Element {
  const waiting = snapshot?.waiting ?? []
  const prs = snapshot?.prs ?? []
  const label = waiting.length > 0 ? `${waiting.length} esperando você` : 'Nada esperando você'

  const byProject = new Map<string, MenuSection>()
  for (const item of waiting) {
    const section = byProject.get(item.task.projectId) ?? {
      type: 'section' as const,
      id: `p-${item.task.projectId}`,
      title: item.task.projectName,
      items: []
    }
    section.items.push({
      label: taskLabel(item.task),
      description: item.what,
      onClick: () =>
        onOpen({ projectId: item.task.projectId, taskId: item.task.taskId, section: item.section })
    })
    byProject.set(item.task.projectId, section)
  }
  const sections: MenuSection[] = [...byProject.values()]
  if (prs.length > 0) {
    sections.push({
      type: 'section',
      id: 'prs',
      title: 'PRs com atenção',
      items: prs.map((pr) => ({
        label: `#${pr.number} · ${pr.task.title ?? pr.task.displayId ?? 'Tarefa'}`,
        description: pr.reasons.map((r) => PR_REASON_LABEL[r]).join(' · '),
        onClick: () => onOpen({ projectId: pr.task.projectId, taskId: pr.task.taskId })
      }))
    })
  }
  if (sections.length === 0) {
    sections.push({
      type: 'section',
      id: 'empty',
      title: 'Esperando você',
      items: [{ label: 'Nada esperando você', isDisabled: true }]
    })
  }

  return (
    <DropdownMenu
      items={sections}
      alignment="end"
      menuWidth={360}
      menuMaxHeight={480}
      hasChevron={false}
      renderTrigger={(props) => (
        <HStack gap={1} vAlign="center">
          <IconButton
            {...props}
            size="sm"
            variant="ghost"
            icon={<Icon icon={BellIcon} />}
            label={label}
          />
          {waiting.length > 0 && (
            <Badge label={String(waiting.length)} variant="orange" aria-hidden="true" />
          )}
        </HStack>
      )}
    />
  )
}
