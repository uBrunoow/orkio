/**
 * Ações do Orkio nos fluxos de tarefa (passo `orkio_action`): o que cada uma é, declarado uma vez.
 * O main acrescenta só o comportamento (`confirm`/`run`, em `main/flows/flow-runner.ts`); o
 * executor, a checagem do agente (`checkAgentFlow`), as fases da tela, o validador e os modelos
 * leem daqui. Ação nova = entrada nova (e a implementação no main com o mesmo id).
 */
import { FLOW_NO, FLOW_YES } from './task-flow'
import type { TaskPhaseId } from './task-phase'

/**
 * Se uma automação move a tarefa de etapa enquanto o passo roda:
 * - `ask`: o fluxo para e pergunta (Cancelar / Deixar terminar), como em qualquer saída da etapa;
 * - `detach`: a mudança é consequência do passo (ex.: a PR aberta move para Revisando): o fluxo
 *   segue sem acompanhar a etapa; a coluna nova fica com o orquestrador;
 * - `detach_and_reenter`: mover a tarefa é o objetivo do passo (ex.: "Pedir alterações" →
 *   Revisado): segue sem acompanhar e, ao terminar `done`, a coluna nova começa o fluxo dela.
 */
export type StageMoveBehavior = 'ask' | 'detach' | 'detach_and_reenter'

/** Variável que uma ação (ou extrator) grava no fluxo; `values` quando o conjunto é fechado. */
export interface FlowOutput {
  key: string
  values?: readonly string[]
  /** O que é, para quem escreve fluxos. */
  about: string
}

export interface OrkioActionDescriptor {
  id: string
  label: string
  /** Entrega no GitHub (push/PR/pedido de review): um agente com `delivery: false` não roda. */
  delivers: boolean
  onStageMoved: StageMoveBehavior
  /** Fase da tarefa (barra do topo) em que o passo entra; `null` = a fase anterior. */
  phase: TaskPhaseId | null
  /** Variáveis gravadas ao terminar bem (API para os fluxos, inclusive os do usuário). */
  outputs: readonly FlowOutput[]
}

/** Chaves das variáveis gravadas pelas ações (produtor e modelos usam estas constantes). */
export const ACTION_VARS = {
  prExists: 'pr.exists',
  prNumber: 'pr.number',
  prPushed: 'pr.pushed',
  reviewCount: 'review.count',
  reviewPr: 'review.pr'
} as const

const YES_NO = [FLOW_YES, FLOW_NO] as const

export const ORKIO_ACTIONS = {
  noop: {
    id: 'noop',
    label: 'Nada (teste)',
    delivers: false,
    onStageMoved: 'ask',
    phase: null,
    outputs: []
  },
  push: {
    id: 'push',
    label: 'Push da branch da tarefa',
    delivers: true,
    onStageMoved: 'detach',
    phase: 'pr',
    outputs: []
  },
  verify_pushed: {
    id: 'verify_pushed',
    label: 'Conferir se a PR tem o commit atual',
    delivers: true,
    onStageMoved: 'detach',
    phase: 'pr',
    outputs: [
      { key: ACTION_VARS.prExists, values: YES_NO, about: 'a tarefa tem PR aberta' },
      { key: ACTION_VARS.prNumber, about: 'número da PR aberta (vazio sem PR)' },
      { key: ACTION_VARS.prPushed, values: YES_NO, about: 'a PR já tem o commit atual' }
    ]
  },
  request_review: {
    id: 'request_review',
    label: 'Pedir review',
    delivers: true,
    onStageMoved: 'detach',
    phase: 'pr',
    outputs: []
  },
  review_snapshot: {
    id: 'review_snapshot',
    label: 'Ler os comentários da PR',
    delivers: false,
    onStageMoved: 'ask',
    phase: 'review',
    outputs: [
      { key: ACTION_VARS.reviewCount, about: 'comentários pendentes (abertos + não lidos)' },
      { key: ACTION_VARS.reviewPr, about: 'número da PR' }
    ]
  },
  // Não é entrega (o Revisor, sem entrega, roda), mas publica e muda a etapa de propósito.
  publish_review: {
    id: 'publish_review',
    label: 'Publicar revisão na PR (orkio[bot])',
    delivers: false,
    onStageMoved: 'detach_and_reenter',
    phase: 'review',
    outputs: []
  }
} as const satisfies Record<string, OrkioActionDescriptor>

export type OrkioActionId = keyof typeof ORKIO_ACTIONS

/** Descritor de uma ação pelo id (`null` = ação que o Orkio não conhece). */
export function orkioAction(id: string): OrkioActionDescriptor | null {
  return Object.prototype.hasOwnProperty.call(ORKIO_ACTIONS, id)
    ? ORKIO_ACTIONS[id as OrkioActionId]
    : null
}
