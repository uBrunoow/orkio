/** Abaixo desta largura (janela), o painel da fase vira abas acima da conversa. */
export const SIDE_PANEL_MIN_WIDTH = 1200

export function taskLayout(windowWidth: number): 'columns' | 'stacked' {
  return windowWidth < SIDE_PANEL_MIN_WIDTH ? 'stacked' : 'columns'
}
