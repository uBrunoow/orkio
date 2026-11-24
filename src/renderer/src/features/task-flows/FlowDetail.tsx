import { Timestamp } from '@/components/Timestamp'
import type { ActivityItem } from '../../../../shared/overview'
import type { Flow, StageFlow } from '../../../../shared/task-flow'
import { stepSentence, stepShort } from './step-text'
import { ExecutionsTable, SentenceDetail } from '../../components/SentenceDetail'
import { flowExecutions } from '../../components/executions'

function joinPt(parts: string[]): string {
  if (parts.length <= 1) return parts.join('')
  return `${parts.slice(0, -1).join(', ')} e ${parts[parts.length - 1]}`
}

/** "Ao entrar em Revisando" / "Pelo botão em Em andamento" / "Só à mão". */
function startPhrase(bindings: readonly StageFlow[], stageName: (id: string) => string): string {
  const onEnter = bindings.filter((b) => b.mode === 'on_enter').map((b) => stageName(b.stageId))
  const manual = bindings.filter((b) => b.mode === 'manual').map((b) => stageName(b.stageId))
  if (onEnter.length > 0) return `Quando a tarefa entra em ${joinPt(onEnter)}`
  if (manual.length > 0) return `Pelo botão “Rodar fluxo” em ${joinPt(manual)}`
  return 'Quando você roda à mão'
}

/** Título-frase do fluxo: como começa e a sequência de passos. */
function describeFlow(
  flow: Flow,
  bindings: readonly StageFlow[],
  stageName: (id: string) => string
): string {
  const start = startPhrase(bindings, stageName)
  if (flow.steps.length === 0) return `${start}: ainda sem passos.`
  return `${start}: ${joinPt(flow.steps.map((s) => stepShort(s)))}.`
}

/** Fluxo em frase: quando começa, cada passo, quando rodou. O editor fica em "Editar". */
export function FlowDetail({
  flow,
  bindings,
  stageName,
  activity,
  onEdit
}: {
  flow: Flow
  /** Ligações deste fluxo às colunas (já filtradas e ativas). */
  bindings: readonly StageFlow[]
  stageName(id: string): string
  /** Atividade de fluxos do projeto; null enquanto carrega. */
  activity: readonly ActivityItem[] | null
  onEdit(): void
}): React.JSX.Element {
  const stepName = (id: string): string => flow.steps.find((s) => s.id === id)?.name ?? id
  const executions = activity ? flowExecutions(activity, flow) : null
  const last = executions?.[0]
  const commands = [
    ...new Set(
      flow.steps.flatMap((s) => (s.type === 'claude_command' && s.command ? [`/${s.command}`] : []))
    )
  ]
  return (
    <SentenceDetail
      label={`Fluxo ${flow.name}`}
      sentence={describeFlow(flow, bindings, stageName)}
      starts={
        <div className="flex flex-col gap-1">
          {bindings.length === 0 ? (
            <p>
              Não está ligado a nenhuma coluna. Ligue em Etapas e automações (“Fluxo desta coluna”)
              ou rode pelo painel da tarefa.
            </p>
          ) : (
            bindings.map((b) => (
              <p key={b.stageId}>
                {b.mode === 'on_enter'
                  ? `Quando a tarefa entra em ${stageName(b.stageId)}.`
                  : `Pelo botão “Rodar fluxo” em tarefas de ${stageName(b.stageId)}.`}
              </p>
            ))
          )}
        </div>
      }
      does={
        flow.steps.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nenhum passo ainda.</p>
        ) : (
          <ol aria-label="Passos em frase" className="flex flex-col gap-1">
            {flow.steps.map((s, i) => (
              <li key={s.id} className="flex gap-2">
                <span className="tabular w-4 shrink-0 font-mono text-xs leading-5 text-subtle-foreground">
                  {i + 1}.
                </span>
                <span className="min-w-0">{stepSentence(s, stepName)}</span>
              </li>
            ))}
          </ol>
        )
      }
      executions={
        <ExecutionsTable
          executions={executions}
          empty="Ainda não rodou (nos eventos recentes do projeto)."
        />
      }
      details={[
        { label: 'Passos', value: String(flow.steps.length) },
        {
          label: 'Colunas',
          value: bindings.length > 0 ? joinPt(bindings.map((b) => stageName(b.stageId))) : 'Nenhuma'
        },
        { label: 'Comandos', value: commands.length > 0 ? commands.join(', ') : 'Nenhum' },
        {
          label: 'Última execução',
          value: last ? <Timestamp value={last.at} /> : 'Nunca'
        },
        { label: 'Execuções recentes', value: executions ? String(executions.length) : '…' },
        {
          label: 'Id',
          value: <code className="font-mono text-xs text-subtle-foreground">{flow.id}</code>
        }
      ]}
      onEdit={onEdit}
    />
  )
}
