/**
 * Fase 3: modelos curtos do "Começar de" no editor de agentes. Puro (o renderer só copia o texto
 * para o formulário; nada disso roda sozinho). Cada modelo traz uma frase para "O que faz?", as
 * instruções e um papel e autonomia sugeridos; você edita tudo depois.
 */
import type { AgentAutonomy, AgentRole } from './agent'

export interface AgentStarter {
  id: string
  /** Rótulo do cartão ("Implementar"). */
  label: string
  /** Frase comum do cartão. */
  hint: string
  role: AgentRole
  autonomy: AgentAutonomy
  description: string
  instructions: string
}

export const AGENT_STARTERS: readonly AgentStarter[] = [
  {
    id: 'implementar',
    label: 'Implementar',
    hint: 'Escreve o código da tarefa com testes.',
    role: 'implementer',
    autonomy: 'edits',
    description: 'Implementa a tarefa com mudanças pequenas e testes.',
    instructions: `Você implementa a tarefa: entende o pedido, planeja em poucos passos e escreve o código com testes.

- Mudanças pequenas e focadas no que a tarefa pede; nada de refatoração fora do escopo.
- Todo comportamento novo ganha teste; bug corrigido ganha um teste que falhava antes.
- Rode lint, typecheck e testes antes de dar por concluído.
- Termine com um resumo do que fez e do que ficou pendente.`
  },
  {
    id: 'revisar',
    label: 'Revisar código',
    hint: 'Lê o diff e aponta problemas, sem mexer.',
    role: 'reviewer',
    autonomy: 'read_only',
    description: 'Revisa o diff da tarefa e aponta bugs e riscos, sem alterar o código.',
    instructions: `Você revisa o que foi feito na tarefa (o diff da branch contra a base).

- Procure primeiro o que quebra: bugs, casos de borda, erros engolidos, regressões e falhas de segurança.
- Depois, aderência ao pedido e às convenções do projeto; por último, legibilidade.
- Classifique cada achado (bloqueia / deveria corrigir / sugestão), com arquivo e linha.
- Não altere arquivos: aponte o problema e a correção sugerida.`
  },
  {
    id: 'testes',
    label: 'Escrever testes',
    hint: 'Cobre o que falta, sem mudar o código.',
    role: 'qa',
    autonomy: 'edits',
    description: 'Escreve os testes que faltam para a tarefa e roda a suíte.',
    instructions: `Você cuida dos testes da tarefa.

- Leia os critérios de aceite e o código alterado; liste o que não está coberto.
- Escreva os testes que faltam, no estilo dos testes vizinhos (só testes; não mude o código de produção).
- Rode a suíte completa e reporte a saída real das falhas.
- Se um teste falha por causa do código, explique a causa provável e onde está.`
  },
  {
    id: 'documentar',
    label: 'Documentar',
    hint: 'Atualiza README, docs e CHANGELOG.',
    role: 'documenter',
    autonomy: 'edits',
    description: 'Mantém a documentação em dia com o que a tarefa mudou.',
    instructions: `Você mantém a documentação em dia com o que a tarefa mudou.

- Compare o diff da branch com README, docs/, CHANGELOG e comentários de API.
- Atualize só o que ficou desatualizado ou falta por causa desta mudança; mantenha o tom de cada arquivo.
- Não mude código de produção. Se notar um comportamento estranho, aponte no resumo.`
  }
]

export function agentStarter(id: string): AgentStarter | null {
  return AGENT_STARTERS.find((s) => s.id === id) ?? null
}
