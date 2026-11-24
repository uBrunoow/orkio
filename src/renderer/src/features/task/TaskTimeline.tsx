import { Button } from '@/components/ui/button'
import { Timestamp } from '../../components/Timestamp'
import type { AgentBadge } from '../../../../shared/agent'
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
import { cn } from '@/lib/utils'
import type { BoardHistoryEntry } from '../../../../shared/board'
import { eventActor, type EventActor } from '../../../../shared/task-events'

type Actor = { name: string; icon: SvgIcon } | { name: string; agent: true }

const ACTORS: Record<Exclude<EventActor['kind'], 'agent'>, { name: string; icon: SvgIcon }> = {
  claude: { name: 'Claude Code', icon: ClaudeLogo },
  you: { name: 'Você', icon: UserIcon },
  github: { name: 'GitHub', icon: GitHubLogo },
  notion: { name: 'Notion', icon: NotionLogo },
  flow: { name: 'Fluxo', icon: AutomationIcon },
  automation: { name: 'Automação', icon: AutomationIcon },
  orkio: { name: 'Orkio', icon: AutomationIcon }
}

export function actorOf(e: BoardHistoryEntry): Actor {
  const actor = eventActor(e)
  return actor.kind === 'agent' ? { name: actor.name, agent: true } : ACTORS[actor.kind]
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
    <ul aria-label="Histórico da tarefa" className="flex flex-col">
      {ordered.map((e, i) => {
        const actor = actorOf(e)
        const prev = i > 0 ? actorOf(ordered[i - 1]!) : null
        const repeated = prev?.name === actor.name
        const link = prUrl(e) ?? branchUrl(e)
        const ActorIcon = 'agent' in actor ? null : actor.icon
        return (
          <li key={e.id} className={cn('flex items-start gap-2.5', repeated ? 'pt-1' : 'pt-3')}>
            <span className="flex size-6 shrink-0 items-center justify-center text-muted-foreground">
              {repeated ? null : 'agent' in actor ? (
                <AgentAvatar
                  name={actor.name}
                  color={agent?.name === actor.name ? agent.color : 'blue'}
                  {...(agent?.name === actor.name ? { seed: agent.key } : {})}
                />
              ) : (
                ActorIcon && <ActorIcon className="size-4" />
              )}
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              {!repeated && (
                <span className="text-xs font-medium text-muted-foreground">{actor.name}</span>
              )}
              <span className="text-sm text-foreground">{describeEvent(e, stageName)}</span>
              <Timestamp value={e.at} className="text-2xs text-subtle-foreground" />
            </div>
            {link && (
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label={
                  prNumber(e) !== null
                    ? `Abrir a PR #${prNumber(e)} no GitHub`
                    : 'Abrir a branch no GitHub'
                }
                onClick={() => void window.orkio.openExternal(link)}
              >
                <ExternalLinkIcon />
              </Button>
            )}
          </li>
        )
      })}
    </ul>
  )
}
