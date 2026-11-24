/**
 * Peças das migrações publicadas, CONGELADAS: copiadas da época em que cada migração saiu. Nunca
 * importe daqui código vivo (templates, regras padrão, normalização): mudar o app hoje não pode
 * mudar o resultado de uma migração antiga. Mudou o formato? Migração nova, com os dados dela.
 */

/** Nome de etapa para comparar (sem acento/caixa, espaços juntados), como na época. */
export function sameStageName(a: string, b: string): boolean {
  const norm = (s: string): string =>
    s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
  return norm(a) === norm(b)
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function rawStages(board: unknown): { id: string; name: string }[] {
  return isRecord(board) && Array.isArray(board['stages'])
    ? board['stages'].filter(
        (s): s is { id: string; name: string } =>
          isRecord(s) && typeof s['id'] === 'string' && typeof s['name'] === 'string'
      )
    : []
}

export function stageIdByName(
  stages: readonly { id: string; name: string }[],
  name: string
): string | null {
  return stages.find((s) => sameStageName(s.name, name))?.id ?? null
}
