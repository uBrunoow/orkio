/**
 * Larguras máximas das páginas (6E), em tokens do tema. Duas, por intenção:
 * - `form`: telas de leitura e formulário (Configurações, Contexto, alva-flow), linha confortável;
 * - `list`: telas de lista com ações (Projetos, Integrações).
 * Quadro, Agentes, Visão geral e as telas de edição em duas colunas usam a largura toda.
 */
export const PAGE_WIDTH = {
  form: 'calc(var(--spacing-12) * 21)',
  list: 'calc(var(--spacing-12) * 26)'
} as const
