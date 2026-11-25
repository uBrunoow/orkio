/**
 * Validadores por conceito para dados que cruzam o IPC (o main confere tudo de novo, `unknown`).
 * Cada conceito tem UMA regra; os limites vêm das constantes do domínio. Puro: sem Node nem DOM.
 */
import { parseAgentKey, type AgentKey } from '../agent'
import { isMemoryDigest, isMemoryNoteId, isMemorySnapshotId } from '../agent-memory'
import type { ConnectorCredentials } from '../connection'
import { isRecord } from '../guards'
import { NOTION_ID_PATTERN } from '../notion'
import { INVALID, type Parser } from './define'

const LOCAL_ID = /^[A-Za-z0-9-]{1,100}$/
/** Etapas aceitam `_` (ids de quadros antigos e editados à mão); os gerados usam só `-`. */
const STAGE_ID = /^[A-Za-z0-9_-]{1,100}$/

/** Id gerado pelo Orkio: projeto, seleção de pasta, execução, fluxo, execução de fluxo, artefato. */
export function isLocalId(value: unknown): value is string {
  return typeof value === 'string' && LOCAL_ID.test(value)
}

export function isProjectId(value: unknown): value is string {
  return isLocalId(value)
}

/** Página ou banco do Notion (UUID com ou sem hífens). */
export function isNotionId(value: unknown): value is string {
  return typeof value === 'string' && NOTION_ID_PATTERN.test(value)
}

/** Tarefa = página do Notion. */
export function isTaskId(value: unknown): value is string {
  return isNotionId(value)
}

export function isStageId(value: unknown): value is string {
  return typeof value === 'string' && STAGE_ID.test(value)
}

export function isAgentKey(value: unknown): value is AgentKey {
  return parseAgentKey(value) !== null
}

/** Id de propriedade ou de opção do Notion (ex.: "title", "%3AUPp"): curto e não vazio. */
export function isNotionPropertyId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 200
}

/** "Conectar com token": a única credencial que o renderer manda. */
export function isTokenCredentials(value: unknown): value is ConnectorCredentials {
  return isRecord(value) && value['kind'] === 'token' && typeof value['token'] === 'string'
}

export function guard<T>(test: (value: unknown) => value is T): Parser<T> {
  return (value) => (test(value) ? value : INVALID)
}

export const projectId = guard(isProjectId)
export const taskId = guard(isTaskId)
export const stageId = guard(isStageId)
export const localId = guard(isLocalId)
export const notionId = guard(isNotionId)
export const agentKey = guard(isAgentKey)

export const bool: Parser<boolean> = (value) => (typeof value === 'boolean' ? value : INVALID)

export function finiteNumber(value: unknown): number | typeof INVALID {
  return typeof value === 'number' && Number.isFinite(value) ? value : INVALID
}

/** Texto de até `max` caracteres (`min` = mínimo, padrão 0). */
export function text(max: number, min = 0): Parser<string> {
  return (value) =>
    typeof value === 'string' && value.length >= min && value.length <= max ? value : INVALID
}

export function oneOf<const T extends readonly string[]>(values: T): Parser<T[number]> {
  return (value) =>
    typeof value === 'string' && (values as readonly string[]).includes(value)
      ? (value as T[number])
      : INVALID
}

export function nullable<T>(parse: Parser<T>): Parser<T | null> {
  return (value) => (value === null ? null : parse(value))
}

/** `{ force?: boolean }` das leituras com "Atualizar": qualquer outra coisa vale `false`. */
export interface ForceOption {
  force?: boolean
}

export const forceOption: Parser<{ force: boolean }> = (value) => ({
  force: isRecord(value) && value['force'] === true
})

/** Memória do agente (Fase 3): digest lido, id da nota e id da foto do histórico. */
export const memoryDigest = guard(isMemoryDigest)
export const memoryNoteId = guard(isMemoryNoteId)
export const memorySnapshotId = guard(isMemorySnapshotId)
