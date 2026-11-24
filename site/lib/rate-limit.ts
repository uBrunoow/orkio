/**
 * Limitador simples em memória por IP (janela deslizante), usado nas rotas do intermediário do
 * Notion (/notion/*), na revisão do GitHub App (/github/review) e na consulta da instalação
 * (/github/installation). Defesa MÍNIMA: vale por instância
 * da função (a Vercel pode ter várias e reciclá-las). A proteção real é a regra de Rate Limiting do
 * Firewall da Vercel em /notion/* e /github/* (ver site/README.md).
 */
export interface RateLimiter {
  /** `null` = pode seguir; senão, segundos até liberar. */
  check(key: string): number | null
}

export function createRateLimiter(options: {
  limit: number
  windowMs: number
  now?: () => number
  maxKeys?: number
}): RateLimiter {
  const hits = new Map<string, number[]>()
  const now = options.now ?? Date.now
  const maxKeys = options.maxKeys ?? 10_000
  return {
    check(key) {
      const t = now()
      const since = t - options.windowMs
      const recent = (hits.get(key) ?? []).filter((h) => h > since)
      if (recent.length >= options.limit) {
        hits.set(key, recent)
        const first = recent[0] ?? t
        return Math.max(1, Math.ceil((first + options.windowMs - t) / 1000))
      }
      recent.push(t)
      hits.delete(key)
      hits.set(key, recent)
      // Mais antigas primeiro (ordem de inserção do Map): descarta o excedente.
      while (hits.size > maxKeys) {
        const oldest = hits.keys().next().value
        if (oldest === undefined) break
        hits.delete(oldest)
      }
      return null
    }
  }
}

/** IP do cliente atrás da Vercel (`x-forwarded-for`, primeiro valor). */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')
  const first = forwarded?.split(',')[0]?.trim()
  return first || request.headers.get('x-real-ip')?.trim() || 'desconhecido'
}

/** Limite das rotas /notion/*: 20 por minuto por IP (o login usa 1; renovações são raras). */
export const brokerLimiter = createRateLimiter({ limit: 20, windowMs: 60_000 })

/** Limite de /github/review: 20 por minuto por IP (uma revisão por passo de fluxo). */
export const reviewLimiter = createRateLimiter({ limit: 20, windowMs: 60_000 })

/** Limite de /github/installation: 30 por minuto por IP (o app consulta poucos repositórios). */
export const installationLimiter = createRateLimiter({ limit: 30, windowMs: 60_000 })
