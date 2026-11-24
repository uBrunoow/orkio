/**
 * "Manter o computador acordado enquanto agentes trabalham": liga o bloqueio de suspensão só
 * quando a opção está ligada E há execução do Claude Code ou fluxo rodando; desliga sozinho
 * quando nada roda. O bloqueador do Electron é injetado (testes).
 */
export interface PowerBlocker {
  start(type: 'prevent-app-suspension'): number
  stop(id: number): void
  isStarted(id: number): boolean
}

export class KeepAwake {
  private id: number | null = null
  private timer: NodeJS.Timeout | null = null
  private disposed = false

  constructor(
    private readonly deps: {
      blocker: PowerBlocker
      enabled(): boolean
      busy(): boolean
    }
  ) {}

  /** Reavalia (chamar a cada evento de execução/fluxo e ao mudar a opção). */
  evaluate(): void {
    if (this.disposed) return
    const want = this.deps.enabled() && this.deps.busy()
    const on = this.id !== null && this.deps.blocker.isStarted(this.id)
    if (want && !on) this.id = this.deps.blocker.start('prevent-app-suspension')
    else if (!want && this.id !== null) {
      if (on) this.deps.blocker.stop(this.id)
      this.id = null
    }
  }

  get active(): boolean {
    return this.id !== null && this.deps.blocker.isStarted(this.id)
  }

  /** Rede de segurança: reavalia a cada `ms` enquanto o app roda. */
  start(ms = 5_000): void {
    this.stop()
    this.timer = setInterval(() => this.evaluate(), ms)
    this.timer.unref()
  }

  /** Para só o relógio de reavaliação (o bloqueio atual continua até o próximo `evaluate`). */
  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** Fechamento do app: solta o bloqueio e nunca mais liga (eventos do cancelAll não religam). */
  dispose(): void {
    this.disposed = true
    this.stop()
    if (this.id !== null) {
      if (this.deps.blocker.isStarted(this.id)) this.deps.blocker.stop(this.id)
      this.id = null
    }
  }
}
