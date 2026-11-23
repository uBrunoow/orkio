/**
 * Diagnóstico do Orkio (puro): o texto que a pessoa copia em Configurações > Sobre para pedir ajuda.
 * Só versões, contagens e estados. Nunca tokens, e-mails, títulos de tarefa, prompts, briefing,
 * caminhos de pastas ou conteúdo do Notion/GitHub: o coletor (main) já só junta isso, e o texto
 * final ainda passa por `redactSecrets`.
 */

export type DiagnosticValue = string | number | boolean | null

export interface DiagnosticSection {
  title: string
  rows: readonly (readonly [label: string, value: DiagnosticValue])[]
}

function show(value: DiagnosticValue): string {
  if (value === null) return '—'
  if (typeof value === 'boolean') return value ? 'sim' : 'não'
  return String(value)
}

/** Texto simples (markdown leve), uma seção por bloco, pronto para colar numa issue. */
export function formatDiagnostics(
  generatedAt: string,
  sections: readonly DiagnosticSection[]
): string {
  const out = ['# Diagnóstico do Orkio', '', `Gerado em ${generatedAt}`]
  for (const s of sections) {
    out.push('', `## ${s.title}`, '')
    for (const [label, value] of s.rows) out.push(`- ${label}: ${show(value)}`)
  }
  out.push(
    '',
    'Sem tokens, e-mails, títulos de tarefas, prompts, caminhos ou conteúdo do Notion/GitHub.'
  )
  return out.join('\n')
}
