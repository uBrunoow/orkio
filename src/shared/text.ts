/** Texto para comparar e montar ids, igual em main e renderer. */

/** Sem acento: decompõe (NFD) e tira as marcas combinantes. Mantém a caixa. */
export function stripAccents(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

/**
 * Rótulo para comparar ("Em  Andamento" = "em andamento"): sem acento, minúsculas, espaços
 * juntados e sem espaço nas pontas.
 */
export function normalizeLabel(value: string): string {
  return stripAccents(value).toLowerCase().replace(/\s+/g, ' ').trim()
}
