/**
 * Política única dos erros do Notion (código do `ApiError` do serviço `notion`): o que é recusa
 * definitiva (a fila de escrita desfaz), quando "Reconectar com Notion" resolve e o rótulo curto da
 * recusa em "Esperando você". Main (fila, quadro, bancos) e visão geral leem daqui.
 */

export type NotionConnectionMethod = 'oauth' | 'token' | null

/** Leitura (bancos, tarefas, quadro) ou escrita numa página (status, "Etapa Orkio", "Bloqueada"). */
export type NotionCall = 'read' | 'write'

const PERMANENT = new Set(['bad_request', 'forbidden', 'not_found'])

/** Conexão perdida ou expirada: reconectar sempre resolve. */
const AUTH = new Set(['unauthorized', 'invalid_grant', 'not_connected'])

const LABEL: Record<string, string> = {
  forbidden: 'a integração não pode editar esta página',
  not_found: 'página não encontrada',
  bad_request: 'o Notion recusou o valor',
  unauthorized: 'reconecte o Notion'
}

/** O Notion recusou de vez (400/403/404): tentar de novo não muda nada. */
export function isPermanentNotionError(code: string): boolean {
  return PERMANENT.has(code)
}

/**
 * "Reconectar com Notion" resolve?
 * - conexão perdida/expirada: sempre;
 * - 404 em OAuth: sim (a autorização só enxerga as páginas escolhidas nela);
 * - 403 em OAuth: na leitura sim (mesmo motivo); na escrita não (falta a capacidade **Update
 *   content** da integração, que reconectar não dá).
 */
export function canReconnect(
  code: string,
  method: NotionConnectionMethod,
  call: NotionCall
): boolean {
  if (AUTH.has(code)) return true
  if (method !== 'oauth') return false
  return code === 'not_found' || (code === 'forbidden' && call === 'read')
}

/** Rótulo curto da recusa ("página não encontrada"); `undefined` sem explicação conhecida. */
export function notionErrorLabel(code: string): string | undefined {
  return LABEL[code]
}
