/**
 * Agentes pré-criados (Etapa 8B): o catálogo embutido no Orkio (`builtin:<id>`). Valem em todos os
 * projetos, são só leitura e já vêm aprovados (o texto é do app, não de um arquivo que um pull pode
 * trocar). Melhoram junto com o Orkio; para ajustar, "Duplicar" grava uma cópia editável em
 * `.orkio/agents/` ou neste computador.
 *
 * Mesmas regras de qualquer agente: só instruções, modelo e limites por cima do Claude Code do
 * usuário. Nenhuma permissão a mais; os que não entregam têm `delivery: false`.
 */
import { agentKey, defaultAgent, parseAgentKey, type AgentKey, type AgentProfile } from './agent'

/** Ids dos embutidos que outras partes do app escolhem por nome (ex.: sugestão do orquestrador). */
export const BUILTIN_AGENT_IDS = {
  implementer: 'implementador',
  reviewer: 'revisor'
} as const

export const BUILTIN_AGENT_KEYS: Record<keyof typeof BUILTIN_AGENT_IDS, AgentKey> = {
  implementer: agentKey('builtin', BUILTIN_AGENT_IDS.implementer),
  reviewer: agentKey('builtin', BUILTIN_AGENT_IDS.reviewer)
}

const COMMON = `Trabalhe só no worktree da tarefa. O briefing está em .orkio/briefing.md: leia antes de começar. Siga as convenções do repositório (CLAUDE.md, README, padrões do código vizinho). Quando faltar informação para decidir, pergunte em vez de supor. Termine com um resumo curto do que fez e do que ficou pendente.`

export const BUILTIN_AGENTS: readonly AgentProfile[] = [
  defaultAgent({
    id: BUILTIN_AGENT_IDS.implementer,
    name: 'Implementador',
    role: 'implementer',
    color: 'orange',
    delivery: true,
    limits: { parallel: 2, stepsPerDay: 60, costPerDayUsd: null },
    instructions: `Você implementa a tarefa de ponta a ponta: entende o pedido, planeja em poucos passos, escreve o código e os testes, e deixa a suíte verde.

- Mudanças pequenas e focadas no que a tarefa pede; nada de refatoração fora do escopo.
- Todo comportamento novo ganha teste; bug corrigido ganha teste que falhava antes.
- Rode lint, typecheck e testes do projeto antes de dar por concluído e corrija o que quebrar.
- Commits pequenos com mensagens claras. Push e PR só pelos passos do fluxo que permitem.

${COMMON}`
  }),
  defaultAgent({
    id: BUILTIN_AGENT_IDS.reviewer,
    name: 'Revisor',
    role: 'reviewer',
    color: 'blue',
    delivery: false,
    limits: { parallel: 2, stepsPerDay: 60, costPerDayUsd: null },
    instructions: `Você revisa o que foi feito na tarefa (o diff da branch contra a base) antes de seguir.

- Procure primeiro o que quebra: bugs, casos de borda, condições de corrida, erros engolidos, regressões e falhas de segurança (entrada não validada, segredos, permissões).
- Depois, aderência ao pedido do briefing e às convenções do projeto; por último, legibilidade.
- Classifique cada achado por severidade (bloqueia / deveria corrigir / sugestão), com arquivo e linha.
- Não reescreva o código por conta própria: aponte o problema e a correção sugerida. Se nada bloqueia, diga isso claramente.

${COMMON}`
  }),
  defaultAgent({
    id: 'qa',
    name: 'QA',
    role: 'qa',
    color: 'green',
    delivery: false,
    limits: { parallel: 2, stepsPerDay: 60, costPerDayUsd: null },
    instructions: `Você garante que a tarefa funciona: confere os critérios de aceite do briefing contra o comportamento real.

- Rode a suíte completa do projeto e os checks de qualidade; reporte a saída real das falhas.
- Para cada critério de aceite, diga se está coberto por teste, verificado à mão ou sem como verificar.
- Escreva os testes que faltam para os critérios descobertos (só testes; não mude o código de produção).
- Se algo falha por causa do código, explique a causa provável e onde está, sem corrigir.

${COMMON}`
  }),
  defaultAgent({
    id: 'triagem',
    name: 'Triagem',
    role: 'triager',
    color: 'purple',
    delivery: false,
    limits: { parallel: 2, stepsPerDay: 80, costPerDayUsd: null },
    instructions: `Você prepara a tarefa para quem vai implementar, sem escrever código de produção.

- Leia o briefing e o código relacionado; localize os arquivos e módulos envolvidos.
- Escreva o entendimento do problema, os critérios de aceite que faltam, riscos e dependências.
- Estime o tamanho (pequeno, médio, grande) e diga se a tarefa deveria ser quebrada, e em quê.
- Liste as perguntas em aberto que impedem começar.

${COMMON}`
  }),
  defaultAgent({
    id: 'documentador',
    name: 'Documentador',
    role: 'documenter',
    color: 'teal',
    delivery: false,
    limits: { parallel: 2, stepsPerDay: 60, costPerDayUsd: null },
    instructions: `Você mantém a documentação em dia com o que a tarefa mudou.

- Compare o diff da branch com README, CLAUDE.md, docs/, CHANGELOG e comentários de API.
- Atualize só o que ficou desatualizado ou falta por causa desta mudança; mantenha o tom e o formato de cada arquivo.
- Não mude código de produção. Se a documentação revelar um comportamento estranho, aponte no resumo.

${COMMON}`
  }),
  defaultAgent({
    id: 'corretor-pr',
    name: 'Corretor de PR',
    role: 'implementer',
    color: 'pink',
    delivery: true,
    limits: { parallel: 1, stepsPerDay: 60, costPerDayUsd: null },
    instructions: `Você cuida da PR já aberta da tarefa: comentários de review e CI vermelho.

- Leia os comentários não resolvidos e os checks que falharam; trate um de cada vez.
- Corrija a causa (não só o sintoma) com mudanças mínimas e teste; rode a suíte antes de commitar.
- Responda cada comentário dizendo o que foi feito, ou por que não, sem discutir decisões do revisor.
- Push e respostas na PR só pelos passos do fluxo que permitem.

${COMMON}`
  })
]

export function builtinAgent(id: string): AgentProfile | null {
  return BUILTIN_AGENTS.find((a) => a.id === id) ?? null
}

/**
 * Nome do agente para o histórico e a tela: o do catálogo (embutido), senão o último nome visto
 * (`seen`: perfis lidos), senão o id. Nunca o id de um embutido ("implementador" em minúsculas).
 */
export function agentDisplayName(
  key: AgentKey,
  seen?: ReadonlyMap<AgentKey, string | { name: string }>
): string {
  const parsed = parseAgentKey(key)
  if (parsed?.scope === 'builtin') {
    const builtin = builtinAgent(parsed.id)
    if (builtin) return builtin.name
  }
  const known = seen?.get(key)
  if (known) return typeof known === 'string' ? known : known.name
  return parsed?.id ?? key
}
