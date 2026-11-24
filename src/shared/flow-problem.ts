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
  | 'no_description'
  | 'no_link'
  | 'interrupted'
  | 'loop_guard'
  | 'gate_timeout'
  | 'daily_limit'
  | 'review_invalid'
  | 'review_not_installed'
  | 'review_not_configured'
  | 'review_no_site'
  | 'review_maybe_posted'
  | 'generic'

/** Reconhece a causa pelo texto guardado no passo. */
export function classifyMessage(message: string | null): ProblemKind {
  if (!message) return 'generic'
  if (/a revisão em json/i.test(message)) return 'review_invalid'
  if (/app do orkio não está instalado/i.test(message)) return 'review_not_installed'
  if (/app do orkio ainda não está configurado/i.test(message)) return 'review_not_configured'
  if (/não sabe o endereço do site do orkio/i.test(message)) return 'review_no_site'
  if (/a revisão pode ter sido publicada/i.test(message)) return 'review_maybe_posted'
  if (/mudanças não commitadas/i.test(message)) return 'uncommitted'
  if (/pediu credenciais/i.test(message)) return 'credentials'
  if (/recusou o push/i.test(message)) return 'push_rejected'
  if (/tempo limite esgotado/i.test(message)) return 'timed_out'
  if (/sem descrição no notion/i.test(message)) return 'no_description'
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
  no_description:
    'A página da tarefa no Notion está vazia: o Claude não teria o que especificar. Escreva no Notion o que precisa ser feito (problema, contexto, o que é "pronto") e retome.',
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
  review_invalid:
    'O passo anterior precisa responder só com a revisão em JSON ({event, summary, comments}). Nada foi publicado. Rode a conversão de novo e retome.',
  review_not_installed:
    'O GitHub App do Orkio precisa estar instalado no repositório para publicar como orkio[bot]. Nada foi publicado. Instale o App e retome: o Orkio mostra a revisão de novo para você aprovar.',
  review_not_configured:
    'O site do Orkio ainda não tem o GitHub App configurado (veja docs/github-app.md). Nada foi publicado. Pule este passo para seguir sem publicar.',
  review_no_site:
    'Este build do Orkio está sem o endereço do site (MAIN_VITE_SITE_URL). Defina e reinicie o app (em dev, no .env.development) e retome. Nada foi publicado.',
  review_maybe_posted:
    'O site do Orkio demorou e a revisão pode já estar na PR. Abra a PR e confira: se estiver lá, pule este passo; se não, retome (o Orkio mostra a revisão de novo antes de publicar).',
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
  /** Link útil (ex.: instalar o GitHub App do Orkio), só de formatos conhecidos. */
  link: { label: string; url: string } | null
}

/** Página de instalação do GitHub App (mesmo formato aceito pelo poster e pela allowlist). */
const INSTALL_URL =
  /https:\/\/github\.com\/apps\/[a-z0-9][a-z0-9-]{0,99}\/installations\/new(?![\w/-])/

/** Passos que não são "problema" (esperam outro fluxo ou uma escolha, que têm tela própria). */
const NOT_A_PROBLEM = new Set(['waiting_slot', 'waiting_agent', 'needs_choice'])

/** Rótulo do botão "Rodar … de novo": `/commit` ou, num pedido em texto, o nome do passo. */
function rerunLabel(step: Step): string | null {
  if (step.type !== 'claude_command') return null
  if (!step.command) return step.name ? `Rodar “${step.name}” de novo` : null
  return `Rodar /${step.command.split(':').pop() || step.command} de novo`
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
        : kind === 'review_invalid'
          ? previousCommand(run.steps, current.id)
          : null
  const label = previous ? rerunLabel(previous) : null
  return {
    kind,
    title: `${FLOW_PAUSE_LABEL[run.pauseReason]}${current ? ` — ${current.name}` : ''}`,
    reason,
    hint: HINT[kind],
    stepName: current?.name ?? null,
    runId: entry?.runId ?? null,
    rerun: previous && label ? { stepId: previous.id, label } : null,
    link: installLink(kind, reason)
  }
}

function installLink(kind: ProblemKind, reason: string | null): FlowProblem['link'] {
  if (kind !== 'review_not_installed' || !reason) return null
  const url = INSTALL_URL.exec(reason)?.[0]
  return url ? { label: 'Instalar o GitHub App do Orkio', url } : null
}
