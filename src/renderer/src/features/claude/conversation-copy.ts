import type { AgentRunView, RunLogEvent } from '../../../../shared/agent-run'

/** O que você mandou numa execução: o comando com os argumentos ou o texto. */
function askedText(run: AgentRunView): string | null {
  if (run.mode === 'command' && run.command) {
    return `/${run.command}${run.text ? ` ${run.text}` : ''}`
  }
  return run.text?.trim() ? run.text : null
}

/** Respostas do Claude na conversa principal (texto), na ordem. */
function answers(log: readonly RunLogEvent[]): string[] {
  return log.flatMap((e) => (e.kind === 'text' && e.text.trim() ? [e.text.trim()] : []))
}

/**
 * A conversa da tarefa em Markdown ("Copiar conversa"): execuções da mais antiga para a mais
 * recente, com o seu pedido e as respostas do Claude. Ferramentas e permissões ficam de fora.
 * `runs` vem como a tela recebe (mais recente primeiro).
 */
export function conversationMarkdown(
  runs: readonly AgentRunView[],
  logs: ReadonlyMap<string, readonly RunLogEvent[]>
): string {
  const blocks: string[] = []
  for (const run of [...runs].reverse()) {
    const asked = askedText(run)
    const said = answers(logs.get(run.id) ?? [])
    const block = [
      ...(asked ? [`**Você:**\n\n${asked}`] : []),
      ...(said.length > 0 ? [`**Claude:**\n\n${said.join('\n\n')}`] : [])
    ]
    if (block.length > 0) blocks.push(block.join('\n\n'))
  }
  return blocks.join('\n\n---\n\n')
}

/** A última resposta do Claude no log (o "Copiar última resposta"); `null` sem resposta. */
export function lastAnswer(log: readonly RunLogEvent[]): string | null {
  const said = answers(log)
  return said.at(-1) ?? null
}
