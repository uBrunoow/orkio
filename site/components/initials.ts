/** Iniciais do avatar de um agente (as mesmas na prévia e nos recortes): "Corretor de PR" → "CP". */
export function initials(name: string): string {
  const words = name.split(/\s+/).filter(Boolean)
  const letters = words.length > 1 ? words.map((w) => w[0]).join('') : (words[0] ?? '').slice(0, 2)
  return letters.slice(0, 2).toUpperCase()
}
