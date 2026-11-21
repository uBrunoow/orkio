# Etapa 6E — Reorganização das telas (Fase 1: diagnóstico)

> Status: **proposta, aguardando aprovação.** Nenhum código do app foi alterado nesta fase.
> Prints de antes: `docs/ui-reorg/antes/` (build `--mode e2e`, Notion/GitHub/Claude simulados,
> janela 1280×800, salvo onde indicado). Rascunhos que acompanham este documento:
> [`docs/ui-reorg/orkio-design.SKILL.draft.md`](ui-reorg/orkio-design.SKILL.draft.md) (linguagem de
> design, para virar `.claude/skills/orkio-design` depois do seu OK) e
> [`.interface-design/system.md`](../.interface-design/system.md).

## 0. Como este diagnóstico foi feito (e o que falta)

- **As skills não estavam disponíveis.** O repositório não tem `.claude/skills/` e a sessão não
  enxerga a pasta do Orkio no seu computador. Não instalei nada. Apliquei à mão os mesmos critérios
  (crítica/auditoria por severidade do impeccable, intenção/superfícies/densidade do
  interface-design, escala/medida/truncamento do better-typography e as regras de UX de produto do
  ui-ux-pro-max). Quando as skills estiverem em `.claude/skills/` (instaladas sem `-g` e commitadas),
  refaço a auditoria com elas e marco aqui o que mudou.
- **Prints:** 23 telas e estados, capturados com o Playwright do E2E (`e2e/fixtures.ts`), sem
  nenhum gancho novo no app.
- **Visão geral (6D):** ainda não existe na `main`; está sendo construída em outra thread. Ela entra
  na arquitetura abaixo e na lista de telas a auditar quando chegar (critérios na seção 3.12).
- **Regra de desempate:** o CLAUDE.md vence as skills. Conflitos conhecidos na seção 6.

## 1. Resumo

O Orkio cresceu por etapas (2C → 5C) e cada etapa pendurou sua tela num botão da barra do Quadro.
O resultado é um app com **três itens no menu e oito telas escondidas**, um painel de tarefa de
~280 px que carrega o trabalho mais importante (execução, permissões, perguntas, gates, artefatos,
histórico) e uma navegação que às vezes não volta. Visualmente a base é boa (tema Orkio coerente,
laranja contido, Inter/mono corretos); os problemas são de **estrutura, hierarquia e densidade**,
não de paleta.

As cinco mudanças que mais rendem:

1. **Projeto atual na barra lateral** e as telas por projeto (Quadro, Etapas e automações, Fluxos,
   Contexto do Claude) como itens de menu, não botões escondidos. Corrige o bug de navegação (G1).
2. **Tarefa em tela cheia** (briefing, Claude Code, fluxo, PR/CI, artefatos, histórico em abas). O
   painel lateral vira uma prévia com rolagem própria e "Abrir tarefa".
3. **"Esperando você" sempre no topo**: permissões, perguntas e gates saem do meio do log e viram
   uma faixa de ação no topo da tarefa, no painel e na Visão geral (6D).
4. **Log de execução denso**: horário em mono, ícone por tipo, linhas de 1 altura, sem pontos
   brancos nem linhas de depuração.
5. **Command Palette (Ctrl/Cmd+K)** e atalhos, com estados vazio/carregando/erro compartilhados.

## 2. Problemas globais

Severidade: **P0** quebra uma tarefa ou engana · **P1** atrapalha o uso diário · **P2** atrito
ou inconsistência visível · **P3** polimento.

| #   | Sev. | Problema                                                                                                                                                                                              | Evidência                                                      |
| --- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| G1  | P0   | Clicar "Quadro" no menu **não sai** de Contexto/Fluxo do projeto/Fluxos de tarefa/alva-flow: o `mode` vive dentro do `BoardPage`, que não remonta. O usuário fica preso até achar "Voltar ao quadro". | `18-contexto-do-claude.png` (tirado _depois_ de clicar Quadro) |
| G2  | P1   | Não existe "projeto atual" na navegação. Tudo que é por projeto está atrás de 5 botões no topo do Quadro; o menu tem só Projetos/Quadro/Integrações.                                                  | `09-quadro.png`                                                |
| G3  | P1   | Título duplo: "Quadro" (h1) + "Contexto do Claude Code"/"Fluxo do projeto"/"alva-flow" logo abaixo. Duas âncoras competindo; o h1 não diz onde a pessoa está.                                         | `15`, `16`, `18`, `19`                                         |
| G4  | P1   | Página inteira rola junto com o painel da tarefa: ao descer até a permissão ou o log, o quadro some e sobra uma área vazia à esquerda.                                                                | `12`, `13`, `14`                                               |
| G5  | P2   | Estados vazio/carregando/erro feitos à mão em cada tela: 7 `EmptyState`, 33 `Skeleton` com alturas soltas (32, 40, 120, 240), "Nenhuma tarefa" em negrito grande dentro da coluna.                    | código + `09`                                                  |
| G6  | P2   | Hierarquia de botões achatada: barras com 5–7 botões fantasma de mesmo peso; ações destrutivas ("Remover", "Desconectar") preenchidas em vermelho ao lado da primária.                                | `07`, `05`, `15`                                               |
| G7  | P2   | Cor de status sem regra: prioridade "Alta" usa o vermelho de erro; "Falta configurar" usa vermelho para algo que é aviso; "Notion: Em andamento" azul.                                                | `09`, `19`                                                     |
| G8  | P2   | Rótulos visíveis com sufixo técnico ("Nome da etapa 1", "Tempo limite em minutos (passo 1)"). O sufixo é para leitor de tela; na tela vira ruído e cansa a leitura.                                   | `08`, `15`, `17`                                               |
| G9  | P2   | Medida de linha longa: textos de ajuda com ~150 caracteres por linha (Integrações, Entrega, alva-flow). Ideal 60–80.                                                                                  | `04`, `16`, `19`                                               |
| G10 | P2   | Plurais "(s)": "1 mudança(s) não commitada(s)", "1 erro(s)", "0 tarefa(s)".                                                                                                                           | `12`, `15`, `17`                                               |
| G11 | P2   | Datas absolutas em todo lugar ("21/11/2026, 00:22"). Para atividade recente, relativo ("há 3 min") com a data completa no tooltip (`Timestamp` da Astryx).                                            | `10`, `15b`                                                    |
| G12 | P1   | Janela de 1000 px (notebook 13"): a barra do quadro quebra em 3 linhas e o painel cobre metade das colunas.                                                                                           | `20`, `21`                                                     |
| G13 | P1   | O app sempre abre em "Vamos começar", mesmo configurado: um clique a mais todo dia.                                                                                                                   | `01`                                                           |

## 3. Auditoria por tela

### 3.1 Tela inicial (`01-inicio.png`)

Bem resolvida e fiel à marca (Jost no display, slogan, grade, laranja só no CTA).

- P1 — Aparece sempre (G13). Proposta: só quando nada está configurado; depois disso o app abre na
  Visão geral (decisão da 6D, aqui só reforço).
- P3 — "Conectar ferramentas" tem o mesmo peso tipográfico do texto; vale `Button variant="ghost"`
  com ícone para ler como ação.

### 3.2 Integrações (`04`, `05`, `06`)

- P1 — "Bancos do Notion" diz **"Conecte o Notion em Integrações"** e "Não verificado" com o Notion
  conectado no card de cima, na mesma tela, mesmo depois de recarregar. Pode ser efeito da conexão
  feita por `window.orkio.notion.connect` no teste, mas a mensagem manda a pessoa para a tela onde
  ela já está. A confirmar na Fase 2; no mínimo o texto não deve apontar para a própria tela.
- P2 — Mapeamento listado como pares empilhados ("Projetos / Projetos", "Título / Nome"): 7 linhas
  de 56 px para informação de uma tabela de 2 colunas. Proposta: `MetadataList`/`Table` compacta.
- P2 — "Desconectar" preenchido em vermelho ao lado de "Testar conexão" (G6). Proposta: botão
  secundário; o vermelho só na confirmação inline.
- P2 — Bancos do Notion é configuração do Notion, mas vive como um quarto card solto no fim da
  página. Proposta: dentro do grupo Notion (conexão → bancos → mapeamento), como passos.
- P3 — Herói "Conecte suas ferramentas" bom quando tudo está desconectado; some ao conectar (ok).

### 3.3 Projetos (`02`, `07`)

- P2 — Um projeto ocupa uma faixa curta à esquerda e as ações ficam no canto oposto (≈700 px de
  distância). Com vários projetos vira uma lista difícil de escanear.
- P2 — "Remover" vermelho preenchido sempre visível (G6). Proposta: menu "Mais" por linha.
- P2 — Caminho local em mono sobre fundo elevado compete com o nome do projeto.
- Proposta: `List`/`Item` densa — nome + repo + branch (mono) + projeto do Notion + saúde (Token) —
  e ações no `MoreMenu`. "Ver tarefas" deixa de ser lista inline e leva ao Quadro do projeto.

### 3.4 Quadro (`08`, `09`, `20`)

- P1 — Barra de ferramentas com 7 controles em 2 linhas (3 em 1000 px): busca, prioridade,
  "Só bloqueadas", Atualizar, Pausar todas, alva-flow, Contexto do Claude, Fluxo do projeto. Os três
  últimos são **navegação**, não filtros.
- P1 — Colunas com altura fixa (~310 px) e metade da janela vazia embaixo; barra de rolagem
  horizontal visível mesmo com espaço. Colunas devem ocupar a altura útil, com rolagem própria.
- P2 — Checkbox "Só bloqueadas" desalinhado da linha de base dos campos ao lado.
- P2 — "Notion: <status>" repetido sob o nome de cada coluna: informação de configuração ocupando
  a área de trabalho. Proposta: tooltip no nome da coluna.
- P2 — Coluna vazia "Nenhuma tarefa" em negrito centralizado: mais alto que os cards. Proposta:
  texto secundário pequeno.
- P2 — Prioridade "Alta" no vermelho de erro (G7).
- P3 — Linha "Automações: aguardando a primeira verificação" boa, mas solta; vira parte do cabeçalho
  (status + "Pausar todas").

### 3.5 Painel da tarefa (`10`, `11`, `21`)

- P0 — O que espera a pessoa (permissão, pergunta, gate) aparece **no meio do painel**, abaixo do
  formulário e acima do log, fora da tela na maioria dos casos (`12`, `13`).
- P1 — ~280 px de largura para briefing, prompt, log, diff, artefatos e histórico. O formulário de
  "Rodar Claude Code" (briefing editável) não cabe ali (`11`).
- P1 — Rolagem da página inteira em vez de rolagem do painel (G4).
- P2 — Ordem: controles (mover, bloqueada, pausar) → Claude Code → Histórico. Sinais da 2D (branch,
  PR, CI) não aparecem no topo do painel; é o que mais se consulta.
- P2 — "Mover para" duplica o menu do card; ok por teclado, mas pode ir para o cabeçalho como
  `Selector` compacto.
- P3 — Título quebra em 2 linhas a 1280 px; ID em `Code` sobre fundo elevado de largura total.

### 3.6 Execução do Claude Code (`11`, `14`)

- P1 — Log com linhas de ~38 px, sem horário, sem ícone por tipo; estados como pontos brancos ("●
  Na fila", "● Rodando", "● Concluída"); linhas de depuração ("shell: allow"). Difícil achar o que
  importa numa execução longa.
- P2 — Branch do ambiente quebra no meio ("ORK-2/listar-tarefas-do-" / "notion") dentro do bloco de
  código. Truncar com reticências no meio e tooltip, ou deixar rolar.
- P2 — "Abrir no Cursor", "Abrir no VS Code", "Ver diff" empilhados, um por linha. Proposta: grupo
  de botões numa linha / menu "Abrir em…".
- P2 — Resumo ("1 arquivo(s) alterado(s), 1 commit(s)…") em frase corrida; melhor como 3 números.
- P3 — Custo "US$ 0.01 (estimado)" usa ponto decimal; em pt-BR, "US$ 0,01".

### 3.7 Pedido de permissão (`12`)

- P2 — Três botões empilhados em largura variável; "Sempre neste projeto: npm test" repete o
  comando. Proposta: linha com primária "Permitir uma vez", secundária "Sempre neste projeto",
  destrutiva leve "Negar"; o comando aparece uma vez em mono.
- P2 — Sem contexto de tempo: a negação automática em 10 min não é mostrada. Proposta: "Nega
  sozinho em 9 min" (`Timer`).

### 3.8 Pergunta do Claude (`13`)

- P2 — "Responder" desabilitado vira laranja apagado, que lê como marca e não como "indisponível".
  Proposta: deixar o estado desabilitado padrão do tema (cinza) — ajuste no tema, não na tela.
- P3 — Pergunta em texto secundário pequeno; deveria ser o elemento mais forte do cartão.

### 3.9 Fluxo do projeto (`15`, `15b`)

- P1 — Cabeçalho com 7 botões (Restaurar padrão, Exportar JSON, Importar JSON, Etapa Orkio e
  Bloqueada…, Fluxos de tarefa…, Descartar alterações, Voltar ao quadro). Proposta: primária
  "Salvar fluxo" fixa, "Descartar" secundária, o resto num menu "Mais".
- P1 — "Salvar fluxo" fica no fim da página, depois de Notificações e Testar automação; com
  rascunho sujo não há indicação visível no topo. Proposta: barra de salvar fixa ("3 alterações não
  salvas · Descartar · Salvar fluxo").
- P2 — Cada etapa é um formulário completo dentro de uma coluna estreita em rolagem horizontal.
  As automações aparecem truncadas ("Quando uma branch da tarefa…"), escondendo justamente o
  gatilho. Proposta: lista de etapas à esquerda + editor da etapa à direita; automações como frases
  inteiras em linhas.
- P2 — "Alterações do fluxo" mostra o usuário do sistema ("root"); ok, mas fica melhor como
  histórico recolhível.

### 3.10 Fluxos de tarefa (`16`, `17`, `17b`)

- P2 — O ajuste "Exigir minha aprovação para push" (Entrega) abre a tela, antes da lista de fluxos,
  e não tem relação com o fluxo em edição. Proposta: seção "Entrega" nas configurações do projeto.
- P2 — Todos os campos de todos os passos abertos ao mesmo tempo: dois passos já ocupam 2 telas.
  Proposta: passos como linha do tempo compacta (número, tipo, resumo, problemas) com editor do
  passo selecionado ao lado.
- P2 — "Tipo do novo passo" + "Adicionar passo" no fim; com muitos passos fica longe. Proposta:
  "+" entre passos e no topo.
- P3 — "1 erro(s)" em vermelho na lista; ok semântico, plural (G10).

### 3.11 Contexto do Claude (`18`) e alva-flow (`19`, `19b`)

- P2 — Título duplo (G3) e bug de navegação (G1).
- P2 — alva-flow: comandos de correção (`backlog init`, `claude mcp add …`) alinhados à direita,
  longe do item (≈600 px de travessia). Proposta: comando abaixo do item, com botão Copiar.
- P2 — "Falta" em vermelho para itens de configuração (G7): é aviso, não erro.
- P3 — Contexto: contador "0/8.000" bom; seção de páginas com recuo diferente do campo de cima.

### 3.12 Visão geral (6D, em construção em outra thread)

Critérios que vou aplicar quando ela chegar à `main`: (1) "Esperando você" acima da dobra a
1000×700; (2) cada item com ID mono + título + projeto + há quanto tempo + uma ação; (3) mesmos
componentes `WaitingItem`/`TaskRef`/`SignalChips` desta proposta; (4) estados vazio ("Nada
esperando você") e sem rede iguais às outras telas; (5) números da "Semana" com `tabular-nums`.

## 4. Nova arquitetura de informação

### 4.1 Menu lateral

```
┌──────────────────────────┐
│ ◇ ORKIO                  │
│                          │
│ ⌂  Visão geral      [3]  │  ← contador "Esperando você" (Badge = contagem)
│ ▶  Execuções             │  ← nova: todas as execuções e fluxos
│                          │
│ PROJETO                  │
│ [ orkio-app         ▾ ]  │  ← seletor do projeto atual (lembrado)
│ ▦  Quadro                │
│ ⚡ Etapas e automações    │  ← hoje "Fluxo do projeto" (3C)
│ ⇉  Fluxos                │  ← hoje "Fluxos de tarefa" (5A) + alva-flow como aba
│ ✳  Contexto do Claude    │
│                          │
│ ─────────────            │
│ ▤  Projetos              │
│ ⚙  Integrações           │
│ ⚙  Configurações         │  ← criada pela 6C (Atualizações, Sobre)
│                          │
│ Ctrl K  Buscar…          │  ← abre a Command Palette
└──────────────────────────┘
```

- **Nomes:** "Fluxo do projeto" e "Fluxos de tarefa" confundem (o próprio CLAUDE.md precisa
  explicar). Proposta: **Etapas e automações** (o que a tela edita) e **Fluxos** (sequências de
  passos). alva-flow vira uma aba de Fluxos ("Modelos Alva"), porque é pré-checagem + criação de
  fluxos. _Decisão sua: renomear ou manter os nomes atuais._
- **Entrega** ("Exigir aprovação para push") vai para Etapas e automações → seção "Entrega" (é
  regra do projeto, não de um fluxo).
- **Projetos** fica como tela de gerenciamento (adicionar pasta, vínculo com o Notion, saúde). A
  escolha do projeto do dia a dia é o seletor do menu.
- **Bancos do Notion** fica dentro de Integrações → Notion.
- Visão geral e Configurações são das threads 6D e 6C; aqui só a posição e os nomes.

### 4.2 Rotas (sem dependência nova)

Estado de rota tipado no renderer, com pilha para "Voltar" (`Alt+←`/`Cmd+[`):

```ts
type Route =
  | { name: 'overview' }
  | { name: 'runs'; filter?: RunFilter }
  | { name: 'board'; projectId: string; taskId?: string } // taskId = painel aberto
  | { name: 'task'; projectId: string; taskId: string; tab: TaskTab } // tela cheia
  | { name: 'automations' | 'flows' | 'context'; projectId: string }
  | { name: 'projects' | 'integrations' | 'settings' }
```

Isso resolve G1 (cada item do menu é uma rota, não um `mode` interno) e prepara deep links
(`orkio://tarefa/ORK-142`, backlog). `board:open-task` passa a navegar para `board` com `taskId`.

### 4.3 Wireframes

**Quadro (projeto atual)**

```
Quadro · orkio-app                          ⟳ Atualizado há 1 min   ⚡ Automações ativas ▾
[🔍 Buscar ID ou título]  [Prioridade ▾]  [Bloqueadas ○]                       [⋯]
┌ Prioridades  0 ┐┌ Em andamento 1 ┐┌ Revisando 0 ┐┌ Revisado 0 ┐┌ Finalizada 0 ┐
│                ││ ORK-2       ⋯ ││              ││             ││               │
│  Nenhuma       ││ Listar tarefas││              ││             ││               │
│  tarefa        ││ do Notion     ││              ││             ││               │
│                ││ ⎇ ORK-2/… #12 ││              ││             ││               │
│                ││ ● Esperando   ││              ││             ││               │
│   (coluna ocupa a altura útil; rolagem própria; "Notion: X" no tooltip do nome)      │
└────────────────┘└───────────────┘└──────────────┘└─────────────┘└───────────────┘
```

**Painel da tarefa (prévia, rolagem própria, largura ~400 px)**

```
ORK-2  Listar tarefas do Notion                         ⤢ Abrir tarefa   ✕
[Em andamento ▾]  Alta  ⎇ ORK-2/listar-…  PR #12 · alterações pedidas · CI ✕
┌ Esperando você ───────────────────────────────────────────────────────┐
│ Claude Code quer rodar  npm test        nega sozinho em 9 min          │
│ [Permitir uma vez]  [Sempre neste projeto]  [Negar]                    │
└────────────────────────────────────────────────────────────────────────┘
Claude Code   ● Rodando · 2 min · US$ 0,01          [Ver log]  [Cancelar]
Fluxo         Alva: implementar e entregar · passo 3/9 /review
Histórico     há 2 min  Claude Code iniciou uma execução
              há 5 min  Entrou no quadro em Em andamento          [Ver tudo]
```

**Tarefa em tela cheia**

```
‹ Quadro / orkio-app / ORK-2
ORK-2  Listar tarefas do Notion            [Em andamento ▾] [Bloqueada] [Pausar autom.] [↗ Notion]
⎇ ORK-2/listar-tarefas-do-notion · PR #12 alterações pedidas · 2 comentários · CI ✕
┌ Esperando você (fixo no topo quando houver) ───────────────────────────────────────┐
└────────────────────────────────────────────────────────────────────────────────────┘
[ Resumo | Claude Code | Fluxo | Artefatos | Histórico ]
Claude Code:
┌ Nova execução ───────────────┐ ┌ Execução de hoje 00:22 · Concluída · US$ 0,01 ──────┐
│ (Prompt livre | Comando)     │ │ 00:22:01  ▶ Sessão iniciada                          │
│ [o que fazer…]               │ │ 00:22:03  📄 Write  src/exportar.ts                  │
│ Briefing ▸ (editável)        │ │ 00:22:04  ⏸ Aprovação: npm test → permitido          │
│ [Rodar]                      │ │ 00:22:09  ? Qual separador? → Vírgula                │
│ Execuções anteriores         │ │ 00:22:12  ✓ Concluída em 5 turnos                    │
│  ● hoje 00:22  Concluída     │ │ Resumo  1 arquivo · 1 commit · testes: npm test      │
│  ● ontem       Falhou        │ │ [Ver diff] [Abrir em ▾] [Rodar de novo]              │
└──────────────────────────────┘ └──────────────────────────────────────────────────────┘
```

**Etapas e automações**

```
Etapas e automações · orkio-app                           [⋯ Restaurar/Exportar/Importar]
┌ Etapas ──────────┐ ┌ Em andamento ─────────────────────────────────────────────────┐
│ ● Prioridades    │ │ Nome [Em andamento]  Status no Notion [Em andamento ▾] Cor [●]│
│ ● Em andamento ◂ │ │ Fluxo desta coluna [Nenhum ▾]  ○ Ao entrar ○ À mão           │
│ ● Revisando      │ │ Automações que trazem para cá                                 │
│ ● Revisado       │ │  1º Quando uma branch da tarefa é criada → Em andamento  Ativa⋯│
│ ● Finalizada     │ │  8º Quando a PR é fechada sem merge → Em andamento       Ativa⋯│
│ + Adicionar      │ │ [+ Nova automação]                                            │
└──────────────────┘ └───────────────────────────────────────────────────────────────┘
Notificações · Entrega · Testar automação · Histórico   (seções recolhíveis)
━━ 3 alterações não salvas ·························· [Descartar] [Salvar] ━━  (barra fixa)
```

**Fluxos**

```
Fluxos · orkio-app                        [ Fluxos | Modelos Alva ]          [+ Novo fluxo]
┌ Fluxos ─────────────────┐ ┌ Revisar e entregar ─────────────────────────── 1 problema ┐
│ Revisar e entregar  ⚠1  │ │ 1  ▶ /revisar {{task_id}}            30 min            ✕  │
│ Alva: planejar          │ │ 2  ⏸ Aprovação "Pode seguir?" · diff · recusar→fim        │
│                         │ │ 3  ⤳ se 1 falhou → 5                                      │
│                         │ │ +                                                         │
│                         │ │ ── Passo 1 (editando) ────────────────────────────────────│
│                         │ │ Comando [/revisar ▾]  Argumentos [...]  Tempo [30]  ...  │
└─────────────────────────┘ └──────────────────────────────────────────────────────────┘
```

**Projetos**

```
Projetos                                                              [+ Adicionar projeto]
NOME        REPOSITÓRIO        BRANCH   NOTION           SAÚDE
orkio-app   acme/orkio-app     main     Orkio Desktop    OK        [Abrir quadro] [⋯]
site        acme/orkio-site    develop  —                Sem vínculo [Vincular]   [⋯]
```

**Command Palette (Ctrl/Cmd+K)**

```
┌──────────────────────────────────────────────────────────┐
│ 🔍 ORK-14|                                                │
│ TAREFAS                                                  │
│   ORK-142  Exportar CSV            orkio-app · Revisando  │
│   ORK-14   Mapear banco            orkio-app · Finalizada │
│ AÇÕES                                                    │
│   Rodar fluxo em ORK-142                                  │
│   Atualizar quadro                                       │
│ IR PARA                                                  │
│   Visão geral  Ctrl 1 · Quadro  Ctrl 2 · Execuções Ctrl 3 │
└──────────────────────────────────────────────────────────┘
```

Tarefas vêm do cache em memória de todos os projetos vinculados (nada de rede ao abrir a
paleta). Usa o `CommandPalette` da Astryx, que monta um `Dialog`: pelo CLAUDE.md, diálogos
precisam ser confirmados no E2E (CSP) antes; é o primeiro passo dessa entrega.

### 4.4 Atalhos

| Atalho             | Ação                                                        |
| ------------------ | ----------------------------------------------------------- |
| Ctrl/Cmd+K         | Command Palette                                             |
| Ctrl/Cmd+1…5       | Visão geral, Quadro, Execuções, Etapas e automações, Fluxos |
| Ctrl/Cmd+[ / Alt+← | Voltar                                                      |
| Esc                | Fecha o painel / a paleta                                   |
| J / K, ← / →       | Próximo/anterior card; coluna ao lado (no Quadro)           |
| Enter / Ctrl+Enter | Abre o painel / a tarefa em tela cheia                      |
| M                  | "Mover para…" do card focado                                |
| ?                  | Lista de atalhos                                            |

Só no renderer (`keydown` no shell), ignorando quando o foco está em campo de texto.

### 4.5 Componentes compartilhados (em `components/`)

| Componente               | Substitui                                      | Base Astryx                                     |
| ------------------------ | ---------------------------------------------- | ----------------------------------------------- |
| `PageHeader` (estendido) | cabeçalhos com título duplo e barras de botões | `Breadcrumbs`, `Heading`, `Toolbar`, `MoreMenu` |
| `PageState`              | vazios/carregando/erro soltos (G5)             | `EmptyState`, `Skeleton`, `Alert`               |
| `TaskRef`                | ID + título montados à mão                     | `Code`, `Text` (truncamento)                    |
| `SignalChips`            | branch/PR/CI da 2D                             | `Token`, `Link`                                 |
| `WaitingItem`            | cards de permissão/pergunta/gate               | `Card`, `Button`, `Timer`                       |
| `StatusToken`            | cores de status por tela (G7)                  | `Token` com mapa único                          |
| `RunLog`                 | log de execução                                | `List`/`Item`, `Timestamp`, `Icon`              |
| `SaveBar`                | "Salvar fluxo" no fim da página                | `HStack` fixo no rodapé da página               |

Mapa de status proposto: **sucesso** (verde) = concluído/OK/aprovado; **aviso** (amarelo) =
esperando você, falta configurar, não verificado; **erro** (rosa) = falhou, CI vermelho,
alterações pedidas; **laranja** = só agente rodando; **neutro** = estados de etapa, prioridade
(Alta com ícone, não com vermelho).

## 5. Plano da Fase 2 (uma tela por commit; ordem a aprovar)

| Ordem | Entrega                                                                                                           | Depende de                     |
| ----- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| 1     | Base: rotas tipadas, menu com projeto atual, `PageHeader`/`PageState`/`StatusToken`/`TaskRef` (corrige G1–G3, G5) | menu combinado com a 6D e a 6C |
| 2     | Painel da tarefa enxuto + tarefa em tela cheia (abas)                                                             | 1                              |
| 3     | Execução do Claude: `RunLog`, `WaitingItem` no topo, permissões/perguntas                                         | 2                              |
| 4     | Quadro: barra, altura das colunas, vazio, janela estreita                                                         | 1                              |
| 5     | Command Palette + atalhos (primeiro um spike do `Dialog` contra a CSP)                                            | 1                              |
| 6     | Etapas e automações (lista + editor, `SaveBar`, Entrega)                                                          | 1                              |
| 7     | Fluxos + aba Modelos Alva                                                                                         | 6                              |
| 8     | Projetos (lista densa), Integrações (+ Bancos do Notion), Contexto do Claude                                      | 1                              |
| 9     | Tela inicial só sem configuração; polish da Visão geral (6D)                                                      | 6D na `main`                   |

Em cada commit: print antes/depois na mesma janela, E2E da tela com seletores por papel/nome,
`pnpm typecheck && pnpm lint && pnpm test`, `pnpm e2e` e `astryx doctor --built src/renderer`.
Os E2E existentes usam nomes como "Fluxo do projeto", "Fluxos de tarefa…", "Voltar ao quadro" e
`complementary "Detalhes de ORK-2"`; renomear exige atualizar esses specs no mesmo commit.

## 6. Conflitos entre as skills e o CLAUDE.md (vale o CLAUDE.md)

| Skill sugere                                                                           | CLAUDE.md diz                                              | Decisão                                                                                                                                              |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| impeccable/taste: trocar Inter por uma fonte "com personalidade"                       | Inter na UI, Jost só logo/títulos                          | Mantém Inter. Personalidade vem do Jost nos títulos de destaque e do mono nos IDs.                                                                   |
| ui-ux-pro-max: paletas e estilos prontos (Tailwind/shadcn)                             | Astryx + tema Orkio, nada de hex/px                        | Só como consulta de regras de UX; nada de paleta ou classe nova.                                                                                     |
| hue: gerar tokens/CSS da marca                                                         | Tema só pelo editor (`themes/orkio/`), `src/themes` gerado | A skill orkio-design **referencia** tokens do tema; não cria CSS nem variáveis.                                                                      |
| better-typography: `text-wrap: balance`, `tabular-nums`, `hanging-punctuation` via CSS | CSS próprio só na camada `orkio-brand` e só para a marca   | Usar props da Astryx quando houver; o que faltar vira pedido de exceção explícita (uma classe utilitária na camada `orkio-brand`) para você aprovar. |
| interface-design: profundidade com sombras                                             | Tema dark com bordas, sem sombra/brilho na marca           | Profundidade só por superfícies e bordas do tema.                                                                                                    |
| impeccable: animações de entrada                                                       | CSP estrita, camadas da Astryx injetam `<style>`           | Só movimento que já vem dos componentes; `prefers-reduced-motion` respeitado.                                                                        |
| várias: `<div>` com classes                                                            | Sem `<div>`/`<span>` cru                                   | Layout só com `VStack`/`HStack`/`Grid`/`Card`.                                                                                                       |

## 7. Decisões que preciso de você

1. **Nomes:** "Etapas e automações" e "Fluxos" (com alva-flow como aba) ou manter "Fluxo do projeto"
   e "Fluxos de tarefa"?
2. **Tarefa:** clicar no card abre o **painel** (com "Abrir tarefa") ou direto a **tela cheia**?
   Recomendo o painel, porque mantém o quadro visível para mover cards.
3. **Ordem da Fase 2** da seção 5 (recomendo como está: base primeiro, porque corrige o bug G1).
4. **Skills:** sigo com os critérios à mão ou espero você commitar `.claude/skills/`?
5. **orkio-design:** aprova o rascunho para eu salvar em `.claude/skills/orkio-design/SKILL.md`?
