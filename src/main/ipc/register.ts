import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { ORKIO_API } from '../../shared/ipc/api'
import {
  INVALID,
  isCallSpec,
  isEventSpec,
  returnsResult,
  sameAsTarget,
  type AnyCallSpec,
  type CallResult,
  type ParsedArgs
} from '../../shared/ipc/define'
import type { Result } from '../../shared/result'
import { DomainError, errorName } from '../errors'
import type { SenderGuard } from './trusted-sender'

const UNTRUSTED_SENDER = 'Origem de IPC não autorizada'

const INVALID_RESULT: Result<never> = {
  ok: false,
  error: { code: 'invalid', message: 'Pedido inválido. Atualize a tela e tente de novo.' }
}
const DB_UNAVAILABLE: Result<never> = {
  ok: false,
  error: {
    code: 'db_unavailable',
    message: 'O banco local não pôde ser aberto (pode ser de uma versão mais nova do Orkio).'
  }
}

type AnyFn = (...args: never[]) => unknown
type ArgsOf<P> = ParsedArgs<P> extends infer A extends unknown[] ? A : never

/**
 * Implementação de um grupo da declaração: uma função por método, com os argumentos já validados
 * (o evento do Electron vem no fim, para quem precisa, ex.: focar a janela de quem chamou).
 */
export type Impl<T> = {
  [K in keyof T as T[K] extends { kind: 'event' } ? never : K]: T[K] extends {
    kind: 'call'
    signature: infer F extends (...args: never[]) => Promise<unknown>
    args: infer P
  }
    ? (...args: [...ArgsOf<P>, IpcMainInvokeEvent]) => CallResult<F> | Promise<CallResult<F>>
    : Impl<T[K]>
}

type Api = typeof ORKIO_API

/**
 * Handlers de todo o `window.orkio`. `null` num grupo que precisa do banco = banco local
 * indisponível: cada método responde o fallback dele (ou `db_unavailable`).
 */
export type Handlers = { [K in keyof Impl<Api>]: Impl<Api>[K] | null }

export interface RegisterOptions {
  isTrustedSender: SenderGuard
  /** Config carregada: canais com `needs` `config`/`db` esperam antes de rodar. */
  ready: Promise<void>
}

/** Registra todos os canais de `ORKIO_API`. Lança na hora se faltar handler fora do banco. */
export function registerHandlers(
  ipc: Pick<IpcMain, 'handle'>,
  options: RegisterOptions,
  handlers: Handlers
): void {
  registerGroup(ipc, options, ORKIO_API, handlers as Impl<Api>)
}

/**
 * Registra um grupo da declaração (os testes registram só o grupo que exercitam). `impl` `null` =
 * grupo indisponível (banco local): só métodos com `needs: 'db'` podem ficar sem handler.
 */
export function registerGroup<T extends object>(
  ipc: Pick<IpcMain, 'handle'>,
  options: RegisterOptions,
  spec: T,
  impl: Impl<T> | null
): void {
  const members = impl as Record<string, unknown> | null
  for (const [key, entry] of Object.entries(spec)) {
    if (isEventSpec(entry)) continue
    if (!isCallSpec(entry)) {
      registerGroup(ipc, options, entry as object, (members?.[key] ?? null) as never)
      continue
    }
    const fn = members ? members[key] : null
    if (fn === undefined || (fn === null && entry.needs !== 'db')) {
      throw new Error(`IPC sem handler: ${entry.channel}`)
    }
    registerCall(ipc, options, entry, fn as AnyFn | null, members)
  }
}

function registerCall(
  ipc: Pick<IpcMain, 'handle'>,
  options: RegisterOptions,
  spec: AnyCallSpec,
  fn: AnyFn | null,
  siblings: Record<string, unknown> | null
): void {
  const result = returnsResult(spec)
  const unexpected: Result<never> = {
    ok: false,
    error: { code: 'unexpected', message: spec.unexpected ?? 'Algo deu errado. Tente novamente.' }
  }
  const fallback = result ? unexpected : spec.fallback
  const invalid = 'invalid' in spec ? spec.invalid : result ? INVALID_RESULT : fallback

  const answer = async (value: unknown, event: IpcMainInvokeEvent): Promise<unknown> => {
    const target = sameAsTarget(value)
    if (target === null) return value
    const other = siblings?.[target]
    if (typeof other !== 'function') throw new Error(`IPC sem handler: ${target}`)
    return (other as (event: IpcMainInvokeEvent) => unknown)(event)
  }

  ipc.handle(spec.channel, async (event, ...raw: unknown[]) => {
    if (!options.isTrustedSender(event)) throw new Error(UNTRUSTED_SENDER)
    try {
      if (spec.needs !== 'none') await options.ready
      if (!fn) return result ? DB_UNAVAILABLE : await answer(fallback, event)
      const args: unknown[] = []
      for (const [i, parse] of spec.args.entries()) {
        const value = parse(raw[i])
        if (value === INVALID) return await answer(invalid, event)
        args.push(value)
      }
      return await (fn as (...a: unknown[]) => unknown)(...args, event)
    } catch (error) {
      if (result && error instanceof DomainError) {
        return { ok: false, error: { code: error.code, message: error.message } }
      }
      // Nunca logamos a mensagem/stack: podem conter dados sensíveis.
      console.error(`[orkio] falha inesperada em ${spec.channel}: ${errorName(error)}`)
      return answer(fallback, event)
    }
  })
}
