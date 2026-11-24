/**
 * Fila simples para respeitar rate limits: concorrência baixa, intervalo mínimo entre inícios e
 * pausa global (ex.: depois de um 429 com Retry-After, ninguém sai antes da hora).
 */
export interface RateQueueOptions {
  concurrency?: number
  /** Intervalo mínimo entre o início de duas requisições (ms). */
  minIntervalMs?: number
  now?: () => number
}

export class RateQueue {
  private readonly concurrency: number
  private readonly minIntervalMs: number
  private readonly now: () => number
  private readonly waiting: (() => void)[] = []
  private active = 0
  private lastStart = -Infinity
  private pausedUntil = 0
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(options: RateQueueOptions = {}) {
    this.concurrency = options.concurrency ?? 2
    this.minIntervalMs = options.minIntervalMs ?? 350
    this.now = options.now ?? Date.now
  }

  run<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.waiting.push(() => {
        task()
          .then(resolve, reject)
          .finally(() => {
            this.active--
            this.pump()
          })
      })
      this.pump()
    })
  }

  /** Ninguém começa antes de `ms` a partir de agora (ex.: Retry-After de um 429). */
  pause(ms: number): void {
    this.pausedUntil = Math.max(this.pausedUntil, this.now() + Math.max(0, ms))
    this.pump()
  }

  /** Itens aguardando + em andamento (para testes e diagnóstico). */
  get size(): number {
    return this.waiting.length + this.active
  }

  private pump(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    while (this.active < this.concurrency && this.waiting.length > 0) {
      const wait = Math.max(this.lastStart + this.minIntervalMs, this.pausedUntil) - this.now()
      if (wait > 0) {
        this.timer = setTimeout(() => {
          this.timer = null
          this.pump()
        }, wait)
        return
      }
      const next = this.waiting.shift()!
      this.active++
      this.lastStart = this.now()
      next()
    }
  }
}

/** Backoff exponencial com jitter (para 429 sem Retry-After). */
export function backoffMs(attempt: number, random: () => number = Math.random): number {
  const base = 1000 * 2 ** attempt
  return Math.round(base + base * 0.25 * random())
}
