/**
 * Fila de escrita no Notion (Etapa 3A), persistida no SQLite (`pending_writes`): sobrevive a
 * fechar o app. Uma escrita por tarefa (a última vence). As requisições passam pela RateQueue do
 * cliente do Notion (≈3 req/s).
 *
 * - Falha transitória (rede, 5xx, 429, sem conexão/autorização expirada) → tenta de novo com
 *   backoff exponencial até 5 min, sem limite de tentativas (a mudança fica "pendente").
 * - O Notion recusou (400/403/404) → desfaz localmente (`onRejected`) e avisa.
 */
import { backoffMs } from '../net/rate-queue'
import type { BoardStore, PendingWrite } from './board.store'
import { isApiError } from '../net/http'

export const WRITE_MAX_BACKOFF_MS = 5 * 60 * 1000

export interface WriteQueueDeps {
  store: BoardStore
  updatePage(pageId: string, properties: Record<string, unknown>): Promise<void>
  /** Escrita confirmada pelo Notion. */
  onSynced(write: PendingWrite): void
  /** Escrita recusada pelo Notion: desfazer localmente. */
  onRejected(write: PendingWrite, error: { code: string; message: string }): void
  /** Falha transitória: continua pendente. */
  onRetry(write: PendingWrite, error: { code: string; message: string }, nextAttemptAt: Date): void
  now?: () => Date
  random?: () => number
  /** Agenda o próximo processamento (padrão: setTimeout). */
  schedule?: (fn: () => void, ms: number) => { cancel(): void }
}

const PERMANENT = new Set(['bad_request', 'forbidden', 'not_found'])

export function isPermanentWriteError(e: unknown): boolean {
  return isApiError(e, 'notion') && PERMANENT.has(e.code)
}

export class NotionWriteQueue {
  private readonly now: () => Date
  private readonly random: () => number
  private timer: { cancel(): void } | null = null
  private running: Promise<void> | null = null
  private stopped = false

  constructor(private readonly deps: WriteQueueDeps) {
    this.now = deps.now ?? (() => new Date())
    this.random = deps.random ?? Math.random
  }

  /** Começa (ao abrir o app, retoma o que ficou pendente). */
  start(): void {
    this.stopped = false
    this.kick()
  }

  stop(): void {
    this.stopped = true
    this.timer?.cancel()
    this.timer = null
  }

  /** Processa agora o que estiver vencido (ex.: logo depois de mover um card). */
  kick(): void {
    if (this.stopped) return
    this.timer?.cancel()
    this.timer = null
    void this.process()
  }

  /** Força uma nova tentativa imediata de tudo (ex.: "Tentar agora", voltou a rede). */
  retryAllNow(): void {
    for (const w of this.deps.store.allPending()) {
      this.deps.store.scheduleRetry(
        w.taskPageId,
        w.attempts,
        this.now().toISOString(),
        w.lastErrorCode ?? ''
      )
    }
    this.kick()
  }

  /** Escritas ainda não confirmadas pelo Notion (6C: a atualização espera por elas). */
  pendingCount(): number {
    return this.deps.store.allPending().length
  }

  /** Espera o processamento em andamento (testes). */
  async idle(): Promise<void> {
    while (this.running) await this.running
  }

  private process(): Promise<void> {
    this.running ??= this.run().finally(() => {
      this.running = null
      this.scheduleNext()
    })
    return this.running
  }

  private async run(): Promise<void> {
    // Laço: escritas novas que chegarem durante o envio também são processadas.
    for (;;) {
      const now = this.now().getTime()
      const due = this.deps.store.allPending().filter((w) => Date.parse(w.nextAttemptAt) <= now)
      if (due.length === 0 || this.stopped) return
      await Promise.all(due.map((w) => this.send(w)))
    }
  }

  private async send(write: PendingWrite): Promise<void> {
    const payload = JSON.stringify(write.properties)
    try {
      await this.deps.updatePage(write.taskPageId, write.properties)
    } catch (e) {
      const error = isApiError(e, 'notion')
        ? { code: e.code, message: e.message }
        : { code: 'unexpected', message: 'Algo deu errado ao falar com o Notion.' }
      // Mudou durante o envio? A versão nova será enviada; ignora o resultado desta.
      const current = this.deps.store.pending(write.taskPageId)
      if (!current || JSON.stringify(current.properties) !== payload) return
      if (isPermanentWriteError(e)) {
        this.deps.store.deletePending(write.taskPageId)
        this.deps.onRejected(current, error)
        return
      }
      const attempts = current.attempts + 1
      const wait = Math.min(WRITE_MAX_BACKOFF_MS, backoffMs(attempts - 1, this.random))
      const next = new Date(this.now().getTime() + wait)
      this.deps.store.scheduleRetry(write.taskPageId, attempts, next.toISOString(), error.code)
      this.deps.onRetry({ ...current, attempts, nextAttemptAt: next.toISOString() }, error, next)
      return
    }
    if (this.deps.store.deletePendingIfUnchanged(write.taskPageId, payload)) {
      this.deps.onSynced(write)
    }
  }

  private scheduleNext(): void {
    if (this.stopped) return
    const pending = this.deps.store.allPending()
    if (pending.length === 0) return
    const next = Math.min(...pending.map((w) => Date.parse(w.nextAttemptAt)))
    const ms = Math.max(0, next - this.now().getTime())
    const schedule =
      this.deps.schedule ??
      ((fn: () => void, delay: number) => {
        const t = setTimeout(fn, delay)
        return { cancel: () => clearTimeout(t) }
      })
    this.timer?.cancel()
    this.timer = schedule(() => this.kick(), ms)
  }
}
