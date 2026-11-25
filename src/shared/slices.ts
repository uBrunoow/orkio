/**
 * Fase 5: fatias do "Quebrar em passos" com o git como checkpoint (puro). Cada fatia vira um commit
 * só (squash) com o trailer `Spec-Slice: <n>`; o Orkio lê os trailers da branch antes de cada fatia
 * e sabe quais já estão feitas, então retomar (reabrir o app, "Retomar", rodar de novo) nunca refaz
 * uma fatia pronta. As dependências entre fatias vêm do plano (`@orkio depende_N=1,2`) e decidem a
 * ordem (`nextSlices`): só entra uma fatia cujas dependências já estão no git.
 */

export const SLICE_TRAILER = 'Spec-Slice'

/** Variáveis do checkpoint (gravadas pela ação `slices_checkpoint`). */
export const SLICE_VARS = {
  total: 'fatias',
  done: 'fatias.feitas',
  next: 'fatias.proximas',
  left: 'restam'
} as const

/** Números das fatias nos valores do trailer (`Spec-Slice: 3`, `Spec-Slice: 3, 4`). */
export function slicesDone(trailerValues: readonly string[]): number[] {
  const out = new Set<number>()
  for (const value of trailerValues) {
    for (const part of value.split(/[,\s]+/)) {
      const n = Number(part.replace(/^#/, ''))
      if (Number.isInteger(n) && n > 0 && n <= 99) out.add(n)
    }
  }
  return [...out].sort((a, b) => a - b)
}

/** Dependências das variáveis do plano: `depende_3=1,2` → 3 depende de 1 e 2. */
export function sliceDeps(vars: Readonly<Record<string, string>>): Map<number, number[]> {
  const deps = new Map<number, number[]>()
  for (const [key, value] of Object.entries(vars)) {
    const m = /^depende_(\d{1,2})$/.exec(key)
    if (!m) continue
    const list = value
      .split(/[,\s]+/)
      .map(Number)
      .filter((n) => Number.isInteger(n) && n > 0 && n !== Number(m[1]))
    deps.set(Number(m[1]), list)
  }
  return deps
}

/**
 * Fatias prontas para começar: não feitas e com todas as dependências feitas (dependência de uma
 * fatia que não existe é ignorada). Um ciclo nas dependências não trava: sem nenhuma pronta, vale
 * a de menor número que falta. `limit` = quantas cabem agora (o limite paralelo).
 */
export function nextSlices(
  total: number,
  done: readonly number[],
  deps: ReadonlyMap<number, readonly number[]>,
  limit = Infinity
): number[] {
  const finished = new Set(done)
  const missing: number[] = []
  for (let n = 1; n <= total; n++) if (!finished.has(n)) missing.push(n)
  const ready = missing.filter((n) =>
    (deps.get(n) ?? []).every((d) => d > total || finished.has(d))
  )
  const pick = ready.length > 0 ? ready : missing.slice(0, 1)
  return pick.slice(0, Math.max(1, limit))
}

/**
 * Ondas de execução: cada onda tem as fatias independentes entre si (podem rodar em paralelo, até
 * `limit` por vez). Base do paralelo; hoje o fluxo roda uma onda de cada vez, uma fatia por passo.
 */
export function sliceWaves(
  total: number,
  deps: ReadonlyMap<number, readonly number[]>,
  limit = Infinity
): number[][] {
  const waves: number[][] = []
  const done: number[] = []
  while (done.length < total) {
    const wave = nextSlices(total, done, deps, limit)
    waves.push(wave)
    done.push(...wave)
  }
  return waves
}
