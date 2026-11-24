/**
 * Integração de fluxos por marcador (`Flow.tags`): o que uma integração (hoje, o alva-flow)
 * acrescenta aos fluxos com o marcador dela. O `FlowRunner` só conhece esta interface; nada do
 * plugin fica no executor genérico.
 */
import type { StepFailure } from '../../shared/task-flow'

export interface FlowIntegration {
  /** Marcador dos fluxos da integração (ex.: `alva`). */
  tag: string
  /** Prefixo das variáveis que a integração grava (ex.: `alva.`). */
  varPrefix: string
  /**
   * Um comando cita uma variável da integração sem valor (ex.: a task do Backlog não foi
   * vinculada): o passo falha com isto antes de gastar uma execução. Vale em qualquer fluxo.
   */
  missingVar: StepFailure
  initialVars(projectId: string, taskId: string): Promise<Record<string, string>>
  /** Mensagem que impede um fluxo da integração de começar (ex.: projeto não pronto) ou `null`. */
  canStart(projectId: string): Promise<string | null>
  /**
   * Quantos fluxos da integração podem rodar ao mesmo tempo no projeto (`null` = sem limite). O
   * excedente espera (`waiting_slot`) e começa sozinho. Não pode depender de outra chamada ter
   * rodado antes (o executor pergunta ao reabrir o app, antes de qualquer pré-checagem).
   */
  concurrencyLimit(projectId: string): number | null
}

export function integrationsOf(
  integrations: readonly FlowIntegration[],
  tags: readonly string[] | undefined
): FlowIntegration[] {
  return integrations.filter((i) => tags?.includes(i.tag))
}
