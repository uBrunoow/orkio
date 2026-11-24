/**
 * Estado de uma execução de fluxo, visto de fora (puro): está viva? espera você? por quê? é um
 * problema? Fonte única para o main (executor, cartão do quadro, Visão geral) e a tela (bloco do
 * fluxo, plano, cartão de problema). Também a tabela única dos motivos de pausa.
 *
 * Regras de "esperando você" (`waitingKind`):
 * - `gate` (aprovação ou confirmação de uma ação), `decision` (a tarefa saiu da etapa), `choice`
 *   (um extrator pede uma escolha) e `problem` (falha, interrupção, limite de passos, prazo do
 *   gate, limite diário do agente) esperam você: card "Esperando você", sino e lista lateral.
 * - `queue` (`waiting_slot`, `waiting_agent`) NÃO espera você: começa sozinho quando liberar a vaga.
 *   Aparece como rodando (na fila), nunca no sino.
 * - O limite diário do agente é problema (cartão de problema com "Retomar"), não espera comum.
 */
import {
  MAX_EXECUTED_STEPS,
  type FlowPauseReason,
  type FlowRunStatus,
  type FlowRunView
} from './task-flow'

/** Status de uma execução que ainda não terminou (fonte do TS e do SQL do executor). */
export const ACTIVE_FLOW_STATUSES = [
  'running',
  'waiting_gate',
  'paused',
  'awaiting_decision'
] as const satisfies readonly FlowRunStatus[]

/** A execução ainda não terminou (rodando, esperando ou pausada)? */
export function isLive(status: FlowRunStatus): boolean {
  return (ACTIVE_FLOW_STATUSES as readonly FlowRunStatus[]).includes(status)
}

export type WaitingKind = 'gate' | 'decision' | 'choice' | 'problem' | 'queue'

/** Causa de problema que vem do motivo da pausa (a de `step_failed` vem do código da falha). */
export type PauseProblemKind = 'interrupted' | 'loop_guard' | 'gate_timeout' | 'agent_daily_limit'

export interface FlowPauseInfo {
  /** Rótulo curto (histórico, sino, título do cartão de problema). */
  label: string
  /** Texto da notificação de desktop. */
  notify: string
  /** O que espera: você (`problem`/`choice`/`decision`) ou só a vaga (`queue`). */
  waits: Exclude<WaitingKind, 'gate'>
  /**
   * Como o cartão de problema explica: pela falha do passo (`from_failure`), por esta causa e
   * dica, ou nenhum cartão (`null`: espera que tem tela própria).
   */
  problem: 'from_failure' | { kind: PauseProblemKind; hint: string } | null
}

export const FLOW_PAUSES: Record<FlowPauseReason, FlowPauseInfo> = {
  step_failed: {
    label: 'Um passo falhou',
    notify: 'Um passo falhou. Retome, pule ou cancele o fluxo.',
    waits: 'problem',
    problem: 'from_failure'
  },
  interrupted: {
    label: 'O Orkio foi fechado no meio do passo',
    notify: 'O Orkio foi fechado no meio do passo. Retome, pule ou cancele.',
    waits: 'problem',
    problem: {
      kind: 'interrupted',
      hint: 'O Orkio foi fechado enquanto este passo rodava. Retome para rodar de novo; pule só se você sabe que ele já terminou.'
    }
  },
  loop_guard: {
    label: 'Limite de passos atingido (possível loop)',
    notify: 'O fluxo atingiu o limite de passos. Confira se não está em loop.',
    waits: 'problem',
    problem: {
      kind: 'loop_guard',
      hint: `O fluxo passou de ${MAX_EXECUTED_STEPS} passos, o que costuma indicar um loop. Retome para seguir por sua conta ou cancele.`
    }
  },
  gate_timeout: {
    label: 'A aprovação expirou',
    notify: 'A aprovação expirou. Retome para pedir de novo, pule ou cancele.',
    waits: 'problem',
    problem: {
      kind: 'gate_timeout',
      hint: 'A aprovação passou do prazo. Retome para pedir de novo.'
    }
  },
  left_stage: {
    label: 'A tarefa saiu da etapa do fluxo',
    notify: 'Escolha no Orkio: cancelar o fluxo ou deixar terminar.',
    waits: 'decision',
    problem: null
  },
  needs_choice: {
    label: 'O fluxo precisa de uma escolha sua',
    notify: 'Escolha uma opção no Orkio para o fluxo seguir.',
    waits: 'choice',
    problem: null
  },
  waiting_slot: {
    label: 'Aguardando outro fluxo do projeto terminar',
    notify: 'Aguardando outro fluxo do projeto terminar.',
    waits: 'queue',
    problem: null
  },
  waiting_agent: {
    label: 'Aguardando o agente terminar outra tarefa',
    notify: 'Aguardando o agente terminar outra tarefa.',
    waits: 'queue',
    problem: null
  },
  agent_daily_limit: {
    label: 'O agente atingiu o limite de hoje',
    notify: 'O agente atingiu o limite de hoje. Retome para passar por cima uma vez.',
    waits: 'problem',
    problem: {
      kind: 'agent_daily_limit',
      hint: 'O agente chegou ao limite de hoje. Retomar libera este passo uma vez.'
    }
  }
}

export const FLOW_PAUSE_REASONS = Object.keys(FLOW_PAUSES) as FlowPauseReason[]

type RunState = Pick<FlowRunView, 'status' | 'pauseReason'>

/** O que a execução espera agora; `null` = rodando um passo ou terminada. */
export function waitingKind(run: RunState): WaitingKind | null {
  switch (run.status) {
    case 'waiting_gate':
      return 'gate'
    case 'awaiting_decision':
      return 'decision'
    case 'paused':
      // Pausa sem motivo (não deveria acontecer): trata como problema, para alguém ver.
      return run.pauseReason ? FLOW_PAUSES[run.pauseReason].waits : 'problem'
    default:
      return null
  }
}

/** Espera uma ação sua (card, sino, lista lateral)? A fila de vaga não conta. */
export function needsYou(run: RunState): boolean {
  const kind = waitingKind(run)
  return kind !== null && kind !== 'queue'
}

/** Pausa que é problema (o passo parou): cartão de problema e "parou aqui" no plano. */
export function isProblem(reason: FlowPauseReason | null): boolean {
  return reason !== null && FLOW_PAUSES[reason].waits === 'problem'
}
