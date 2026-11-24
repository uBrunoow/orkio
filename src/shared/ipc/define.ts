/**
 * Peças para declarar o IPC uma vez só (`api.ts`): cada método diz o canal, como validar cada
 * argumento e o que responder em erro inesperado; cada evento diz o canal e como validar o payload.
 * O preload monta `window.orkio` a partir da declaração (`buildApi`) e o main registra os handlers
 * a partir dela (`main/ipc/register.ts`). Puro: sem Node nem DOM.
 */
import type { Result } from '../result'

/** Resposta de um `Parser` para valor recusado. */
export const INVALID: unique symbol = Symbol('ipc-invalid')
export type Invalid = typeof INVALID

/** Valida (e normaliza) um valor vindo do outro processo. Nunca lança. */
export type Parser<T> = (value: unknown) => T | Invalid

/** O que o canal precisa no main antes de rodar: nada, a config carregada ou o banco local. */
export type Needs = 'none' | 'config' | 'db'

const SAME_AS: unique symbol = Symbol('ipc-same-as')

/** Resposta que é a de outro método do mesmo grupo, sem argumentos (ex.: o status atual). */
export interface SameAs {
  readonly [SAME_AS]: string
}

export function sameAs(method: string): SameAs {
  return { [SAME_AS]: method }
}

export function sameAsTarget(value: unknown): string | null {
  return typeof value === 'object' && value !== null && SAME_AS in value
    ? (value as SameAs)[SAME_AS]
    : null
}

type AnyCall = (...args: never[]) => Promise<unknown>
export type CallResult<F extends AnyCall> = Awaited<ReturnType<F>>

export type ParsedArgs<P> = { -readonly [K in keyof P]: P[K] extends Parser<infer T> ? T : never }

type IsResult<R> = [R] extends [Result<unknown>] ? true : false

interface CallFields<F extends AnyCall, P extends readonly Parser<unknown>[]> {
  channel: string
  /** Um validador por argumento, na ordem da assinatura. */
  args: P
  /** Padrão do grupo. */
  needs?: Needs
  /**
   * Resposta a argumentos recusados. Padrão: `Result` de "Pedido inválido" nos métodos que
   * devolvem `Result`; nos outros, o `fallback`.
   */
  invalid?: CallResult<F> | SameAs
  /** Mensagem do erro inesperado nos métodos que devolvem `Result` (padrão: a do grupo). */
  unexpected?: string
}

/**
 * Método que devolve `Result`: o erro inesperado vira a falha `unexpected` com a mensagem do grupo
 * (sem `fallback`). Os outros dizem o fallback.
 */
type FallbackField<F extends AnyCall> =
  IsResult<CallResult<F>> extends true ? { fallback?: never } : { fallback: CallResult<F> | SameAs }

export type CallSpec<F extends AnyCall, P extends readonly Parser<unknown>[]> = CallFields<F, P> &
  FallbackField<F> & {
    readonly kind: 'call'
    /** Só tipo: a assinatura exposta em `window.orkio`. */
    readonly signature: F
  }

/** Forma de qualquer método, para o código que percorre a declaração. */
export interface AnyCallSpec {
  readonly kind: 'call'
  channel: string
  args: readonly Parser<unknown>[]
  needs?: Needs
  invalid?: unknown
  fallback?: unknown
  unexpected?: string
}

type ArgsMatch<F extends AnyCall, P> =
  ParsedArgs<P> extends Parameters<F> ? unknown : { readonly argsDoNotMatchSignature: never }

/**
 * Declara um método: `call<(projectId: string) => Promise<X>>()({ channel, args, ... })`. O tipo
 * confere que os validadores produzem os argumentos da assinatura, na ordem.
 */
export function call<F extends AnyCall>() {
  return <const P extends readonly Parser<unknown>[]>(
    spec: CallFields<F, P> & FallbackField<F> & ArgsMatch<F, P>
  ): CallSpec<F, P> => ({ ...spec, kind: 'call' }) as unknown as CallSpec<F, P>
}

/** Efeito no main de um evento enviado ao renderer. */
export type EventEffect = 'overview' | 'keepAwake'

export interface EventSpec<T> {
  readonly kind: 'event'
  channel: string
  /** Validação no preload (o listener só recebe o valor validado). */
  parse: Parser<T>
  /** O main recalcula "Esperando você" e/ou "manter acordado" a cada envio. */
  affects?: readonly EventEffect[]
  /** Só alguns envios afetam (ex.: mudanças de estado de uma execução, não o texto do log). */
  affectsWhen?: (payload: T) => boolean
}

export function event<T>(spec: Omit<EventSpec<T>, 'kind'>): EventSpec<T> {
  return { ...spec, kind: 'event' }
}

export function isCallSpec(value: unknown): value is AnyCallSpec {
  return typeof value === 'object' && value !== null && (value as AnyCallSpec).kind === 'call'
}

export function isEventSpec(value: unknown): value is EventSpec<unknown> {
  return (
    typeof value === 'object' && value !== null && (value as EventSpec<unknown>).kind === 'event'
  )
}

/** Padrões de um grupo (namespace de `window.orkio`). */
export interface GroupDefaults {
  needs: Needs
  /** Mensagem pt-BR do erro inesperado nos métodos que devolvem `Result`. */
  unexpected: string
}

export function group<M extends object>(defaults: GroupDefaults, members: M): M {
  for (const entry of Object.values(members)) {
    if (isCallSpec(entry)) {
      entry.needs ??= defaults.needs
      entry.unexpected ??= defaults.unexpected
    }
  }
  return members
}

/** A API vista pelo renderer: métodos com a assinatura declarada e `on*` que devolvem unsubscribe. */
export type ApiOf<T> = {
  [K in keyof T]: T[K] extends { kind: 'call'; signature: infer F }
    ? F
    : T[K] extends EventSpec<infer E>
      ? (listener: (event: E) => void) => () => void
      : ApiOf<T[K]>
}

/** `true` quando o método devolve `Result` (não declara `fallback`). */
export function returnsResult(spec: AnyCallSpec): boolean {
  return !('fallback' in spec)
}

/** Como o preload fala com o main (o `ipcRenderer` fica só dentro dele). */
export interface Transport {
  invoke(channel: string, args: unknown[]): Promise<unknown>
  subscribe(channel: string, handler: (payload: unknown) => void): () => void
}

/**
 * Monta `window.orkio` a partir da declaração: cada método invoca o canal com os argumentos
 * copiados por `toPlain`; cada evento valida o payload antes de chamar o listener.
 */
export function buildApi<T extends object>(spec: T, transport: Transport): ApiOf<T> {
  const api: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(spec)) {
    if (isCallSpec(entry)) {
      const channel = entry.channel
      api[key] = (...args: unknown[]) => transport.invoke(channel, args.map(toPlain))
    } else if (isEventSpec(entry)) {
      const { channel, parse } = entry
      api[key] = (listener: (event: unknown) => void) =>
        transport.subscribe(channel, (payload) => {
          const value = parse(payload)
          if (value !== INVALID) listener(value)
        })
    } else {
      api[key] = buildApi(entry as object, transport)
    }
  }
  return api as ApiOf<T>
}

/**
 * Cópia só com dados (como o `JSON.parse(JSON.stringify())` de antes, mas mantendo `Uint8Array`):
 * objetos simples, arrays, texto, número, booleano, `null` e bytes. Funções, símbolos e protótipos
 * não passam (campo some; em array vira `null`), e nada do renderer chega ao main por referência.
 */
export function toPlain(value: unknown, depth = 0): unknown {
  if (depth > 32) return null
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (value instanceof Uint8Array) return new Uint8Array(value)
  if (Array.isArray(value)) return value.map((item) => toPlain(item, depth + 1) ?? null)
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
      const plain = toPlain(item, depth + 1)
      if (plain !== undefined) out[key] = plain
    }
    return out
  }
  return undefined
}
