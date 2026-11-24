/** Abaixo desta largura (janela), o painel da fase vira abas acima da conversa. */
export const SIDE_PANEL_MIN_WIDTH = 1200

export function taskLayout(windowWidth: number): 'columns' | 'stacked' {
  return windowWidth < SIDE_PANEL_MIN_WIDTH ? 'stacked' : 'columns'
}

/** Abaixo desta largura (janela), a barra de fases fica compacta (só a fase de agora com rótulo). */
export const PHASE_LABELS_MIN_WIDTH = 1280

export function compactPhaseBar(windowWidth: number): boolean {
  return windowWidth < PHASE_LABELS_MIN_WIDTH
}
