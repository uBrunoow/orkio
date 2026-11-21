# Redesign visual (inspirado em Compozy e OpenBot)

Redesign só do renderer: estrutura, densidade e disciplina visual das referências, mantendo a
identidade do Orkio e as regras do `CLAUDE.md` (que vencem este documento). Sem mudança de
comportamento, IPC, main, config ou SQLite. Prints em `docs/ui-redesign/<fase>/` (antes/depois,
1280×800 e 1000×700). A "Fase 3" de `docs/ui-reorg.md` (padrões A–J) fica como histórico; este
plano a substitui onde houver diferença.

## Fases

| Fase                      | Escopo                                                                                                                        | Estado             |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| 1. Base visual            | Densidade pelo tema, `StatusToken` (ponto + texto), `PageHeader` compacto com metadados `·`, prioridade e "Rodando" sem bloco | feita              |
| 2. Moldura                | Coluna de ícones, barra superior com seletor de projeto, conteúdo em painel                                                   | feita              |
| 3. Quadro                 | Card de três linhas, colunas com contador e recolher, avatares de agentes                                                     | feita (aguarda ok) |
| 4. Agentes                | Grade de cards, filtros em pílulas, Linhas/Cards, busca `/`                                                                   | —                  |
| 5. Tarefa como conversa   | Linha do tempo de mensagens, cartões de decisão                                                                               | —                  |
| 6. Detalhes em frase      | Regras e Fluxos: título-frase, "Começa / Faz", execuções, detalhes                                                            | —                  |
| 7. Integrações e catálogo | Grade de linhas com logo, categoria e ação                                                                                    | —                  |

## Fase 1

**Tema** (`pnpm exec astryx experimental theme editor set orkio …`, conferido pelo PNG):
`text-size less` (base 13 px; títulos, código e "supporting" proporcionais) e `spacing less`
(preenchimentos, vãos e alturas de controle juntos). Cores intactas.

**Componentes**

- `components/StatusToken.tsx` (novo): mapa único de estado → ponto colorido + texto, sem bloco.
  `success` concluído/OK/aprovado · `warning` esperando você/falta configurar/não verificado ·
  `danger` falhou/CI vermelho/alterações pedidas · `running` agente rodando (único laranja de
  estado) · `neutral` o resto. `toneOf(cor)` converte os mapas antigos (cores de `Token`).
- Migrados para `StatusToken`: execução (`RunLog`, `TaskClaudeSection`), fluxo e CI
  (`TaskFlowSection`), PR/revisão/checks (`TaskSignalsLine`), agentes, alva-flow, Claude Code,
  Visão geral, Projetos, regras (`FlowPage`), conexões, "Sincronizando".
- Prioridade ("Alta") vira texto cinza (`task-priority` e `card-priority` mantidos).
- `PageHeader`: prop `meta` (linha cinza com `·`, `data-testid="page-meta"`). Ainda sem uso nas
  telas; entra a partir da fase 2/3.
- `Token` continua onde é categoria, não estado: cor de etapa, tipo de passo, opções do Notion.

**Recusado / adiado**

- Reduzir o h1 só na tela: densidade é do tema; o h1 já cai com `text-size less`. Se ainda ficar
  grande, ajustar o tema (`--on heading`), nunca a página.
- Avatares, quadro e agentes ficam para as fases 3 e 4.

## Fase 2

- **Barra superior** (`TopNav`, "Barra superior"): logo com wordmark, seletor do projeto atual
  (menu quando há mais de um projeto; texto quando há um) e, à direita, Buscar (Ctrl/Cmd+K) e o sino
  com o contador de "esperando você" (leva à Visão geral). Substitui o "Projeto atual" do menu.
- **Coluna de ícones**: `SideNav` recolhido fixo (sem botão de recolher); o rótulo vai no tooltip e
  no nome acessível. Ctrl/Cmd+1…9 e `aria-keyshortcuts` mantidos. Grupos: Visão geral · telas do
  projeto · Projetos, Agentes, Integrações, Configurações.
- **Contador na coluna**: a Astryx esconde `endContent` no modo recolhido, então a Visão geral troca
  o ícone por uma versão com ponto laranja quando há algo esperando (`OverviewAttentionIcon`); o
  número fica no sino da barra superior.
- **Painel**: o conteúdo já ficava no painel com borda e raio do `AppShell` (`variant="elevated"`); só
  o Quadro usa a altura toda (colunas com rolagem própria), as outras telas rolam o painel.
- `routes.ts`, `shortcuts.ts` e a Command Palette não mudaram.
- Testes: `overview.spec` lê o contador no sino ("1 esperando você"); `choose()` do
  `task-flows.spec` clica na opção pelo DOM, porque a lista abre abaixo da janela no fim do painel.

**Recusado / adiado**

- "Todos os projetos ▾": não há escopo "todos" nos dados (as telas de projeto exigem um). O seletor
  mostra o projeto atual. Reavaliar na fase 3 com os avatares.
- Ponto no item atual da coluna: o estado selecionado da Astryx já o destaca.
- Cabeçalho do painel com ícone + contador + Lista/Kanban: vem com o Quadro (fase 3).

## Fase 3

**Quadro**

- Card de três linhas: ID + avatar do agente + estado (`StatusToken`) + menu; título (até 2
  linhas); linha cinza com bloqueada, automações pausadas, branch, PR, prioridade, responsáveis.
- `cardStatus` usa o mapa único: "Esperando você" amarelo, falhas em vermelho, "Fluxo rodando"
  laranja (o único laranja de estado; antes era "Esperando você").
- Colunas com contador e botão "Recolher <etapa>": recolhida vira uma faixa estreita com
  "Expandir <etapa>", contagem e nome na vertical. Continua aceitando cards arrastados. Estado só
  na sessão da tela (nada salvo em config).
- Faixa "Agentes" acima das colunas (só quando há tarefas com agente): avatar, nome e quantas
  tarefas; clicar filtra o quadro pelo agente; ponto laranja = agente com fluxo rodando.
- Alternância Kanban/Lista (`SegmentedControl`), sem dado novo: a lista mostra uma linha por
  tarefa na ordem das etapas, com estado, etapa e o mesmo menu "Ações de…".
- Tarefa aberta numa folha sobre as colunas, como o "side peek" do Notion (pedido na revisão da fase 2):
  sobrepõe as colunas em vez de empurrá-las; "Abrir tarefa" expande para a página inteira;
  "Fechar" e Esc fecham. A folha fica abaixo do cabeçalho e dos filtros, que continuam ao
  alcance ("Atualizar" com a tarefa aberta). O `Drawer` da Astryx cobria a janela toda e
  escondia o cabeçalho; por isso foi recusado.

**Recusado / adiado**

- Guardar colunas recolhidas e a visualização escolhida: exigiria config nova (main). Fica na
  sessão.
- Avatar geométrico: fase 4 (hoje ainda é o `Token` com iniciais).

## Recusado em todas as fases (e por quê)

- Mascotes, logos, nomes e textos das referências: identidade própria.
- Balão da pessoa em laranja: laranja só na ação principal, símbolo e agente rodando.
- Campo de chat livre (Queue/Steer/Interrupt): seria funcionalidade nova no `claude -p`.
- Editor de fluxo em grafo: exige canvas fora da Astryx (CSP, acessibilidade).
