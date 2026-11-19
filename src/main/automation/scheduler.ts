/**
 * Agendador das automações (3B), no main, por projeto com quadro e vínculo com o Notion, enquanto
 * o app estiver aberto (mesmo com a tela fechada).
 *
 * - Ciclo completo a cada ~60 s (com variação aleatória). O GitHub usa ETag: quase sempre 304.
 *   Sem GitHub conectado, o serviço de sinais nem chama o GitHub (só o local segue).
 * - Rate limit ou erro → backoff exponencial até 15 min.
 * - Local: `git for-each-ref` a cada 5 s (barato, sem rede) e o HeadWatcher (troca de branch):
 *   mudança → ciclo imediato.
 */
import type { CycleResult } from './automation.service'

export interface SchedulerDeps {
  run(projectId: string, options?: { force?: boolean }): Promise<CycleResult>
  /** Projetos com quadro e vínculo com o Notion (relido a cada volta). */
  projects(): string[]
  /** Nomes das branches locais (para detectar `git branch X` sem checkout). */
  localBranches(projectId: string): Promise<string[] | null>
  now?: () => number
  random?: () => number
  schedule?: (fn: () => void, ms: number) => { cancel(): void }
  intervalMs?: number
  localIntervalMs?: number
  maxBackoffMs?: number
}

export interface ProjectScheduleStatus {
  lastRunAt: number | null
  nextRunAt: number | null
  github: CycleResult['github']
  failures: number
  error: string | null
}

const defaultSchedule = (fn: () => void, ms: number): { cancel(): void } => {
  const t = setTimeout(fn, ms)
  return { cancel: () => clearTimeout(t) }
}

export class AutomationScheduler {
  private readonly now: () => number
  private readonly random: () => number
  private readonly schedule: NonNullable<SchedulerDeps['schedule']>
  private readonly interval: number
  private readonly localInterval: number
  private readonly maxBackoff: number
  private readonly status = new Map<string, ProjectScheduleStatus>()
  private readonly timers = new Map<string, { cancel(): void }>()
  private readonly lastLocal = new Map<string, string>()
  private localTimer: { cancel(): void } | null = null
  private stopped = true

  constructor(private readonly deps: SchedulerDeps) {
    this.now = deps.now ?? Date.now
    this.random = deps.random ?? Math.random
    this.schedule = deps.schedule ?? defaultSchedule
    this.interval = deps.intervalMs ?? 60_000
    this.localInterval = deps.localIntervalMs ?? 5_000
    this.maxBackoff = deps.maxBackoffMs ?? 15 * 60_000
  }

  start(): void {
    this.stopped = false
    this.sync()
    this.scheduleLocal()
  }

  stop(): void {
    this.stopped = true
    for (const t of this.timers.values()) t.cancel()
    this.timers.clear()
    this.localTimer?.cancel()
    this.localTimer = null
  }

  /** Projetos podem ter sido criados/removidos: agenda os novos, esquece os removidos. */
  sync(): void {
    if (this.stopped) return
    const projects = new Set(this.deps.projects())
    for (const id of [...this.timers.keys()]) {
      if (!projects.has(id)) {
        this.timers.get(id)?.cancel()
        this.timers.delete(id)
        this.status.delete(id)
        this.lastLocal.delete(id)
      }
    }
    for (const id of projects) {
      // Primeiro ciclo logo ao abrir (linha de base / eventos enquanto o app estava fechado).
      if (!this.timers.has(id)) this.plan(id, 0)
    }
  }

  /** "Verificar agora" / "Atualizar": ciclo imediato, forçando a releitura. */
  async runNow(projectId: string): Promise<ProjectScheduleStatus> {
    await this.tick(projectId, true)
    return this.getStatus(projectId)
  }

  /** Evento local (HeadWatcher): ciclo imediato, sem forçar o GitHub. */
  onLocalChange(projectId: string): void {
    if (this.stopped || !this.deps.projects().includes(projectId)) return
    void this.tick(projectId, false)
  }

  getStatus(projectId: string): ProjectScheduleStatus {
    return (
      this.status.get(projectId) ?? {
        lastRunAt: null,
        nextRunAt: null,
        github: 'unknown',
        failures: 0,
        error: null
      }
    )
  }

  private plan(projectId: string, ms: number): void {
    this.timers.get(projectId)?.cancel()
    const status = this.getStatus(projectId)
    this.status.set(projectId, { ...status, nextRunAt: this.now() + ms })
    this.timers.set(
      projectId,
      this.schedule(() => void this.tick(projectId, false), ms)
    )
  }

  private async tick(projectId: string, force: boolean): Promise<void> {
    if (this.stopped) return
    let result: CycleResult
    try {
      result = await this.deps.run(projectId, { force })
    } catch {
      result = {
        github: 'unknown',
        events: 0,
        moves: 0,
        error: { code: 'unexpected', message: '' }
      }
    }
    if (this.stopped) return
    const previous = this.getStatus(projectId)
    const failed =
      result.error !== undefined ||
      result.github === 'rate_limited' ||
      result.github === 'unverified'
    const failures = failed ? previous.failures + 1 : 0
    this.status.set(projectId, {
      lastRunAt: this.now(),
      nextRunAt: null,
      github: result.github,
      failures,
      error: result.error?.message ?? null
    })
    // Jitter de ±10% para não alinhar todos os projetos no mesmo segundo.
    const jitter = 1 + (this.random() - 0.5) * 0.2
    const delay = failed
      ? Math.min(this.maxBackoff, this.interval * 2 ** Math.min(failures, 8))
      : Math.round(this.interval * jitter)
    this.plan(projectId, delay)
  }

  private scheduleLocal(): void {
    if (this.stopped) return
    this.localTimer = this.schedule(() => {
      void this.checkLocal().finally(() => this.scheduleLocal())
    }, this.localInterval)
  }

  /** Branch criada sem checkout (`git branch X`) não muda o HEAD: compara a lista local. */
  private async checkLocal(): Promise<void> {
    for (const projectId of this.deps.projects()) {
      const branches = await this.deps.localBranches(projectId).catch(() => null)
      if (!branches) continue
      const key = [...branches].sort().join('\n')
      const before = this.lastLocal.get(projectId)
      this.lastLocal.set(projectId, key)
      if (before !== undefined && before !== key) void this.tick(projectId, false)
    }
  }
}
