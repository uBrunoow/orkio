# Reestruturação da interface do Orkio (tarefa no centro + configuração guiada)

> Status: rascunho para aprovação · 23/11/2026
> Mockup aprovado: [`2026-11-23-orkio-ui-mockup.html`](./2026-11-23-orkio-ui-mockup.html) (abra no
> navegador; abas 1–7). Referências: "Alva Tasks" (artefato do usuário, fases da tarefa + painel à
> direita) e Compozy (quadro e agentes; `github.com/compozy/compozy`, prints `board.jpg` e
> `always-on.jpg` do README).

## 1. Por quê

O próprio autor do app se perdeu hoje tentando configurar o Orkio: Notion numa tela, GitHub em
outra, projeto em outra, quadro e automações em mais duas. O app cresceu por etapas (2C → 8B) e cada
etapa ganhou tela própria; o menu tem 9 itens e nenhuma tela diz "agora falta X". O pedido: telas
"mais tech", bem divididas e com menos coisa, no modelo do Alva Tasks (a tarefa é o centro, as fases
dela estão sempre visíveis, um painel muda conforme a fase) e com Quadro/Agentes no estilo Compozy.

## 2. Objetivos, não-objetivos e anti-objetivos

**Objetivos**

- Um caminho único do zero até a primeira tarefa rodando (**Primeiros passos**, 7 passos).
- Menu principal com 3 itens (Quadro, Agentes, Configurações) + a lista de tarefas do projeto
  agrupada por "o que fazer" (Esperando você · Rodando · A fazer).
- A **tarefa** como tela principal: fases no topo, conversa no meio, painel da fase à direita.
- Configurações reunindo Integrações, Projetos e, por projeto, "Quadro e automações" (abas Colunas,
  Automações, Fluxos, Entrega) e "Agentes do projeto".
- Quadro e Agentes com o visual do Compozy (mockup, abas 3 e 4).

**Não-objetivos (ficam para depois)**

- Agentes conversando entre si / colaboração multiagente. Isso é motor novo (main, IPC, SQLite);
  vem num projeto seguinte. Aqui só muda o **visual** da tela de Agentes.
- Mudar comportamento do main, IPC, config ou SQLite. Esta reestruturação é do renderer.
  Exceção permitida: leituras novas e somente-leitura no IPC se uma tela precisar de um dado que o
  renderer ainda não recebe (ver 6.4); nada que escreva. Também sai do main o uso do contexto do
  projeto no briefing (D5).
- Login no app, webhooks, tema claro.

**Anti-objetivos (falharia mesmo funcionando)**

- Trocar telas demais por telas demais com outro nome: se o menu voltar a passar de 3 itens ou uma
  função ficar em dois lugares, falhou.
- Perder uma função existente sem decidir (tudo que some está listado em 5).
- Relaxar a CSP, usar `<div>`/CSS de layout ou hex/px fora do tema (regras do `CLAUDE.md`).
- Quebrar o "esperando você" (contador no ícone do app, notificações, sino).

## 3. Restrições

- Tudo do `CLAUDE.md`: Astryx + tema Orkio (tokens), CSP estrita (sem `<style>` em runtime, evitar
  `CodeBlock`/`Chat`/gaveta do `AppShell`), ícones Tabler via `components/icons.tsx`, textos pt-BR,
  `StatusToken` para estado, `List`/`Item` para dados densos, nada de `<div>`/`<span>` cru.
- O mockup é HTML solto: a implementação o traduz para componentes Astryx; proximidade visual, não
  pixel a pixel. Densidade/cores mudam pelo tema (`astryx experimental theme editor set orkio …`),
  nunca por página.
- Renderer nunca envia caminhos; seletor de pasta continua no main (`selectionId`).
- `pnpm typecheck && pnpm lint && pnpm test && pnpm e2e` verdes no fim. Os E2E vão mudar muito
  (navegação); os fixtures (`enterApp`, `taskTab`, `expectTaskHistory`) são atualizados, não
  contornados.

## 4. Abordagens consideradas

| Abordagem | Troca | Decisão |
| --- | --- | --- |
| A. Em fases, uma PR por fase (moldura → tarefa → quadro/agentes → primeiros passos) | Sempre entregável; telas velhas convivem com a moldura nova por um tempo | Recomendada por mim, **não escolhida** |
| **B. Tudo de uma vez, uma branch** | Coerente do primeiro dia; PR grande, muitos E2E mudando juntos, mais demora até ver algo | **Escolhida pelo usuário** |
| C. UI nova ao lado da velha com chave | Comparar lado a lado; manutenção em dobro (telas, testes, atalhos) | Descartada |

Mitigação da B: a branch é única, mas o trabalho interno segue a ordem do plano (moldura → tarefa →
configurações → quadro/agentes → primeiros passos → E2E), com typecheck/lint/unit verdes a cada
etapa do plano; só a PR final é uma.

## 5. Arquitetura de informação (o que fica, o que sai, para onde vai)

| Hoje | Depois |
| --- | --- |
| Visão geral (6D) | **Sai do menu.** "Esperando você" e "Rodando" viram a lista lateral (do projeto atual) e o sino da barra superior (todos os projetos). `OverviewService` continua (alimenta lista, sino, badge do ícone). Semana/atividade deixam de ter tela. |
| Quadro | Fica (menu, Ctrl/Cmd+1). Visual Compozy. Clicar num card abre a **tela da tarefa**. Kanban/Lista mantidos. |
| Painel lateral da tarefa no Quadro + TaskPage | Viram **uma** tela da tarefa (seção 6.2). Sem painel lateral no Quadro. |
| Etapas e automações (3C) + Fluxos (5A) + Entrega (5C) | **Configurações › projeto › Quadro e automações**, abas Colunas · Automações · Fluxos · Entrega. |
| alva-flow (5B: pré-checagem e modelos) | Pré-checagem vira linhas de checagem em Projetos e Integrações; "Modelos do alva-flow" vira seção da aba Fluxos. |
| Contexto do Claude (4B) | **Sai.** (ver decisão D5) |
| Agentes (8A/8B) | Fica no menu (Ctrl/Cmd+2), visual Compozy. Regras por coluna (`assignOnEnter`) e orquestrador vão para **Configurações › projeto › Agentes do projeto**; a tela Agentes mostra perfis, estado, carga e um atalho "Orquestrador: ligado/desligado" que leva às configurações. |
| Projetos | **Configurações › Projetos**, com linha de checagens e "Continuar configuração". |
| Integrações | **Configurações › Integrações**: Notion (+ sublinha Bancos e campos), GitHub, Claude Code (+ sublinha Plugins e comandos), gh CLI (opcional). |
| Configurações (Atualizações, Sobre/diagnóstico) | Ficam em Configurações › App. |
| "Vamos começar" + login | Viram o começo dos **Primeiros passos**. A abertura animada continua. |

Menu (coluna da esquerda): logo · seletor de projeto · "Buscar tarefa ⌘K" · grupos Esperando você /
Rodando / A fazer · (rodapé) Quadro, Agentes, Configurações. Atalhos Ctrl/Cmd+1…3 nessa ordem.
Command Palette continua (tarefas, telas, trocar projeto).

## 6. Telas

### 6.1 Moldura

- Coluna esquerda larga (~248 px, como no mockup) — deixa de ser só ícones. Topo: logo, seletor de
  projeto (o mesmo da barra superior de hoje sobe para cá), "Buscar tarefa" abre a Command Palette
  já na busca de tarefas.
- **Lista de tarefas do projeto atual**: Esperando você (itens de `overview` do projeto: gate,
  pergunta, permissão, push, recusa do Notion…, mais antigo primeiro), Rodando (fluxos/execuções
  ativos), A fazer (tarefas da etapa-fila: `orchestrator.queueStageId` se houver, senão a primeira
  etapa; ordem por prioridade e depois antiguidade, até 8 + "Ver todas" → Quadro em Lista). Cada
  item: ponto de estado (`StatusToken` só ponto), ID em mono, título truncado.
- Barra superior da área de conteúdo: breadcrumb (projeto › tela/tarefa), à direita o sino com o
  total de "esperando você" de todos os projetos (abre um popover com a lista agrupada por projeto,
  que substitui a Visão geral).
- Abertura: setup incompleto → Primeiros passos; senão a primeira tarefa "Esperando você" do
  projeto atual; senão o Quadro.

### 6.2 Tarefa (tela principal)

- Barra: breadcrumb `projeto › ORK-142 · título`, branch em mono, **fases** e sino.
- **Fases**: se a tarefa tem fluxo (atual ou o ligado à etapa), os passos visíveis do `flowPlan`
  agrupados por comando/gate (`Spec ✓ → Plano ● → Implementar → Revisão → PR`); sem fluxo, as
  colunas do quadro com a atual marcada. Clicar numa fase rola a conversa até ela.
- **Conversa** (centro): o que hoje é `TaskSession` (eventos + execuções, `RunBlock`), com o nome e
  avatar do agente em cada bloco, gates/perguntas/permissões como cartões no fim, chips de resposta
  rápida e o `SessionComposer` (continua `--resume`).
- **Painel da fase** (direita, ~460 px), abas: Spec · Plano (Backlog.md, `BacklogDocumentView`, com
  a ação do gate da fase no rodapé: "Aprovar e implementar") · Mudanças (`DiffView`, artefatos) ·
  PR & CI (sinais 2D, entrega 5C, pedir review) · Detalhes (etapa, agente, bloqueada, branch,
  "Histórico completo", "Nova sessão…", limpar ambiente). A aba inicial segue a fase atual.
- Mantém os papéis/nomes acessíveis que os E2E usam (`list "Log da execução"`, "Linha do tempo do
  fluxo", "Esperando você").

### 6.3 Quadro

- Visual do mockup/Compozy: faixa de avatares dos agentes ativos acima; colunas com contador,
  status do Notion em cinza no cabeçalho e recolher; card de 3 linhas (ID + avatar + estado único
  `cardStatus` · título · linha cinza com o que importa: "Aprovar plano · passo 3/9", PR, CI, tempo).
- Arrasto, "Mover para…", Kanban/Lista, "Atualizar" e "Buscar tarefa" ficam. O Orkio não cria tarefas (D16).

### 6.4 Agentes

- Grade de cards (Cards/Linhas), busca `/`, pílulas Todos · Esperando você · Trabalhando · Parados
  com contagem, seções "Trabalhando agora" e "Disponíveis".
- Card: avatar geométrico grande (o `AgentAvatar` atual, maior), nome, descrição de uma linha,
  "o que está fazendo agora" com ponto de estado, **mini-histograma de atividade** (execuções por
  hora nas últimas ~12 h, de `agent_runs`), tarefas em que está (tag destacada = esperando você),
  vagas usadas/total e custo do dia.
- Se o histograma ou a contagem do dia não estiverem expostos ao renderer, criar uma leitura
  somente-leitura no IPC (agregado por `agent_key`), sem gravar nada.
- Clicar no card abre o editor de perfil que já existe (prévia do prompt, revisar/aprovar).

### 6.5 Configurações

Coluna interna: Geral (Integrações, Projetos) · Projeto · <nome> (Quadro e automações, Agentes do
projeto) · App (Atualizações, Sobre e diagnóstico).

- **Integrações**: uma `List` com logo, nome, uma linha do que o Orkio faz com ela, estado
  (`StatusToken`) e ação. Fluxos de conexão (OAuth, Device Flow, token) abrem inline na própria
  linha, reaproveitando `connection-ui.tsx`, `NotionConnectionCard`, `GitHubConnectionCard`. O
  assistente dos bancos abre a partir de "Revisar campos".
- **Projetos**: linha por projeto com caminho/repo/branch em mono e a linha de checagens (pasta e
  git, GitHub com push, página do Notion, quadro, alva-flow, gh) vindas de `projects`,
  `notionWorkspace`, `board` e `alva.precheck`. Faltando algo → "Continuar configuração" (abre os
  Primeiros passos só com os passos pendentes daquele projeto). "Adicionar projeto" = mesmo fluxo.
- **Quadro e automações**: abas Colunas (coluna ↔ status do Notion, fluxo ao entrar, contagem),
  Automações (regras como frase, liga/desliga, disparos da semana), Fluxos (editor da 5A + modelos
  do alva-flow), Entrega (exigir aprovação para push). "Simular…", "Restaurar padrão",
  exportar/importar e histórico ficam nesta tela. Um único `SaveBar` para a tela (mesmo
  `validateFlow`/"Salvar fluxo" de hoje).
- **Agentes do projeto**: regras de atribuição por coluna e o orquestrador (`OrchestratorSection`).

### 6.6 Primeiros passos

Tela cheia (sem menu), passos à esquerda com estado real, conteúdo do passo à direita, "Por que
isso?" em uma linha, "Voltar" e "Fazer depois":

1. Entrar com GitHub (Device Flow atual; "Usar token"; "Continuar sem GitHub").
2. Conectar o Notion (OAuth; "Usar token").
3. Claude Code (detecção/login; diz o comando a rodar se faltar).
4. Escolher a pasta do projeto (seletor no main; mostra repo detectado; confirmações de alias/GHE).
5. Onde ficam suas tarefas no Notion: bancos de Projetos/Tarefas, campos e a página deste projeto,
   **já sugeridos** (`suggestMapping` + ordem por semelhança); a pessoa só confere.
6. Montar o quadro: colunas do template com status sugeridos e as automações padrão ligadas;
   opcional "usar fluxos do alva-flow" se a pré-checagem passar.
7. Abrir a primeira tarefa (lista das tarefas da pessoa; abre a tela da tarefa).

Retomável: o passo atual é derivado do estado real (não guardado). "Fazer depois" leva ao app; o
que faltar aparece em Projetos/Integrações e como um aviso no topo da lista lateral ("Falta 2
passos · continuar").

## 7. Decisões tomadas

| # | Decisão | De quem |
| --- | --- | --- |
| D1 | Modelo de telas = mockup aprovado (abas 1–7) | Usuário |
| D2 | Abordagem B, tudo numa branch | Usuário |
| D3 | Agentes: só visual agora; colaboração multiagente é outro projeto | Usuário |
| D4 | Automações continuam, mas fora do menu (dentro de Quadro e automações) | Proposta aceita |
| D5 | Contexto do Claude sai por inteiro: a tela e a seção "Contexto do projeto" do briefing (`buildProjectContext`). O contexto vem só da tarefa do Notion. O campo `claudeContexts` da config fica sem uso (sem migração). | Usuário |
| D6 | Visão geral sai; o sino na barra superior a substitui (todos os projetos) | Proposta aceita |
| D7 | Tarefa abre em tela própria (sem painel lateral no Quadro) | Minha escolha, segue o mockup |
| D8 | Lista lateral = projeto atual; sino = todos os projetos | Minha escolha |
| D9 | Fases da tarefa = passos do fluxo; sem fluxo, colunas do quadro | Minha escolha |

| D10 | Primeiros passos abrem sozinhos só quando **não há projeto** (como hoje). Com projeto, o que faltar aparece como aviso no topo da lista lateral ("Falta N passos · continuar") e em Projetos. Nada novo é gravado. GitHub é opcional; o passo 7 não conta para "completo". "Completo" = passos 2–6 feitos para o projeto atual. | Minha escolha (revisão) |
| D11 | Da Visão geral: "PRs com atenção" vira seção do popover do sino; os cartões de projeto já estão em Configurações › Projetos. | Minha escolha (revisão) |
| D12 | Chips de resposta rápida são fixos por tipo de cartão: as ações do próprio gate/pergunta (mesmo efeito do botão) e "Pedir ajuste…", que só preenche o campo de mensagem. Nada gerado. | Minha escolha (revisão) |
| D13 | Agentes: a tela usa o projeto atual (a API `agents.list` é por projeto); agentes embutidos e "só neste computador" aparecem em todos. A atividade por hora soma todos os projetos (por `agent_key`). | Minha escolha (revisão; ajustada no plano) |
| D14 | Sem documento do Backlog.md, as abas Spec e Plano somem; aba inicial = a da fase, senão Mudanças (se houver diff), senão Detalhes. | Minha escolha (revisão) |
| D15 | Passo 6 só define colunas ↔ status e liga as regras padrão. "Etapa Orkio" e "Bloqueada" ficam em Configurações (continuam pedindo confirmação). | Minha escolha (revisão) |
| D16 | Sem "Nova tarefa": tarefas nascem no Notion. O botão do mockup vira "Buscar tarefa ⌘K". | Usuário |

## 8. Fica com quem implementa

- Componentes Astryx exatos para cada peça (ler com `pnpm exec astryx component <Nome>`), desde que
  respeitem a CSP; ajustes de densidade pelo tema.
- Divisão de arquivos/novas rotas em `routes.ts` (rotas antigas podem virar redirecionamentos
  internos para a Command Palette e notificações de desktop que ainda apontem para elas).
- Atualização do `CLAUDE.md` (seção "Interface", menu, atalhos) e de `docs/ui-redesign.md`.
- Prints antes/depois em `docs/ui-redesign/reestruturacao/`.
