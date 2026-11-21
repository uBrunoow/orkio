import { Button } from '@astryxdesign/core/Button'
import { Text } from '@astryxdesign/core/Text'
import { Timestamp } from '@astryxdesign/core/Timestamp'
import { VStack } from '@astryxdesign/core/VStack'
import { EVENT_LABELS, type AutomationRule } from '../../../../shared/automation'
import { EVENT_PHRASES, describeRule } from '../../../../shared/flow'
import type { ActivityItem } from '../../../../shared/overview'
import { ExecutionsTable, SentenceDetail } from '../../components/SentenceDetail'
import { StatusToken } from '../../components/StatusToken'
import { ruleExecutions } from '../../components/executions'

function list(names: string[]): string {
  if (names.length <= 1) return names.join('')
  return `${names.slice(0, -1).join(', ')} ou ${names[names.length - 1]}`
}

/** Automação em frase: quando começa, o que faz, quando rodou. O formulário fica em "Editar". */
export function RuleDetail({
  rule,
  index,
  total,
  stages,
  activity,
  onEdit,
  onToggle
}: {
  rule: AutomationRule
  index: number
  total: number
  stages: readonly { id: string; name: string }[]
  /** Atividade de automações do projeto; null enquanto carrega. */
  activity: readonly ActivityItem[] | null
  onEdit(): void
  onToggle(): void
}): React.JSX.Element {
  const name = (id: string): string => stages.find((s) => s.id === id)?.name ?? 'etapa removida'
  const from = rule.conditions?.fromStages ?? []
  const executions = activity ? ruleExecutions(activity, rule.name) : null
  const last = executions?.[0]

  const conditions = [
    from.length > 0 ? `Só se a tarefa estiver em ${list(from.map(name))}.` : null,
    rule.conditions?.notBlocked ? 'Ignora tarefas bloqueadas.' : null,
    rule.conditions?.onlyForward ? 'Só avança (nunca volta etapas).' : null
  ].filter((c): c is string => c !== null)

  return (
    <SentenceDetail
      label={`Automação ${rule.name}`}
      sentence={describeRule(rule, stages)}
      starts={
        <VStack gap={1}>
          <Text>Quando {EVENT_PHRASES[rule.trigger]}.</Text>
          {conditions.map((c) => (
            <Text key={c} type="supporting" color="secondary">
              {c}
            </Text>
          ))}
        </VStack>
      }
      does={
        <VStack gap={1}>
          <Text>
            {rule.action.type === 'move_to_stage'
              ? `Move a tarefa para ${name(rule.action.stageId)} (e o status no Notion junto).`
              : `Avisa no desktop: “${rule.action.message}”. A tarefa fica onde está.`}
          </Text>
          {rule.notify && rule.action.type === 'move_to_stage' && (
            <Text type="supporting" color="secondary">
              E avisa no desktop quando mover.
            </Text>
          )}
        </VStack>
      }
      executions={
        <ExecutionsTable
          executions={executions}
          empty="Ainda não rodou (nos eventos recentes do projeto)."
        />
      }
      details={[
        {
          label: 'Estado',
          value: (
            <StatusToken
              label={rule.enabled ? 'Ativa' : 'Desativada'}
              tone={rule.enabled ? 'success' : 'neutral'}
            />
          )
        },
        { label: 'Nome', value: rule.name },
        { label: 'Evento', value: EVENT_LABELS[rule.trigger] },
        { label: 'Ordem', value: `${index + 1}ª de ${total}` },
        {
          label: 'Última execução',
          value: last ? <Timestamp value={last.at} format="auto" /> : 'Nunca'
        },
        {
          label: 'Execuções recentes',
          value: executions ? String(executions.length) : '…'
        }
      ]}
      actions={
        <Button variant="ghost" label={rule.enabled ? 'Desativar' : 'Ativar'} onClick={onToggle} />
      }
      onEdit={onEdit}
    />
  )
}
