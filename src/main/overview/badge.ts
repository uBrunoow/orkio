/**
 * Total de "Esperando você" no ícone do app (Visão geral, 6D). macOS: badge do Dock; Linux:
 * contador do launcher (Unity/KDE, quando o ambiente suporta). O Windows não tem contador na barra
 * de tarefas: usamos um ícone sobreposto (ponto laranja) com a descrição acessível.
 */

/** BGRA de um círculo cheio (16×16) na cor da marca, para o ícone sobreposto do Windows. */
export function overlayDotBitmap(size = 16): Buffer {
  const buf = Buffer.alloc(size * size * 4)
  // Laranja Orkio (brand/tokens.css --accent), em BGRA.
  const [b, g, r] = [0x1f, 0x5b, 0xff]
  const c = (size - 1) / 2
  const radius = size / 2
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c)
      const alpha = Math.max(0, Math.min(1, radius - d))
      const i = (y * size + x) * 4
      buf[i] = b
      buf[i + 1] = g
      buf[i + 2] = r
      buf[i + 3] = Math.round(alpha * 255)
    }
  }
  return buf
}

export interface BadgeTarget {
  platform: NodeJS.Platform
  setBadgeCount(count: number): boolean
  /** Janelas abertas (Windows: ícone sobreposto em cada uma). */
  windows(): { setOverlayIcon(icon: unknown, description: string): void }[]
  overlayIcon(): unknown
}

export function waitingDescription(count: number): string {
  return count === 1 ? '1 item esperando você' : `${count} itens esperando você`
}

/** Aplica o total; erros (ambiente sem suporte) são ignorados. */
export function applyWaitingBadge(target: BadgeTarget, count: number): void {
  try {
    target.setBadgeCount(count)
  } catch {
    // Sem suporte (ex.: Linux sem launcher compatível): só o menu lateral mostra o total.
  }
  if (target.platform !== 'win32') return
  for (const win of target.windows()) {
    try {
      win.setOverlayIcon(
        count > 0 ? target.overlayIcon() : null,
        count > 0 ? waitingDescription(count) : ''
      )
    } catch {
      // Janela fechando.
    }
  }
}
