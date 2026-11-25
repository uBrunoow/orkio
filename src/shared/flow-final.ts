/**
 * Finais honestos de um fluxo de tarefa (Fase 3). Um fluxo nunca "termina bem" sem ter terminado
 * bem: cada fim tem um nome próprio e nunca é convertido em outro (nada de "concluído" quando não
 * havia nada a fazer, nem "falhou" quando foi você que recusou).
 *
 * O valor fica em `flow_runs.result` (TEXT sem CHECK). `done`, `rejected` e `cancelled` são os
 * valores de antes (linhas antigas continuam valendo); os outros são novos.
 *
 * Puro (main e renderer).
 */

export const FLOW_RESULTS = [
  'done',
  'nothing',
  'rejected',
  'blocked',
  'exhausted',
  'stuck',
  'failed',
  'cancelled'
] as const
export type FlowResult = (typeof FLOW_RESULTS)[number]

export function isFlowResult(value: unknown): value is FlowResult {
  return typeof value === 'string' && (FLOW_RESULTS as readonly string[]).includes(value)
}

/** Os finais que o engine alcança sozinho (saltos para um fim, gate recusado). */
export type EngineResult = Exclude<FlowResult, 'failed' | 'cancelled'>

/**
 * Alvos especiais de um salto (`branch.then/else`): encerram o fluxo com o final escolhido.
 * `$fim` (o de sempre) = concluído.
 */
export const FLOW_END_TARGETS = {
  $fim: 'done',
  '$fim:nada': 'nothing',
  '$fim:bloqueado': 'blocked',
  '$fim:esgotado': 'exhausted',
  '$fim:travado': 'stuck'
} as const satisfies Record<string, EngineResult>

export type FlowEndTarget = keyof typeof FLOW_END_TARGETS

/** Opções "Encerrar: …" do editor de saltos (o texto diz o final que fica no fluxo). */
export const FLOW_END_OPTIONS: readonly { value: FlowEndTarget; label: string }[] = [
  { value: '$fim', label: 'Encerrar: concluído' },
  { value: '$fim:nada', label: 'Encerrar: nada a fazer' },
  { value: '$fim:bloqueado', label: 'Encerrar: bloqueado' },
  { value: '$fim:esgotado', label: 'Encerrar: esgotado' },
  { value: '$fim:travado', label: 'Encerrar: travado' }
]

export function flowEndResult(target: string | undefined): EngineResult | null {
  if (target === undefined || !Object.prototype.hasOwnProperty.call(FLOW_END_TARGETS, target)) {
    return null
  }
  return FLOW_END_TARGETS[target as FlowEndTarget]
}

export type FinalTone = 'success' | 'neutral' | 'warning' | 'danger'

export interface FinalText {
  /** Rótulo curto (cartão, sino, atividade). */
  label: string
  /** O que aconteceu, numa frase. */
  detail: string
  tone: FinalTone
}

export const FLOW_FINAL_TEXT: Record<FlowResult, FinalText> = {
  done: { label: 'Concluído', detail: 'O fluxo chegou ao fim.', tone: 'success' },
  nothing: {
    label: 'Nada a fazer',
    detail: 'O fluxo rodou e não encontrou nada para fazer.',
    tone: 'neutral'
  },
  rejected: {
    label: 'Bloqueado',
    detail: 'Você recusou num ponto de aprovação; nada foi enviado depois disso.',
    tone: 'warning'
  },
  blocked: {
    label: 'Bloqueado',
    detail: 'Algo de fora impediu o fluxo de seguir.',
    tone: 'warning'
  },
  exhausted: {
    label: 'Esgotado',
    detail: 'Chegou ao limite de voltas antes de ficar pronto.',
    tone: 'warning'
  },
  stuck: {
    label: 'Travado',
    detail: 'As voltas pararam de avançar: os mesmos problemas voltaram.',
    tone: 'warning'
  },
  failed: {
    label: 'Falhou',
    detail: 'Um passo falhou e o fluxo foi encerrado sem terminar.',
    tone: 'danger'
  },
  cancelled: { label: 'Cancelado', detail: 'O fluxo foi cancelado.', tone: 'neutral' }
}

/** Terminou sem pendência (o orquestrador pode passar a tarefa adiante). */
export function isSuccessResult(result: FlowResult | null | undefined): boolean {
  return result === 'done' || result === 'nothing'
}

/**
 * Terminou sem chegar ao objetivo e alguém precisa olhar (esgotado, travado, bloqueado por algo de
 * fora, falhou). Recusado e cancelado foram decisões suas.
 */
export function isUnfinishedResult(result: FlowResult | null | undefined): boolean {
  return result === 'exhausted' || result === 'stuck' || result === 'blocked' || result === 'failed'
}

/** Texto de um final; valor desconhecido (linha futura) = concluído, como antes. */
export function finalText(result: string | null | undefined): FinalText {
  return isFlowResult(result) ? FLOW_FINAL_TEXT[result] : FLOW_FINAL_TEXT.done
}
