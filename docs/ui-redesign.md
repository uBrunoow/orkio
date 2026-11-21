# Redesign visual (inspirado em Compozy e OpenBot)

Redesign só do renderer: estrutura, densidade e disciplina visual das referências, mantendo a
identidade do Orkio e as regras do `CLAUDE.md` (que vencem este documento). Sem mudança de
comportamento, IPC, main, config ou SQLite. Prints em `docs/ui-redesign/<fase>/` (antes/depois,
1280×800 e 1000×700). A "Fase 3" de `docs/ui-reorg.md` (padrões A–J) fica como histórico; este
plano a substitui onde houver diferença.

## Fases

| Fase                      | Escopo                                                                                                                        | Estado             |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| 1. Base visual            | Densidade pelo tema, `StatusToken` (ponto + texto), `PageHeader` compacto com metadados `·`, prioridade e "Rodando" sem bloco | feita (aguarda ok) |
| 2. Moldura                | Coluna de ícones, barra superior com seletor de projeto, conteúdo em painel                                                   | —                  |
| 3. Quadro                 | Card de três linhas, colunas com contador e recolher, avatares de agentes                                                     | —                  |
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

## Recusado em todas as fases (e por quê)

- Mascotes, logos, nomes e textos das referências: identidade própria.
- Balão da pessoa em laranja: laranja só na ação principal, símbolo e agente rodando.
- Campo de chat livre (Queue/Steer/Interrupt): seria funcionalidade nova no `claude -p`.
- Editor de fluxo em grafo: exige canvas fora da Astryx (CSP, acessibilidade).
