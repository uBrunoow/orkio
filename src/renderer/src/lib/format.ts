/** Formatação de texto de UI em pt-BR (6E): plurais de verdade e moeda com vírgula. */

/** `plural(1, 'arquivo', 'arquivos')` → "1 arquivo"; `plural(2, …)` → "2 arquivos". */
export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

const USD = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
})

/** Custo em dólar no formato brasileiro: "US$ 0,01". */
export function formatUsd(value: number): string {
  return USD.format(value).replace(/\u00a0/g, ' ')
}
