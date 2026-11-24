/**
 * Dependência que só existe depois (ciclo entre serviços: o quadro avisa o fluxo, que usa o
 * quadro). Usar antes de `set` LANÇA, em vez de virar um `?.` que some com o pedido em silêncio.
 */
export interface Late<T> {
  (): T
  set(value: T): void
}

export function late<T>(name: string): Late<T> {
  let value: { v: T } | null = null
  const get = (() => {
    if (!value) throw new Error(`${name} usado antes de ser criado`)
    return value.v
  }) as Late<T>
  get.set = (v: T) => {
    if (value) throw new Error(`${name} já foi criado`)
    value = { v }
  }
  return get
}
