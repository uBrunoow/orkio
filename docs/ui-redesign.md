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
| 3. Quadro                 | Card de três linhas, colunas com contador e recolher, avatares de agentes                                                     | feita              |
| 4. Agentes                | Grade de cards, filtros em pílulas, Linhas/Cards, busca `/`                                                                   | feita              |
| 5. Tarefa como conversa   | Linha do tempo de mensagens, cartões de decisão                                                                               | feita              |
| 6. Detalhes em frase      | Regras e Fluxos: título-frase, "Começa / Faz", execuções, detalhes                                                            | feita              |
| 7. Integrações e catálogo | Grade de linhas com logo, categoria e ação                                                                                    | feita (aguarda ok) |

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

## Fase 4

**Agentes**

- Avatar novo (`features/agents/AgentAvatar.tsx`): quadrado arredondado com uma forma geométrica
  (círculo, quadrado, triângulo, losango, meia-lua, anel, par de quadrados, cunha), rotação e um
  ponto de canto, tudo derivado de um hash estável do id do agente; cores do tema para a cor do
  perfil (`--color-background-*` e `--color-icon-*`). SVG, sem iniciais; o nome fica no
  `aria-label` ("Agente: Ana"). Substitui o `Token` de iniciais no card, na lista e na faixa do
  quadro, no painel da tarefa e na tela de Agentes (`card-agent` mantido; o E2E confere o
  `aria-label` em vez do texto "AN").
- Tela de Agentes: grade de cards (avatar, nome, papel, estado; tarefas, execuções de hoje e
  fluxo preferido; "Editar" e o menu "Ações de…" com Duplicar/Arquivar), alternância
  Cards/Linhas, filtros por estado com contagem (Todos, Prontos, Revisar, Com erro, Arquivados;
  "Todos" esconde os arquivados) e busca por nome ou papel com atalho `/`.
- Revisão do perfil continua dentro do card/linha ("Revisar Ana", prévia, "Aprovar este perfil").

**Recusado / adiado**

- Cor laranja no perfil: continua escolhível (dado existente); o laranja do avatar é a cor que a
  pessoa escolheu, não um estado.
- Ordenar ou agrupar agentes por uso: sem dado de ordenação no renderer além do que já vem.

## Fase 5

**Tarefa como conversa** (painel e página da tarefa)

- "Histórico" vira "Linha do tempo" em forma de conversa (`board/TaskTimeline.tsx`): do mais antigo
  ao mais novo, cada evento com quem falou (agente com o avatar dele, Claude Code, Fluxo, Notion,
  GitHub, Automação ou Você), a frase de sempre (`describeEvent`) e o horário (`Timestamp`, relativo
  quando recente). Mesmo autor em sequência mostra o nome só uma vez. Sem balões e sem laranja. A
  lista mantém o nome "Histórico da tarefa".
- Na página da tarefa a conversa sobe para a coluna principal (trabalho + conversa); dados e
  controles ficam à direita.
- "Esperando você" no topo soma os pedidos do Claude Code e as decisões do fluxo (gate, escolha,
  saída da etapa); "Ver pedido" rola até a decisão certa.
- Resumo dos passos recolhível (`Collapsible`): "3 passos · 1 ok · 1 aprovado · 1 recusado".
  Recolhido enquanto o fluxo roda ou espera você (a decisão vem primeiro), aberto no fim ou na
  pausa; clicar no resumo troca.
- Rodapé "Trabalhando há…" (`data-testid="task-working"`): ponto laranja (rodando), quem
  (agente, "Fluxo" ou "Claude Code"), `Timer` desde o início do passo e o passo atual. Fixo abaixo da
  rolagem do painel.
- Cartões de decisão (gate, confirmação de ação, escolha, pergunta do Claude) continuam os
  mesmos; o cartão de confirmação ganhou `key` por confirmação (push → pedir review não herda mais
  as escolhas da anterior, o que deixava o E2E do alva instável).
- "Recusado" deixou de aparecer com ponto verde.
- E2E: `task-flows.spec` confere o rodapé; `automation.spec` compara o histórico evento a evento
  sem o horário relativo (que muda entre as leituras).

**Recusado / adiado**

- Campo de mensagem livre na conversa: seria funcionalidade nova no `claude -p` (recusado no plano).
- Juntar o log ao vivo do Claude Code na mesma conversa: o log tem outra fonte (`onRunEvent`) e
  outro ritmo; fica na seção Claude Code, logo acima.

## Fase 6

**Detalhes em frase** (Etapas e automações; Fluxos)

- `components/SentenceDetail.tsx`: a frase como título (`detail-sentence`), "Começa", "Faz",
  "Execuções" (tabela Quando · Tarefa · Resultado) e uma coluna de detalhes à direita
  (`detail-column`). "Editar" abre o editor de sempre.
- Automações: clicar numa automação (na etapa ou em Notificações) mostra a frase do
  `describeRule`, as condições, o que faz, as execuções e os detalhes (estado, nome, evento, ordem,
  última execução); "Ativar/Desativar" ao lado de "Editar". "Voltar para a etapa" volta ao editor
  da etapa. O menu "Ações da automação" continua igual.
- Fluxos: escolher um fluxo mostra "Quando a tarefa entra em Revisando: /revisar, aprovação,
  salto, /revisar e …", uma frase por passo, as execuções e os detalhes (passos, colunas,
  comandos, id). "Novo fluxo" abre direto no editor; o editor ganhou "Ver em frase".
- Execuções sem dado novo (`components/executions.ts`, com teste): vêm da atividade do projeto
  (`overview.activity`, a mesma da Visão geral). Automação: eventos que citam `regra “Nome”`.
  Fluxo: cada "Fluxo iniciado: Nome" com o primeiro fim seguinte da mesma tarefa.
- `EVENT_PHRASES` de `shared/flow` passou a ser exportado (texto puro, para o "Começa").
- E2E: `automation.spec` abre a automação "Merge finaliza a tarefa" e confere frase, "Faz",
  execução (ORK-2, "Moveu a tarefa") e "Editar"; `task-flows.spec` confere a frase do fluxo, os
  passos e a execução "Concluído".

**Recusado / adiado**

- Execuções completas e por id da regra: a atividade guarda o nome, não o id; renomear a regra
  separa o histórico antigo. Um filtro por id exigiria consulta nova no main.
- Editor de fluxo em grafo: recusado no plano.

## Fase 7

**Integrações como catálogo**

- No topo de Integrações, "Catálogo de integrações": grade de duas colunas (`Grid` com largura
  mínima; vira uma coluna quando não cabe), uma linha por integração com logo, nome, categoria
  (Planejamento, Código, Execução), uma frase, o estado (`StatusToken`: "Conectado como …", "Não
  conectado", "Falta escolher os bancos", "Pronto, 2.1.9"…) e a ação ("Conectar", "Configurar" ou
  "Gerenciar").
- A ação rola até o card de configuração da integração, que continua inteiro em "Configuração"
  (fluxo de conexão, token, desconectar, bancos do Notion), e põe o foco no primeiro controle.
- O destaque "Conecte suas ferramentas" (sem nada conectado) ficou menor.
- Estado do Claude Code lido com `claude.status()` (o mesmo do card); bancos do Notion só contam
  como prontos com o Notion conectado, bancos escolhidos e verificação ok.
- E2E: `github.spec` confere a linha do GitHub antes (categoria, "Não conectado", "Conectar" leva o
  foco ao card) e depois da conexão ("Conectado como octocat", "Gerenciar").

**Recusado / adiado**

- Integrações que não existem (Slack, Linear…) como "em breve": seria prometer o que o app não
  faz.
- Esconder os cards e abrir só o escolhido: os cards são o fluxo de conexão; todos visíveis
  continuam mais rápidos de escanear e os testes de conexão não mudam.

## Extra: tela "Vamos começar"

- Sai a lista "01/02/03" de ferramentas e o rótulo "// desktop" em caixa alta; entra o checklist
  "Preparar o Orkio" com o estado real de Notion, GitHub e Claude Code (mesmas chamadas de
  Integrações: `notion.getStatus`, `github.getStatus`, `claude.status`) e do projeto, cada um com
  `StatusToken` e a ação que falta ("Conectar o Notion", "Adicionar projeto"…), mais "N de 4
  prontos". Título e "Começar" à esquerda; a abertura animada continua igual.
- "Conectar ferramentas" saiu: cada linha do checklist já leva à ação certa.

## Extra: login com GitHub

- Sem GitHub conectado, a entrada do app (depois da abertura) é "Entrar no Orkio": card central
  sobre a grade, símbolo, uma frase e "Entrar com GitHub" (referência visual: tela de login com
  card único e ações secundárias abaixo de "ou"). O login é o Device Flow que Integrações já usa
  (`github.startDeviceFlow`/`waitDeviceFlow`, token cifrado no main): entrar já conecta a
  integração. Depois vem o checklist, com o GitHub pronto, pedindo Notion e projeto.
- "Usar um token" leva a Integrações; "Continuar sem GitHub" vai ao checklist (o app continua
  usável sem GitHub). Build sem o client ID do GitHub: o botão some e a tela explica.
- Não é conta do Orkio: não há servidor nem sessão própria; "sair" é desconectar o GitHub em
  Integrações.
- E2E: `login.spec.ts` (código, abrir o GitHub, autorizar, checklist); o `enterApp` das fixtures
  passa por "Continuar sem GitHub".

## Recusado em todas as fases (e por quê)

- Mascotes, logos, nomes e textos das referências: identidade própria.
- Balão da pessoa em laranja: laranja só na ação principal, símbolo e agente rodando.
- Campo de chat livre (Queue/Steer/Interrupt): seria funcionalidade nova no `claude -p`.
- Editor de fluxo em grafo: exige canvas fora da Astryx (CSP, acessibilidade).
