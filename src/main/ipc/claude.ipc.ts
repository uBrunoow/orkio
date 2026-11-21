import type { IpcMain } from 'electron'
import type {
  ProjectClaudeContext,
  ClaudeCodeStatus,
  ClaudeResult,
  EditorId,
  PermissionAnswer,
  RunLogEvent,
  StartRunRequest
} from '../../shared/agent-run'
import { IPC_CHANNELS } from '../../shared/ipc-contract'
import type { ClaudeService } from '../claude/claude.service'
import { CLAUDE_MIN_VERSION } from '../claude/detect'
import { errorName } from './payload'
import { isId } from './projects.ipc'
import type { SenderGuard } from './trusted-sender'

const GENERIC: ClaudeResult<never> = {
  ok: false,
  error: { code: 'unexpected', message: 'Algo deu errado. Tente novamente.' }
}
const INVALID: ClaudeResult<never> = {
  ok: false,
  error: { code: 'invalid', message: 'Pedido inválido. Atualize a tela e tente de novo.' }
}
const UNKNOWN_STATUS: ClaudeCodeStatus = {
  installed: false,
  version: null,
  loggedIn: null,
  authMethod: null,
  meetsMinimum: false,
  minimumVersion: CLAUDE_MIN_VERSION
}

/** Limite do briefing/prompt enviados pelo renderer. */
const MAX_TEXT = 200_000

export function isRequestId(value: unknown): value is string {
  return typeof value === 'string' && /^[\w-]{1,200}$/.test(value)
}

/**
 * Caminho relativo ao repositório vindo da lista de candidatos (o serviço confere de novo que é
 * um documento alterado nesta tarefa). Nada de absoluto, `..` ou controle.
 */
export function isRepoPath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 500 &&
    !value.startsWith('/') &&
    !/^[A-Za-z]:/.test(value) &&
    !value.split(/[\\/]/).includes('..') &&
    ![...value].some((c) => c.charCodeAt(0) < 0x20)
  )
}

export function isContext(value: unknown): value is ProjectClaudeContext {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v['instructions'] === 'string' &&
    v['instructions'].length <= 20_000 &&
    Array.isArray(v['notionPages']) &&
    v['notionPages'].length <= 20 &&
    v['notionPages'].every(
      (p) =>
        typeof p === 'object' &&
        p !== null &&
        isId((p as { id?: unknown }).id) &&
        typeof (p as { name?: unknown }).name === 'string' &&
        (p as { name: string }).name.length <= 500
    )
  )
}

export function isStartRunRequest(value: unknown): value is StartRunRequest {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    isId(v['projectId']) &&
    isId(v['taskId']) &&
    (v['mode'] === 'prompt' || v['mode'] === 'command') &&
    (v['command'] === null || (typeof v['command'] === 'string' && v['command'].length <= 100)) &&
    typeof v['text'] === 'string' &&
    v['text'].length <= MAX_TEXT &&
    typeof v['briefing'] === 'string' &&
    v['briefing'].length <= MAX_TEXT &&
    (v['asAgent'] === undefined || typeof v['asAgent'] === 'boolean')
  )
}

function isAnswers(value: unknown): value is Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const entries = Object.entries(value)
  return (
    entries.length <= 20 &&
    entries.every(([k, v]) => k.length <= 2000 && typeof v === 'string' && v.length <= 10_000)
  )
}

const ANSWERS: readonly PermissionAnswer[] = ['allow_once', 'allow_always', 'deny']
const EDITORS: readonly EditorId[] = ['cursor', 'code']

export function registerClaudeIpc(
  ipc: Pick<IpcMain, 'handle'>,
  service: ClaudeService,
  isTrustedSender: SenderGuard,
  ready: Promise<void> = Promise.resolve()
): void {
  const ch = IPC_CHANNELS.claude
  function guarded<T>(channel: string, fallback: T, run: (...args: unknown[]) => Promise<T>): void {
    ipc.handle(channel, async (event, ...args: unknown[]) => {
      if (!isTrustedSender(event)) throw new Error('Origem de IPC não autorizada')
      try {
        await ready
        return await run(...args)
      } catch (error) {
        console.error(`[orkio] falha inesperada em ${channel}: ${errorName(error)}`)
        return fallback
      }
    })
  }

  guarded(ch.status, UNKNOWN_STATUS, async (options) =>
    service.getStatus(
      typeof options === 'object' &&
        options !== null &&
        (options as { force?: unknown }).force === true
    )
  )
  guarded(ch.state, GENERIC, async (projectId, taskId) =>
    isId(projectId) && isId(taskId) ? service.state(projectId, taskId) : INVALID
  )
  guarded(ch.prepare, GENERIC, async (projectId, taskId) =>
    isId(projectId) && isId(taskId) ? service.prepare(projectId, taskId) : INVALID
  )
  guarded(ch.start, GENERIC, async (request) =>
    isStartRunRequest(request) ? service.start(request) : INVALID
  )
  guarded(ch.cancel, undefined, async (runId) => {
    if (isId(runId)) service.cancel(runId)
  })
  guarded(ch.answerPermission, undefined, async (runId, requestId, answer) => {
    if (isId(runId) && isRequestId(requestId) && ANSWERS.includes(answer as PermissionAnswer)) {
      service.answerPermission(runId, requestId, answer as PermissionAnswer)
    }
  })
  guarded(ch.answerQuestion, undefined, async (runId, requestId, answers) => {
    if (isId(runId) && isRequestId(requestId) && isAnswers(answers)) {
      service.answerQuestion(runId, requestId, answers)
    }
  })
  guarded<RunLogEvent[]>(ch.readLog, [], async (runId) =>
    isId(runId) ? service.readLog(runId) : []
  )
  guarded(ch.cleanup, GENERIC, async (projectId, taskId, force) =>
    isId(projectId) && isId(taskId) ? service.cleanup(projectId, taskId, force === true) : INVALID
  )
  guarded(ch.openEditor, GENERIC, async (projectId, taskId, editor) =>
    isId(projectId) && isId(taskId) && EDITORS.includes(editor as EditorId)
      ? service.openEditor(projectId, taskId, editor as EditorId)
      : INVALID
  )
  guarded(ch.getContext, GENERIC, async (projectId) =>
    isId(projectId) ? service.getContext(projectId) : INVALID
  )
  guarded(ch.saveContext, GENERIC, async (projectId, context) =>
    isId(projectId) && isContext(context) ? service.saveContext(projectId, context) : INVALID
  )
  guarded(ch.searchPages, GENERIC, async (query) =>
    typeof query === 'string' && query.length <= 200 ? service.searchPages(query) : INVALID
  )
  guarded(ch.artifacts, GENERIC, async (projectId, taskId) =>
    isId(projectId) && isId(taskId) ? service.artifacts(projectId, taskId) : INVALID
  )
  guarded(ch.attachArtifact, GENERIC, async (projectId, taskId, path, runId) =>
    isId(projectId) && isId(taskId) && isRepoPath(path) && (runId === null || isId(runId))
      ? service.attachArtifact(projectId, taskId, path, runId)
      : INVALID
  )
  guarded(ch.publishArtifact, GENERIC, async (projectId, artifactId, mode) =>
    isId(projectId) && isId(artifactId) && (mode === 'section' || mode === 'child_page')
      ? service.publishArtifact(projectId, artifactId, mode)
      : INVALID
  )
  guarded(ch.catalog, GENERIC, async (projectId, taskId) =>
    isId(projectId) && isId(taskId) ? service.catalog(projectId, taskId) : INVALID
  )
  guarded(ch.diff, GENERIC, async (projectId, taskId) =>
    isId(projectId) && isId(taskId) ? service.diff(projectId, taskId) : INVALID
  )
}
