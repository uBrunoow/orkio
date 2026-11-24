/**
 * Variáveis com namespace que o Orkio grava nos fluxos (saídas das ações + variáveis do
 * alva-flow). É a API para quem escreve fluxos: o validador avisa quando um fluxo cita uma chave
 * desses namespaces que ninguém grava (renomear no produtor sem mudar o modelo deixa de passar
 * calado).
 */
import { ALVA_OUTPUTS } from './alva'
import { ORKIO_ACTIONS, type FlowOutput } from './orkio-actions'

export const FLOW_OUTPUTS: readonly FlowOutput[] = [
  ...Object.values(ORKIO_ACTIONS).flatMap((a): readonly FlowOutput[] => a.outputs),
  ...ALVA_OUTPUTS
]

export const DECLARED_FLOW_VARS: ReadonlySet<string> = new Set(FLOW_OUTPUTS.map((o) => o.key))
