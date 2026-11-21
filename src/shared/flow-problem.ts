/**
 * Fluxo pausado por um problema (puro): o que aconteceu, o que isso quer dizer e o que fazer.
 * A causa vem da mensagem que o Orkio guardou no passo; as mensagens são textos fixos do próprio
 * app, então o reconhecimento é por trechos (e o teste confere os textos reais).
 */
import { FLOW_PAUSE_LABEL, type FlowRunView, type Step } from './task-flow'

export type ProblemKind =
  | 'uncommitted'
  | 'credentials'
  | 'push_rejected'
  | 'timed_out'
  | 'claude_error'
  | 'no_task'
  | 'no_link'
  | 'interrupted'
  | 'loop_guard'
  | 'gate_timeout'
  | 'daily_limit'
  | 'generic'

/** Reconhece a causa pelo texto guardado no passo. */
export function classifyMessage(message: string | null): ProblemKind {
  if (!message) return 'generic'
  if (/mudanças não commitadas/i.test(message)) return 'uncommitted'
  if (/pediu credenciais/i.test(message)) return 'credentials'
  if (/recusou o push/i.test(message)) return 'push_rejected'
  if (/tempo limite esgotado/i.test(message)) return 'timed_out'
  if (/usa a task do backlog/i.test(message)) return 'no_link'
  if (/terminou sem criar|arquivo da task vinculada/i.test(message)) return 'no_task'
  if (/o claude code terminou com erro/i.test(message)) return 'claude_error'
  return 'generic'
}

const HINT: Record<ProblemKind, string> = {
  uncommitted:
    'O ambiente tem arquivos que ainda não entraram em nenhum commit, e o push só envia commits. Veja o que falta, faça o commit (ou descarte) e retome.',
  credentials:
    'O git precisou de uma senha e o Orkio não pergunta. Configure o acesso (gh auth setup-git, chave SSH ou gerenciador de credenciais) e retome.',
  push_rejected:
    'O GitHub recusou: a branch remota tem commits que não estão aqui, ou há uma regra de proteção. Atualize a branch no ambiente da tarefa e retome.',
  timed_out:
    'O comando passou do tempo máximo do passo e foi cancelado. Veja a sessão para saber onde travou; retome para tentar de novo ou aumente o tempo do passo em Fluxos.',
  claude_error:
    'O Claude Code encerrou com erro. A sessão do passo mostra o que aconteceu; retome para tentar de novo.',
  no_task:
    'O /spec terminou sem criar nem alterar nenhuma task em backlog/tasks/ que o Orkio consiga ligar a esta tarefa. Veja a sessão e a pasta backlog/tasks/ do ambiente; retome para rodar de novo.',
  no_link:
    'Este passo usa a task do Backlog, e o fluxo ainda não sabe qual é a desta tarefa (o /spec não foi concluído ou foi pulado). Rode o /spec de novo para criar ou escolher a task e depois retome.',
  interrupted:
    'O Orkio foi fechado enquanto este passo rodava. Retome para rodar de novo; pule só se você sabe que ele já terminou.',
  loop_guard:
    'O fluxo passou de 50 passos, o que costuma indicar um loop. Retome para seguir por sua conta ou cancele.',
  gate_timeout: 'A aprovação passou do prazo. Retome para pedir de novo.',
  daily_limit: 'O agente chegou ao limite de hoje. Retomar libera este passo uma vez.',
  generic:
    'Veja a sessão do passo para entender o que aconteceu. Retome para tentar de novo, pule o passo ou cancele o fluxo.'
}

export interface FlowProblem {
  kind: ProblemKind
  /** "Um passo falhou — Push da branch (Orkio)". */
  title: string
  /** O que o Orkio registrou no passo (pode estar vazio). */
  reason: string | null
  /** O que isso quer dizer e o que fazer. */
  hint: string
  stepName: string | null
  /** Execução do Claude Code do passo parado, para abrir a sessão. */
  runId: string | null
  /** Comando anterior que dá para rodar de novo (ex.: /commit antes do push). */
  rerun: { stepId: string; label: string } | null
}

/** Passos que não são "problema" (esperam outro fluxo ou uma escolha, que têm tela própria). */
const NOT_A_PROBLEM = new Set(['waiting_slot', 'waiting_agent', 'needs_choice'])

function commandName(step: Step): string | null {
  return step.type === 'claude_command' ? step.command.split(':').pop() || step.command : null
}

/** O comando do Claude Code mais perto (que passe em `match`), antes do passo parado. */
function previousCommand(
  steps: readonly Step[],
  currentId: string,
  match: (command: string) => boolean = () => true
): Step | null {
  const index = steps.findIndex((s) => s.id === currentId)
  for (let i = index - 1; i >= 0; i--) {
    const s = steps[i]
    if (s?.type === 'claude_command' && match(s.command)) return s
  }
  return null
}

export function describeFlowProblem(run: FlowRunView): FlowProblem | null {
  if (run.status !== 'paused' || !run.pauseReason || NOT_A_PROBLEM.has(run.pauseReason)) return null
  const current = run.steps.find((s) => s.id === run.currentStep) ?? null
  const entry = current
    ? [...run.history]
        .reverse()
        .find(
          (h) =>
            h.stepId === current.id &&
            (h.status === 'failed' || h.status === 'interrupted' || h.status === 'cancelled')
        )
    : undefined
  const reason = entry?.message ?? null

  const kind: ProblemKind =
    run.pauseReason === 'step_failed'
      ? classifyMessage(reason)
      : run.pauseReason === 'interrupted'
        ? 'interrupted'
        : run.pauseReason === 'loop_guard'
          ? 'loop_guard'
          : run.pauseReason === 'gate_timeout'
            ? 'gate_timeout'
            : run.pauseReason === 'agent_daily_limit'
              ? 'daily_limit'
              : 'generic'

  // Rodar de novo o passo que resolve: o /commit antes de um push recusado, o /spec antes de um
  // passo que não achou a task do Backlog.
  const previous = !current
    ? null
    : kind === 'uncommitted'
      ? previousCommand(run.steps, current.id)
      : kind === 'no_link'
        ? previousCommand(run.steps, current.id, (c) => c.endsWith(':spec'))
        : null
  const name = previous ? commandName(previous) : null
  return {
    kind,
    title: `${FLOW_PAUSE_LABEL[run.pauseReason]}${current ? ` — ${current.name}` : ''}`,
    reason,
    hint: HINT[kind],
    stepName: current?.name ?? null,
    runId: entry?.runId ?? null,
    rerun: previous && name ? { stepId: previous.id, label: `Rodar /${name} de novo` } : null
  }
}
