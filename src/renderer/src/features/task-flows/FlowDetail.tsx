import { Timestamp } from '@/components/Timestamp'
import type { ActivityItem } from '../../../../shared/overview'
import type { Flow, StageFlow, Step } from '../../../../shared/task-flow'
import { ExecutionsTable, SentenceDetail } from '../../components/SentenceDetail'
import { flowExecutions } from '../../components/executions'

function joinPt(parts: string[]): string {
  if (parts.length <= 1) return parts.join('')
  return `${parts.slice(0, -1).join(', ')} e ${parts[parts.length - 1]}`
}

/** Nome curto do passo para a frase-título ("/revisar", "sua aprovação"…). */
function stepShort(step: Step, actionLabel: (id: string) => string): string {
  switch (step.type) {
    case 'claude_command':
      return `/${step.command || '…'}`
    case 'gate':
      return 'aprovação'
    case 'orkio_action':
      return actionLabel(step.action)
    case 'branch':
      return 'salto'
  }
}

/** Uma frase por passo ("Faz"). */
export function stepSentence(
  step: Step,
  stepName: (id: string) => string,
  actionLabel: (id: string) => string
): string {
  switch (step.type) {
    case 'claude_command':
      return `Roda /${step.command || '…'}${step.args ? ` ${step.args}` : ''} no Claude Code (até ${step.timeoutMin} min)${step.delivery ? ', em modo entrega' : ''}.`
    case 'gate': {
      const show =
        step.show === 'diff'
          ? ' mostrando o diff'
          : step.show === 'summary'
            ? ' com o resumo'
            : step.show === 'backlog'
              ? ' com a spec e o plano'
              : ''
      const reject =
        step.onReject === 'stop'
          ? 'recusar encerra'
          : `recusar volta para ${stepName(step.onReject)}`
      return `Pede sua aprovação${show}: “${step.message}” (${reject}).`
    }
    case 'orkio_action':
      return `${actionLabel(step.action)}.`
    case 'branch':
      return `Se a condição bater, vai para ${stepName(step.then)}; senão ${step.else ? `vai para ${stepName(step.else)}` : 'segue'}.`
  }
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
export function describeFlow(
  flow: Flow,
  bindings: readonly StageFlow[],
  stageName: (id: string) => string,
  actionLabel: (id: string) => string
): string {
  const start = startPhrase(bindings, stageName)
  if (flow.steps.length === 0) return `${start}: ainda sem passos.`
  return `${start}: ${joinPt(flow.steps.map((s) => stepShort(s, actionLabel)))}.`
}

/** Fluxo em frase: quando começa, cada passo, quando rodou. O editor fica em "Editar". */
export function FlowDetail({
  flow,
  bindings,
  stageName,
  actionLabel,
  activity,
  onEdit
}: {
  flow: Flow
  /** Ligações deste fluxo às colunas (já filtradas e ativas). */
  bindings: readonly StageFlow[]
  stageName(id: string): string
  actionLabel(id: string): string
  /** Atividade de fluxos do projeto; null enquanto carrega. */
  activity: readonly ActivityItem[] | null
  onEdit(): void
}): React.JSX.Element {
  const stepName = (id: string): string => flow.steps.find((s) => s.id === id)?.name ?? id
  const executions = activity ? flowExecutions(activity, flow.name) : null
  const last = executions?.[0]
  const commands = [
    ...new Set(
      flow.steps.flatMap((s) => (s.type === 'claude_command' && s.command ? [`/${s.command}`] : []))
    )
  ]
  return (
    <SentenceDetail
      label={`Fluxo ${flow.name}`}
      sentence={describeFlow(flow, bindings, stageName, actionLabel)}
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
                <span className="min-w-0">{stepSentence(s, stepName, actionLabel)}</span>
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
          value: last ? <Timestamp value={last.at} format="auto" /> : 'Nunca'
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
