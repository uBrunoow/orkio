import { Button } from '@/components/ui/button'
import { Timestamp } from '@/components/Timestamp'
import { EVENT_META, type AutomationRule } from '../../../../shared/automation'
import { describeRule } from '../../../../shared/flow'
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
  const executions = activity ? ruleExecutions(activity, rule.id) : null
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
        <div className="flex flex-col gap-1">
          <p>Quando {EVENT_META[rule.trigger].phrase}.</p>
          {conditions.map((c) => (
            <p key={c} className="text-xs text-muted-foreground">
              {c}
            </p>
          ))}
        </div>
      }
      does={
        <div className="flex flex-col gap-1">
          <p>
            {rule.action.type === 'move_to_stage'
              ? `Move a tarefa para ${name(rule.action.stageId)} (e o status no Notion junto).`
              : `Avisa no desktop: “${rule.action.message}”. A tarefa fica onde está.`}
          </p>
          {rule.notify && rule.action.type === 'move_to_stage' && (
            <p className="text-xs text-muted-foreground">E avisa no desktop quando mover.</p>
          )}
        </div>
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
        { label: 'Evento', value: EVENT_META[rule.trigger].label },
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
        <Button variant="ghost" onClick={onToggle}>
          {rule.enabled ? 'Desativar' : 'Ativar'}
        </Button>
      }
      onEdit={onEdit}
    />
  )
}
