/**
 * "Em que pé está" da tarefa (puro, sem React): marcos do trabalho lidos do que o app já tem
 * (task do Backlog.md vinculada, execuções do Claude Code, ambiente e sinais do GitHub). Nada é
 * guardado nem buscado na rede aqui.
 */
import type { AgentRunView } from '../../../../shared/agent-run'
import { ALVA_STATUSES, type BacklogTaskInfo } from '../../../../shared/alva'
import type { TaskSignals } from '../../../../shared/task-signals'
import { plural } from '../../lib/format'

export type MilestoneKey = 'spec' | 'plan' | 'code' | 'pr' | 'review' | 'merge'
/** `waiting` = é o marco atual e algo espera você; `problem` = travou (CI, alterações pedidas). */
export type MilestoneState = 'done' | 'current' | 'waiting' | 'problem' | 'todo'

export interface Milestone {
  key: MilestoneKey
  label: string
  state: MilestoneState
  detail: string
}

export interface ProgressInput {
  /** Task do Backlog.md vinculada (alva-flow, 5B); `null` = sem vínculo. */
  backlog: { linked: string | null; task: BacklogTaskInfo | null } | null
  signals: TaskSignals | undefined
  /** Execuções do Claude Code da tarefa (mais nova primeiro). */
  runs: readonly AgentRunView[]
  /** Mudanças não commitadas no ambiente (`null` = sem ambiente ou ilegível). */
  uncommitted: number | null
  /** Algo rodando agora (fluxo ou Claude Code). */
  running: boolean
  /** Pedidos/decisões esperando você. */
  waiting: number
}

function statusRank(status: string | undefined): number {
  return status ? (ALVA_STATUSES as readonly string[]).indexOf(status) : -1
}

export function taskProgress(input: ProgressInput): Milestone[] {
  const { backlog, signals, runs } = input
  const pr = signals?.pr ?? null
  const hasPr = !!pr && pr.state !== 'closed'
  const merged = !!pr && (pr.merged || pr.state === 'merged')
  const rank = statusRank(backlog?.task?.status)
  const lastSummary = runs.find((r) => r.summary)?.summary ?? null
  const commits = lastSummary?.commits.length ?? 0
  const branch =
    (signals?.localBranches.length ?? 0) > 0 || (signals?.remoteBranches.length ?? 0) > 0
  const out: Milestone[] = []

  if (backlog?.linked) {
    const task = backlog.task
    out.push({
      key: 'spec',
      label: 'Spec',
      state: rank >= 1 || hasPr ? 'done' : 'todo',
      detail: !task
        ? 'arquivo não encontrado'
        : rank >= 1
          ? task.id
          : task.openQuestions > 0
            ? plural(task.openQuestions, 'pergunta em aberto', 'perguntas em aberto')
            : 'em escrita'
    })
    out.push({
      key: 'plan',
      label: 'Plano',
      state: rank >= 2 || hasPr ? 'done' : 'todo',
      detail: rank >= 2 ? `critérios ${task?.criteria.done ?? 0}/${task?.criteria.total ?? 0}` : '—'
    })
  }

  const codeDone = hasPr || merged || rank >= 3
  const codeParts = [
    commits > 0 ? plural(commits, 'commit', 'commits') : null,
    input.uncommitted ? `${input.uncommitted} sem commit` : null
  ].filter(Boolean)
  out.push({
    key: 'code',
    label: 'Código',
    state: codeDone ? 'done' : 'todo',
    detail:
      codeParts.join(' · ') ||
      (codeDone ? 'pronto' : runs.length > 0 || branch ? 'em andamento' : '—')
  })

  const checks = pr?.checks ?? null
  out.push({
    key: 'pr',
    label: 'PR',
    state: merged ? 'done' : hasPr ? (checks === 'failure' ? 'problem' : 'done') : 'todo',
    detail: !pr
      ? '—'
      : pr.state === 'closed' && !merged
        ? `#${pr.number} fechada`
        : [
            `#${pr.number}${pr.state === 'draft' ? ' rascunho' : ''}`,
            checks === 'success'
              ? 'CI passou'
              : checks === 'failure'
                ? 'CI falhou'
                : checks === 'pending'
                  ? 'CI rodando'
                  : null
          ]
            .filter(Boolean)
            .join(' · ')
  })

  const review = pr?.reviewDecision ?? null
  out.push({
    key: 'review',
    label: 'Revisão',
    state:
      merged || review === 'approved'
        ? 'done'
        : review === 'changes_requested'
          ? 'problem'
          : 'todo',
    detail: merged
      ? 'aprovada'
      : review === 'approved'
        ? 'aprovada'
        : review === 'changes_requested'
          ? 'alterações pedidas'
          : hasPr
            ? pr?.unresolvedComments
              ? plural(pr.unresolvedComments, 'comentário aberto', 'comentários abertos')
              : 'aguardando'
            : '—'
  })

  out.push({
    key: 'merge',
    label: 'Merge',
    state: merged ? 'done' : 'todo',
    detail: merged ? 'feito' : '—'
  })

  // O primeiro marco não feito é o atual (a menos que já esteja com problema).
  const current = out.find((m) => m.state !== 'done')
  if (current && current.state === 'todo') {
    current.state = input.waiting > 0 ? 'waiting' : 'current'
    if (input.waiting > 0) current.detail = 'esperando você'
    else if (input.running && current.detail === '—') current.detail = 'rodando'
  }
  return out
}
