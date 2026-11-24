import type { ORKIO_API } from '../../shared/ipc/api'
import type { BoardService } from '../board/board.service'
import type { Impl } from './register'

const MAX_FILE_BYTES = 1024 * 1024

export interface FlowFiles {
  /** Abre "Salvar como…" e grava; `null` = cancelado. */
  save(json: string): Promise<boolean | null>
  /** Abre o seletor e devolve o texto; `null` = cancelado. */
  open(maxBytes: number): Promise<string | null>
}

/** Editor do fluxo (3C): salvar (validado de novo no serviço), histórico, exportar e importar. */
export function flowHandlers(
  service: Pick<BoardService, 'saveFlow' | 'configEvents'>,
  files: FlowFiles
): Impl<typeof ORKIO_API.flow> {
  return {
    save: (projectId, draft) => service.saveFlow(projectId, draft),
    events: (projectId) => service.configEvents(projectId),
    exportFile: async (content) => {
      const json = JSON.stringify(content, null, 2)
      if (typeof content !== 'object' || content === null || json.length > MAX_FILE_BYTES) {
        return { ok: false, cancelled: false, message: 'Fluxo grande demais para exportar.' }
      }
      const saved = await files.save(json)
      return saved === null ? { ok: false, cancelled: true } : { ok: true, content: null }
    },
    importFile: async () => {
      const text = await files.open(MAX_FILE_BYTES)
      if (text === null) return { ok: false, cancelled: true }
      try {
        return { ok: true, content: JSON.parse(text) as unknown }
      } catch {
        return { ok: false, cancelled: false, message: 'O arquivo não é um JSON válido.' }
      }
    }
  }
}
