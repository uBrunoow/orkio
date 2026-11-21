import { HStack } from '@astryxdesign/core/HStack'
import { Icon } from '@astryxdesign/core/Icon'
import { IconButton } from '@astryxdesign/core/IconButton'
import { Item } from '@astryxdesign/core/Item'
import { List } from '@astryxdesign/core/List'
import { Text } from '@astryxdesign/core/Text'
import { Timestamp } from '@astryxdesign/core/Timestamp'
import type { AgentBadge } from '../../../../shared/agent'
import type { BoardHistoryEntry } from '../../../../shared/ipc-contract'
import { branchUrl, describeEvent, prNumber, prUrl } from '../../../../shared/task-history'
import {
  AutomationIcon,
  ClaudeLogo,
  ExternalLinkIcon,
  GitHubLogo,
  NotionLogo,
  UserIcon,
  type SvgIcon
} from '../../components/icons'
import { AgentAvatar } from '../agents/AgentAvatar'

type Actor = { name: string; icon: SvgIcon } | { name: string; agent: true }

/**
 * Quem "fala" em cada evento: o agente (quando o evento traz o nome dele), o Claude Code, o fluxo,
 * o Notion, o GitHub ou você. Puro: só lê `kind`, `source` e `detail` do task_events.
 */
export function eventActor(e: BoardHistoryEntry): Actor {
  const agent = e.detail?.['agent']
  if (typeof agent === 'string' && agent) return { name: agent, agent: true }
  if (e.kind.startsWith('run_')) return { name: 'Claude Code', icon: ClaudeLogo }
  if (e.kind === 'gate_approved' || e.kind === 'gate_rejected')
    return { name: 'Você', icon: UserIcon }
  if (e.kind === 'delivery' || e.kind === 'artifact_published')
    return { name: 'GitHub', icon: GitHubLogo }
  if (e.kind.startsWith('flow_') || e.kind.startsWith('step_') || e.kind === 'gate_waiting')
    return { name: 'Fluxo', icon: AutomationIcon }
  if (e.source === 'notion' || e.kind === 'sync_ok') return { name: 'Notion', icon: NotionLogo }
  if (e.source === 'automation') return { name: 'Automação', icon: AutomationIcon }
  return { name: 'Você', icon: UserIcon }
}

/**
 * Histórico da tarefa como conversa (fase 5): do mais antigo ao mais novo, cada evento com quem
 * falou, a frase e quando. Sem balões nem cor de destaque: a decisão pendente fica no topo do
 * painel, não aqui.
 */
export function TaskTimeline({
  history,
  agent,
  stageName
}: {
  /** Como vem do main: mais novo primeiro. */
  history: readonly BoardHistoryEntry[]
  agent: AgentBadge | null
  stageName(id: string | null): string
}): React.JSX.Element {
  const ordered = [...history].reverse()
  return (
    <List density="compact" aria-label="Histórico da tarefa">
      {ordered.map((e, i) => {
        const actor = eventActor(e)
        const prev = i > 0 ? eventActor(ordered[i - 1]!) : null
        // Mesmo autor em sequência: só a primeira linha mostra o avatar e o nome.
        const repeated = prev?.name === actor.name
        const link = prUrl(e) ?? branchUrl(e)
        return (
          <Item
            as="li"
            key={e.id}
            align="start"
            startContent={
              repeated ? (
                <Icon
                  icon={UserIcon}
                  color="tertiary"
                  aria-hidden
                  style={{ visibility: 'hidden' }}
                />
              ) : 'agent' in actor ? (
                <AgentAvatar
                  name={actor.name}
                  color={agent?.name === actor.name ? agent.color : 'blue'}
                  {...(agent?.name === actor.name ? { seed: agent.key } : {})}
                />
              ) : (
                <Icon icon={actor.icon} color="secondary" />
              )
            }
            label={describeEvent(e, stageName)}
            description={
              <HStack gap={1} vAlign="center">
                {!repeated && (
                  <Text type="supporting" color="secondary" weight="medium">
                    {actor.name}
                  </Text>
                )}
                <Timestamp value={e.at} format="auto" />
              </HStack>
            }
            {...(link
              ? {
                  endContent: (
                    <IconButton
                      size="sm"
                      variant="ghost"
                      label={
                        prNumber(e) !== null
                          ? `Abrir a PR #${prNumber(e)} no GitHub`
                          : 'Abrir a branch no GitHub'
                      }
                      icon={<Icon icon={ExternalLinkIcon} />}
                      onClick={() => void window.orkio.openExternal(link)}
                    />
                  )
                }
              : {})}
          />
        )
      })}
    </List>
  )
}
