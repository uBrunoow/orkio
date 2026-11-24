/**
 * Fluxo pausado por um problema (puro): o que aconteceu, o que isso quer dizer e o que fazer.
 * A causa vem do motivo da pausa (`FLOW_PAUSES`) ou, quando um passo falhou, do código da falha
 * que o Orkio guardou no passo (`StepFailure.code`), nunca do texto da mensagem.
 */
import { ALVA_FAILURES, alvaCommandOf } from './alva'
import { FLOW_PAUSES, isProblem, type PauseProblemKind } from './flow-run-state'
import { isInstallUrl } from './github-names'
import type { FlowRunView, Step } from './task-flow'

/** Causa que vem da falha do passo (pelo código). */
export type FailureProblemKind =
  | 'uncommitted'
  | 'credentials'
  | 'push_rejected'
  | 'timed_out'
  | 'claude_error'
  | 'no_task'
  | 'no_description'
  | 'no_link'
  | 'review_invalid'
  | 'review_not_installed'
  | 'review_not_configured'
  | 'review_no_site'
  | 'review_maybe_posted'
  | 'generic'

export type ProblemKind = FailureProblemKind | PauseProblemKind

/**
 * Código da falha (`StepFailure.code`, gravado no passo) → causa. Códigos que não estão aqui (e
 * linhas antigas, gravadas antes do código existir) viram `generic`: o cartão mostra a mensagem
 * guardada e as saídas de sempre.
 */
const KIND_BY_CODE: Readonly<Record<string, FailureProblemKind>> = {
  // DeliveryError (push).
  dirty: 'uncommitted',
  credentials: 'credentials',
  rejected: 'push_rejected',
  // Fim da execução do Claude Code (`RunFinished.code`).
  timed_out: 'timed_out',
  claude_error: 'claude_error',
  // ClaudeService.flowContext.
  no_description: 'no_description',
  // alva-flow.
  [ALVA_FAILURES.noTaskCreated]: 'no_task',
  [ALVA_FAILURES.notLinked]: 'no_link',
  // publish_review (`PUBLISH_FAILURES`, os códigos já são as causas).
  review_invalid: 'review_invalid',
  review_not_installed: 'review_not_installed',
  review_not_configured: 'review_not_configured',
  review_no_site: 'review_no_site',
  review_maybe_posted: 'review_maybe_posted'
}

export function classifyFailure(code: string | null): FailureProblemKind {
  return (code !== null && KIND_BY_CODE[code]) || 'generic'
}

const HINT: Record<FailureProblemKind, string> = {
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
  if (run.status !== 'paused' || !isProblem(run.pauseReason) || !run.pauseReason) return null
  const pause = FLOW_PAUSES[run.pauseReason]
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

  const fromPause = typeof pause.problem === 'object' ? pause.problem : null
  const kind: ProblemKind = fromPause
    ? fromPause.kind
    : pause.problem === 'from_failure'
      ? classifyFailure(entry?.code ?? null)
      : 'generic'

  // Rodar de novo o passo que resolve: o /commit antes de um push recusado, o /spec antes de um
  // passo que não achou a task do Backlog.
  const previous = !current
    ? null
    : kind === 'uncommitted'
      ? previousCommand(run.steps, current.id)
      : kind === 'no_link'
        ? previousCommand(run.steps, current.id, (c) => alvaCommandOf(c) === 'spec')
        : kind === 'review_invalid'
          ? previousCommand(run.steps, current.id)
          : null
  const label = previous ? rerunLabel(previous) : null
  return {
    kind,
    title: `${pause.label}${current ? ` — ${current.name}` : ''}`,
    reason,
    hint: fromPause ? fromPause.hint : HINT[kind as FailureProblemKind],
    stepName: current?.name ?? null,
    runId: entry?.runId ?? null,
    rerun: previous && label ? { stepId: previous.id, label } : null,
    link: installLink(kind, entry?.link ?? null)
  }
}

/** O link que a falha trouxe, só se for o de instalação do App (defesa em profundidade). */
function installLink(kind: ProblemKind, link: string | null): FlowProblem['link'] {
  if (kind !== 'review_not_installed' || !isInstallUrl(link)) return null
  return { label: 'Instalar o GitHub App do Orkio', url: link }
}
