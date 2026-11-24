/**
 * Casamento de IDs de tarefa (ex.: ORK-142) em nomes de branch e títulos de PR.
 * Função pura, compartilhada entre main e renderer.
 *
 * Regra: `<PREFIXO>-<número>`, sem diferenciar maiúsculas, com fronteira de "palavra" dos dois
 * lados (nem letra nem dígito colado). Assim ORK-14 não casa com ORK-142, XORK-142 não casa e
 * ORK-142a não casa. Zeros à esquerda não casam (ORK-0142 ≠ ORK-142).
 */

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const cache = new Map<string, RegExp>()

function patternFor(prefix: string): RegExp {
  const key = prefix.toLowerCase()
  let re = cache.get(key)
  if (!re) {
    re = new RegExp(
      `(?<![\\p{L}\\p{N}])${escapeRegExp(prefix)}-([1-9]\\d{0,8})(?![\\p{L}\\p{N}])`,
      'giu'
    )
    cache.set(key, re)
  }
  re.lastIndex = 0
  return re
}

/** Números de tarefa com o prefixo dado que aparecem no texto (sem repetição, em ordem). */
export function extractTaskNumbers(text: string, prefix: string): number[] {
  const cleanPrefix = prefix.trim()
  if (!cleanPrefix || !text) return []
  const found: number[] = []
  for (const match of text.matchAll(patternFor(cleanPrefix))) {
    const n = Number(match[1])
    if (!found.includes(n)) found.push(n)
  }
  return found
}

export function mentionsTask(text: string, prefix: string, number: number): boolean {
  return extractTaskNumbers(text, prefix).includes(number)
}

/** "ORK-142" → { prefix: 'ORK', number: 142 }. Sem prefixo (só número) → null. */
export function parseDisplayId(
  displayId: string | null
): { prefix: string; number: number } | null {
  if (!displayId) return null
  const match = /^(.+)-([1-9]\d{0,8})$/.exec(displayId.trim())
  if (!match || !match[1]) return null
  return { prefix: match[1], number: Number(match[2]) }
}

/**
 * ID da tarefa no nome de uma branch do Orkio (`taskBranchName`: `feat/ORK-2-slug`; antigas:
 * `ORK-2/slug`): o começo de um segmento, seguido de `-` ou do fim do segmento. Sem ID → `null`.
 */
export function displayIdInBranch(branch: string): string | null {
  for (const segment of branch.split('/')) {
    const match = /^([A-Za-z][A-Za-z0-9]*-[1-9]\d{0,8})(?=-|$)/.exec(segment)
    if (match?.[1]) return match[1].toUpperCase()
  }
  return null
}
