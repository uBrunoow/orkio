/**
 * Larguras máximas das páginas (classes do Tailwind), por intenção:
 * - `form`: telas de leitura e formulário, linha confortável;
 * - `list`: telas de lista com ações (Projetos, Integrações, Agentes, Início);
 * - `wide`: telas de trabalho com painel ao lado (a tarefa). Só o Quadro e o terminal usam a janela toda.
 * Centralizadas na área de conteúdo (`mx-auto`), com o respiro lateral da tela em volta. As medidas
 * são variáveis do tema (`--page-form`/`--page-list`): "Largura total" em Configurações › Layout
 * as solta (`data-page-width`).
 */
export const PAGE_WIDTH = {
  form: 'mx-auto w-full max-w-(--page-form)',
  list: 'mx-auto w-full max-w-(--page-list)',
  wide: 'mx-auto w-full max-w-(--page-wide)'
} as const
