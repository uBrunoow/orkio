/**
 * Rascunho que outra parte da tela põe no campo da sessão (Fase 2): "Editar mensagem" devolve o
 * seu texto e volta a conversa até antes dele; "Ramificar daqui" abre uma conversa nova a partir de
 * uma resposta do Claude. Os dois mandam a próxima mensagem numa sessão ramificada
 * (`SendMessageRequest.fork`).
 */
import type { SessionFork } from '../../../../shared/agent-run'

export interface ComposerDraft {
  kind: 'edit' | 'branch'
  /** Texto que vai para o campo (a mensagem a editar; vazio ao ramificar). */
  text: string
  fork: SessionFork
  /** Começo do ponto escolhido, para a faixa acima do campo. */
  excerpt: string
}

export function draftExcerpt(text: string, max = 80): string {
  const one = text.replace(/\s+/g, ' ').trim()
  return one.length > max ? `${one.slice(0, max - 1)}…` : one
}

export const DRAFT_TEXT = {
  edit: 'Editando a mensagem: a conversa volta até antes dela.',
  branch: 'Ramificando desta resposta: conversa nova a partir daqui.',
  files: 'Os arquivos da pasta de trabalho continuam como estão.'
} as const
