/**
 * Chamadas ao main pelo renderer: uma regra para falha de IPC (exceção do `invoke`, ex.: processo
 * principal caiu) e para carregar dados com estado, assinatura de eventos, poll e foco.
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import type { Result, ResultError } from '../../../shared/result'

export const IPC_FAILURE_MESSAGE =
  'Não foi possível falar com o processo principal do Orkio. Reinicie o app.'

export const IPC_FAILURE: ResultError = { code: 'ipc', message: IPC_FAILURE_MESSAGE }

/** Chama o main; se o IPC falhar, devolve `fallback` (o valor que a tela mostra nesse caso). */
export async function ipcCall<T>(fn: () => Promise<T>, fallback: T | (() => T)): Promise<T> {
  try {
    return await fn()
  } catch {
    return typeof fallback === 'function' ? (fallback as () => T)() : fallback
  }
}

/** Chamada que devolve `Result`: falha de IPC vira `{ ok: false, error: IPC_FAILURE }`. */
export function ipcResult<T>(fn: () => Promise<Result<T>>): Promise<Result<T>> {
  return ipcCall(fn, { ok: false, error: IPC_FAILURE })
}

/** Erro de um `Result` recusado, lançado por `unwrap` para a fonte guardar no `error`. */
export class ResultFailure extends Error {
  constructor(readonly error: ResultError) {
    super(error.message)
  }
}

/** `Result<T>` → `T` (ou lança `ResultFailure`): para cargas de fontes que leem `Result`. */
export function unwrap<T>(result: Result<T>): T {
  if (result.ok) return result.value
  throw new ResultFailure(result.error)
}

function errorOf(e: unknown): ResultError {
  return e instanceof ResultFailure ? e.error : IPC_FAILURE
}

export interface SourceState<T> {
  /** `null` até a primeira carga com sucesso (uma falha depois mantém o último valor). */
  value: T | null
  error: ResultError | null
  loading: boolean
}

export interface SourceControl<T, A> {
  keys(): string[]
  /** Relê a chave. Sem `arg`, junta-se a uma carga em andamento; com `arg`, sempre pede de novo. */
  reload(key: string, arg?: A): Promise<void>
  set(key: string, update: T | null | ((current: T | null) => T | null)): void
}

export interface SourceSpec<T, A = never> {
  load(key: string, arg: A | undefined): Promise<T>
  /** Assinaturas de eventos do main; ligadas quando a fonte ganha o primeiro leitor. */
  listen?(source: SourceControl<T, A>): () => void
  /** Relê cada chave lida a cada `pollMs` (só quando `pollWhen()`; padrão: janela visível). */
  pollMs?: number
  pollWhen?(): boolean
  refreshOnFocus?: boolean
}

export interface Source<T, A = never> extends SourceControl<T, A> {
  get(key: string): SourceState<T>
  subscribe(key: string, listener: () => void): () => void
}

const EMPTY: SourceState<never> = { value: null, error: null, loading: false }
const FIRST_LOAD: SourceState<never> = { value: null, error: null, loading: true }

/**
 * Fonte de dados compartilhada, por chave (ex.: id do projeto; `''` quando é uma só): uma carga,
 * uma assinatura de eventos e um poll por fonte, não por componente. A primeira leitura de uma
 * chave carrega; a fonte para de ouvir quando o último leitor sai.
 */
export function createSource<T, A = never>(spec: SourceSpec<T, A>): Source<T, A> {
  const states = new Map<string, SourceState<T>>()
  const listeners = new Map<string, Set<() => void>>()
  const inFlight = new Map<string, Promise<void>>()
  const seq = new Map<string, number>()
  let stop: (() => void) | null = null

  const get = (key: string): SourceState<T> => states.get(key) ?? FIRST_LOAD

  const write = (key: string, next: SourceState<T>): void => {
    states.set(key, next)
    for (const l of listeners.get(key) ?? []) l()
  }

  const keys = (): string[] => [...listeners.keys()]

  const reload = (key: string, arg?: A): Promise<void> => {
    const running = inFlight.get(key)
    if (running && arg === undefined) return running
    const n = (seq.get(key) ?? 0) + 1
    seq.set(key, n)
    const current = get(key)
    if (!current.loading) write(key, { ...current, loading: true })
    const done = spec.load(key, arg).then(
      (value) => {
        if (seq.get(key) === n) write(key, { value, error: null, loading: false })
      },
      (e: unknown) => {
        if (seq.get(key) === n) write(key, { ...get(key), error: errorOf(e), loading: false })
      }
    )
    const tracked = done.finally(() => {
      if (inFlight.get(key) === tracked) inFlight.delete(key)
    })
    inFlight.set(key, tracked)
    return tracked
  }

  const set: SourceControl<T, A>['set'] = (key, update) => {
    const current = get(key)
    // Ajuste sobre nada carregado ainda: nada a ajustar, e a carga em andamento traz o estado novo.
    if (typeof update === 'function' && current.value === null) return
    const value =
      typeof update === 'function' ? (update as (c: T | null) => T | null)(current.value) : update
    // Valor vindo de fora vence uma carga em andamento (que traria o estado de antes).
    seq.set(key, (seq.get(key) ?? 0) + 1)
    write(key, { value, error: null, loading: false })
  }

  const control: SourceControl<T, A> = { keys, reload, set }

  const start = (): (() => void) => {
    const offs: (() => void)[] = []
    if (spec.listen) offs.push(spec.listen(control))
    if (spec.pollMs) {
      const when = spec.pollWhen ?? (() => document.visibilityState === 'visible')
      const timer = setInterval(() => {
        if (when()) for (const k of keys()) void reload(k)
      }, spec.pollMs)
      offs.push(() => clearInterval(timer))
    }
    if (spec.refreshOnFocus) {
      const onFocus = (): void => {
        for (const k of keys()) void reload(k)
      }
      window.addEventListener('focus', onFocus)
      offs.push(() => window.removeEventListener('focus', onFocus))
    }
    return () => offs.forEach((off) => off())
  }

  const subscribe = (key: string, listener: () => void): (() => void) => {
    const first = listeners.size === 0
    let readers = listeners.get(key)
    const firstOfKey = !readers
    if (!readers) {
      readers = new Set()
      listeners.set(key, readers)
    }
    readers.add(listener)
    if (first) stop = start()
    if (firstOfKey && !inFlight.has(key)) void reload(key)
    return () => {
      readers.delete(listener)
      if (readers.size === 0) listeners.delete(key)
      if (listeners.size === 0) {
        stop?.()
        stop = null
      }
    }
  }

  return { ...control, get, subscribe }
}

/** Lê a chave de uma fonte (`null` = nada a ler: estado vazio, sem carga). */
export function useSource<T, A>(source: Source<T, A>, key: string | null): SourceState<T> {
  const subscribe = useCallback(
    (listener: () => void) => (key === null ? () => undefined : source.subscribe(key, listener)),
    [source, key]
  )
  return useSyncExternalStore(subscribe, () => (key === null ? EMPTY : source.get(key)))
}

class LatestBox<T> {
  constructor(
    private loadFn: (key: string) => Promise<T>,
    private subscribeFn: ((reload: () => void, key: string) => () => void) | undefined
  ) {}
  update(
    load: (key: string) => Promise<T>,
    subscribe: ((reload: () => void, key: string) => () => void) | undefined
  ): void {
    this.loadFn = load
    this.subscribeFn = subscribe
  }
  load(key: string): Promise<T> {
    return this.loadFn(key)
  }
  subscribe(reload: () => void, key: string): () => void {
    return this.subscribeFn?.(reload, key) ?? (() => undefined)
  }
}

export interface IpcResource<T> extends SourceState<T> {
  reload(): Promise<void>
  set(update: T | null | ((current: T | null) => T | null)): void
}

/**
 * Dado do main lido por um componente só: carrega quando `key` muda (ex.: id do projeto; `null`
 * = não carrega), com falha de IPC tratada, sem atualizar depois de desmontar e sem mostrar o
 * dado de outra chave. `subscribe` recebe o `reload` (ex.: `onChanged` filtrado por projeto).
 */
export function useIpcResource<T>(
  key: string | null,
  load: (key: string) => Promise<T>,
  options: Omit<SourceSpec<T>, 'load' | 'listen'> & {
    subscribe?(reload: () => void, key: string): () => void
  } = {}
): IpcResource<T> {
  // A fonte é criada uma vez; `load`/`subscribe` mais recentes ficam na caixa (trocados depois de
  // cada render), lidos só quando a fonte carrega ou liga as assinaturas.
  const [box] = useState(() => new LatestBox(load, options.subscribe))
  const [source] = useState(() =>
    createSource<T>({
      ...options,
      load: (k) => box.load(k),
      listen: (src) => {
        const offs = src.keys().map((k) => box.subscribe(() => void src.reload(k), k))
        return () => offs.forEach((off) => off())
      }
    })
  )
  useEffect(() => box.update(load, options.subscribe))
  const state = useSource(source, key)
  const reload = useCallback(
    () => (key === null ? Promise.resolve() : source.reload(key, undefined)),
    [source, key]
  )
  const set = useCallback(
    (update: T | null | ((current: T | null) => T | null)) => {
      if (key !== null) source.set(key, update)
    },
    [source, key]
  )
  return { ...state, reload, set }
}
