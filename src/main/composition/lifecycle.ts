/** O que o desligamento precisa de cada parte (o banco local pode faltar: `work` = null). */
export interface StopParts {
  work: {
    flows: { dispose(): void }
    runs: { cancelAll(): void; activeRuns(): readonly { queued: boolean }[] }
    /** Fase 2: terminais embutidos (PTY) saem junto. */
    terminals: { stopAll(): void }
    writes: { stop(): void }
    /** Fila das escritas do Fluxo Git no Notion. */
    gitFlowWrites?: { stop(): void }
    scheduler: { stop(): void }
    /** Fase 5: a conferência das PRs que acordam fluxos. */
    prWake?: { stop(): void }
    overview: { dispose(): void }
  } | null
  projects: { dispose(): void }
  keepAwake: { dispose(): void }
  updates: { stop(): void }
}

export interface StopOptions {
  /** Quanto esperar as execuções do Claude Code saírem (0 = não espera: fechamento normal). */
  waitMs: number
}

/**
 * O único caminho de desligar (fechar o app e instalar atualização). A ordem é obrigatória: o
 * fluxo para de reagir (`dispose`) ANTES de as execuções serem canceladas, senão o cancelamento
 * vira "passo falhou" e o fluxo segue. Chamar de novo devolve o mesmo desligamento.
 */
export function createStop(
  parts: () => StopParts,
  deps: { sleep?: (ms: number) => Promise<void>; now?: () => number } = {}
): (options: StopOptions) => Promise<void> {
  const sleep = deps.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const now = deps.now ?? Date.now
  let stopping: Promise<void> | null = null
  return (options) => {
    stopping ??= (async () => {
      const { work, projects, keepAwake, updates } = parts()
      work?.flows.dispose()
      work?.runs.cancelAll()
      work?.terminals.stopAll()
      if (work && options.waitMs > 0) {
        const deadline = now() + options.waitMs
        while (work.runs.activeRuns().some((r) => !r.queued) && now() < deadline) await sleep(200)
      }
      work?.writes.stop()
      work?.gitFlowWrites?.stop()
      work?.scheduler.stop()
      work?.prWake?.stop()
      work?.overview.dispose()
      projects.dispose()
      keepAwake.dispose()
      updates.stop()
    })()
    return stopping
  }
}
