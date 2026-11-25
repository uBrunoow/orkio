import { useSyncExternalStore } from 'react'

/**
 * Preferência só deste computador em `localStorage` (Aparência, Layout): um objeto de campos com
 * valores numa lista fechada. Campo ausente ou inválido volta ao padrão; sem armazenamento, vale
 * até fechar o app. Quem precisa reagir na hora usa o `use()` (uma assinatura por preferência).
 */
export interface LocalPref<T extends Record<string, string>> {
  readonly key: string
  readonly defaults: T
  parse(raw: string | null): T
  read(): T
  save(value: T): void
  use(): T
}

/** Cada campo com os valores aceitos (o primeiro não é o padrão: o padrão vem de `defaults`). */
export type PrefSchema<T extends Record<string, string>> = { [K in keyof T]: readonly T[K][] }

export function createLocalPref<T extends Record<string, string>>(
  key: string,
  schema: PrefSchema<T>,
  defaults: T,
  onSave?: (value: T) => void
): LocalPref<T> {
  const listeners = new Set<() => void>()
  let cached: { raw: string | null; value: T } | null = null

  const parse = (raw: string | null): T => {
    let v: unknown
    try {
      v = raw ? JSON.parse(raw) : null
    } catch {
      v = null
    }
    const r = typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {}
    const out = { ...defaults }
    for (const k of Object.keys(schema) as (keyof T)[]) {
      const allowed = schema[k] as readonly unknown[]
      if (allowed.includes(r[k as string])) out[k] = r[k as string] as T[keyof T]
    }
    return out
  }

  const rawValue = (): string | null => {
    try {
      return window.localStorage.getItem(key)
    } catch {
      return null
    }
  }

  let memory: T | null = null
  const read = (): T => {
    if (memory) return memory
    const raw = rawValue()
    if (cached && cached.raw === raw) return cached.value
    cached = { raw, value: parse(raw) }
    return cached.value
  }

  return {
    key,
    defaults,
    parse,
    read,
    save(value) {
      try {
        window.localStorage.setItem(key, JSON.stringify(value))
        memory = null
      } catch {
        memory = value
      }
      cached = null
      onSave?.(value)
      for (const l of listeners) l()
    },
    use() {
      return useSyncExternalStore(
        (l) => {
          listeners.add(l)
          return () => listeners.delete(l)
        },
        read,
        read
      )
    }
  }
}
