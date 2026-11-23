import { HStack } from '@astryxdesign/core/HStack'
import { Icon } from '@astryxdesign/core/Icon'
import { Item } from '@astryxdesign/core/Item'
import { List } from '@astryxdesign/core/List'
import { Text } from '@astryxdesign/core/Text'
import { VStack } from '@astryxdesign/core/VStack'
import type { FlowRunView } from '../../../../shared/task-flow'
import { DoneIcon, DotIcon, ProblemIcon, TodoIcon } from '../../components/icons'
import { flowPlan, planProgress, type PlanState } from './flow-plan'

const STATE: Record<
  PlanState,
  {
    label: string
    icon: typeof DoneIcon
    color: 'success' | 'warning' | 'error' | 'accent' | 'tertiary' | 'secondary'
  }
> = {
  done: { label: 'feito', icon: DoneIcon, color: 'success' },
  current: { label: 'agora', icon: DotIcon, color: 'accent' },
  waiting: { label: 'esperando você', icon: DotIcon, color: 'warning' },
  failed: { label: 'parou aqui', icon: ProblemIcon, color: 'error' },
  skipped: { label: 'pulado', icon: TodoIcon, color: 'tertiary' },
  next: { label: 'a seguir', icon: TodoIcon, color: 'tertiary' },
  unreached: { label: 'não precisou', icon: TodoIcon, color: 'tertiary' }
}

/**
 * Plano do piloto automático: os passos do fluxo como a lista de tarefas de uma sessão do Claude
 * Code (feito, agora, esperando você, a seguir). A conversa de cada passo fica logo acima, na
 * sessão; aqui é o mapa de onde o fluxo está e do que ainda vai acontecer sem você digitar nada.
 */
export function AutopilotPlan({ run }: { run: FlowRunView }): React.JSX.Element {
  const plan = flowPlan(run)
  const { done, total } = planProgress(plan)
  return (
    <VStack gap={1} role="group" aria-label="Plano do piloto automático">
      <HStack gap={2} vAlign="center">
        <Text type="supporting" weight="medium">
          Plano
        </Text>
        <Text type="supporting" color="secondary" data-testid="autopilot-progress">
          {done} de {total} {total === 1 ? 'passo feito' : 'passos feitos'}
        </Text>
      </HStack>
      <List density="compact" aria-label="Passos do plano">
        {plan.map((p) => {
          const s = STATE[p.state]
          const extra = p.visits > 1 ? ` · ${p.visits}ª vez` : ''
          return (
            <Item
              as="li"
              key={p.id}
              data-state={p.state}
              startContent={<Icon icon={s.icon} size="sm" color={s.color} />}
              label={
                <Text
                  weight={p.state === 'current' || p.state === 'waiting' ? 'semibold' : 'normal'}
                  color={
                    p.state === 'next' || p.state === 'unreached' || p.state === 'skipped'
                      ? 'secondary'
                      : 'primary'
                  }
                >
                  {p.name}
                </Text>
              }
              description={`${p.detail} · ${s.label}${extra}`}
            />
          )
        })}
      </List>
    </VStack>
  )
}
