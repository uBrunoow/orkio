# Quadro unificado (fim da tela Tarefas)

Data: 2026-11-25 · Branch: `feat/quadro-unificado` (base `feat/fase-5-extras`)

## Intenção

Hoje há duas telas de kanban para as mesmas tarefas:

- **Quadro:** um projeto por vez, colunas = etapas do Notion, arrastar escreve no Notion.
- **Tarefas (Fase 1):** todos os projetos, colunas calculadas (Precisa de você / Trabalhando / Aguardando / Em revisão / Concluído), chips da PR, Lista/Kanban e filtros.

O Bruno acha isso redundante. Ele gosta do que Tarefas trouxe, mas quer tudo no Quadro. A tela Tarefas deixa de existir e o Quadro herda o que ela tinha de bom.

## O que o Bruno decidiu

1. As colunas do Quadro continuam sendo as etapas. A situação calculada vira **badge no card**, não coluna. Exemplo: um card em "Em andamento" com o badge "Precisa de você".
2. O Quadro ganha **filtros** (pela situação) e as visões **Kanban | Lista**.
3. O Quadro mostra **um projeto, vários ou todos**.
4. Com mais de um projeto, as **colunas vêm do papel da etapa** (abordagem 1, abaixo).

## Objetivos

- **Seletor de projetos no Quadro:** um, vários ou "Todos os projetos".
  - Com um projeto, o Quadro fica como hoje: etapas com os nomes reais, configurar etapas, regras.
  - Com vários, as colunas são os papéis `STAGE_ROLES`, na ordem `queue, plan, work, review, reviewed, done`, com rótulos curtos: A fazer, Planejando, Trabalhando, Em revisão, Revisada, Concluída.
  - Cada card mostra o projeto dele (nome curto ou cor).
  - Etapas sem papel vão para a coluna "Outras etapas", com o nome da etapa no card.
  - Colunas de papel sem nenhuma etapa em nenhum dos projetos escolhidos não aparecem.
- **Arrastar na visão de vários projetos:** o card vai para a etapa daquele papel **no projeto dele**, pelo mesmo caminho de hoje (fila persistente, escrita no Notion, regras da coluna).
  - O alvo não existe (o projeto não tem etapa com aquele papel): a coluna aparece desabilitada para aquele card durante o arraste e o card não sai do lugar.
  - Não dá para soltar em "Outras etapas" (destino ambíguo).
- **Badge de situação em cada card,** a partir do `PersonalTask.lane` de `shared/task-lanes.ts`:
  - "Precisa de você" é o **único** com a cor forte (laranja); Trabalhando, Aguardando e Em revisão ficam neutros.
  - Card sem fluxo nem PR fica sem badge.
  - "Concluído" não precisa de badge, porque a coluna já diz.
  - O texto curto `what` (o que espera você, o passo rodando…) aparece no tooltip ou na segunda linha.
- **Chips da PR** (`PR_CHIP_TEXT`) no card, reaproveitando os chips que o card do Quadro já tem. Não pode duplicar.
- **Filtros:** Todas / Precisa de você (com contagem) / Rodando / Em revisão, mais a busca.
  - O filtro esconde cards e **mantém as colunas**.
  - Contagem por coluna = cards visíveis.
- **Visão Lista:** agrupada por coluna (etapa ou papel), com badge, chip da PR e projeto.
- **A escolha vive na rota.** Projetos, visão e filtro ficam na rota (`board` ganha `projectIds?`, `view?` e `filter?`), para as abas e os desktops guardarem cada Quadro com o seu recorte.
- **A tela Tarefas morre:**
  - saem a rota `tasks`, a entrada no dock, a aba e os comandos da paleta e do menu;
  - Ctrl/⌘2 passa a abrir o Quadro com "Todos os projetos";
  - rota `tasks` salva em abas e desktops antigos vira `board` com todos os projetos e o mesmo filtro (`routes.ts`, na leitura);
  - `ColumnSetupsDialog`, `ModeCards` e `TaskRunSetup` continuam a ser usados pela tela da tarefa e pelas configurações do Quadro. Mude só onde eles moram, se fizer sentido.

## Não objetivos

- Não mudar o Notion nem a forma de mover. A coluna continua sendo a etapa; a situação nunca é estado manual.
- Não criar etapas novas nem obrigar papel em toda etapa.
- Configurar etapas e regras continua sendo coisa de **um projeto**. Com vários selecionados, esses botões levam a escolher o projeto.

## Antiobjetivos (falha mesmo funcionando)

- Um segundo kanban escondido em algum lugar, ou seja, a redundância voltar.
- Na visão de vários projetos, arrastar mover a tarefa para a etapa errada de outro projeto.
- Perder o que o Quadro de um projeto já faz hoje: ordem, histórico, regras, "bloqueada", sinais da PR.

## Restrições

- Arquitetura do `CLAUDE.md`: IPC declarativo validado nos dois lados, textos em `status-text.ts`, CSP estrita, pt-BR.
- Os dados das tarefas de todos os projetos já existem na Visão geral e no `OverviewService` (que monta `PersonalTask`). Reaproveite em vez de fazer uma busca nova ao Notion por projeto.
- Acessibilidade: o badge tem texto (não só cor), o filtro tem `aria-pressed`, o arraste segue funcionando pelo teclado como hoje.
- E2E sempre com `xvfb-run -a`. Os specs `tasks.spec.ts`, `task-signals.spec.ts`, `navigation.spec.ts`, `desktops.spec.ts` e os do Quadro vão precisar de ajuste.

## Abordagens consideradas

1. **Colunas pelo papel da etapa (escolhida).** Aproveita `STAGE_ROLES`, que o orquestrador e as regras já usam, e mantém o arrastar. Com um projeto nada muda. Custo: etapas sem papel vão para "Outras etapas".
2. **Uma faixa por projeto,** cada uma com as próprias colunas. É fiel às etapas, mas fica alto e não dá para comparar projetos lado a lado.
3. **Kanban só com um projeto; com vários, só Lista.** É o mais simples, mas perde o kanban justamente na visão geral.

O Bruno escolheu a 1.

## Decisões tomadas depois da leitura do revisor (minhas, para o Bruno conferir)

1. **Badge e cores.** O badge de situação **substitui a parte de fluxo** do estado que o card mostra hoje (`cardStatus`: "Fluxo rodando", "Esperando você"…).
   - Ficam como estão: o estado de sincronização ("Não sincronizou", "Sincronizando") e "Bloqueada".
   - As cores seguem a convenção do app (`StatusToken`): "Precisa de você" = `warning`, "Trabalhando" = `running`, Aguardando e Em revisão = `neutral`. Sem cor nova, para o card bater com o sino e a lista lateral.
   - Isso troca o "laranja único" e o antiobjetivo "mais de uma cor forte" da versão anterior deste documento. Uma tela inteira com cards vermelhos e amarelos era coisa do kanban derivado, não do Quadro.
   - A PR continua no botão "#n" do card. Os chips de `PR_CHIP_TEXT` entram dentro dele, como hoje faz o `cardDetail`, sem duplicar.
2. **Projeto atual × seleção do Quadro.**
   - Com **um** projeto selecionado, ele é o projeto atual do app: escolher no seletor troca o projeto atual (como hoje), e trocar o projeto em outro lugar muda o Quadro de um projeto.
   - Com **vários ou todos**, a seleção fica só na rota e não mexe no projeto atual.
   - Nessa visão, configurar etapas e regras abre um menu com a lista dos projetos selecionados.
   - O Ctrl/⌘1 abre o Quadro como estiver.
3. **Uma aba de Quadro por desktop.** O `placeOf` continua `'board'`. Trocar o recorte, a visão ou o filtro usa `replace`, na mesma aba. Para ter "um Quadro por projeto", usa-se um desktop por projeto (Fase 5). A rota `tasks` antiga vira a aba de Quadro (funde com a que existir) e passa a mostrar "Todos os projetos".
4. **Filtros:**
   - Todas.
   - **Precisa de você:** `needsAttention`, ou seja, a situação Precisa de você mais as PRs com chip de atenção.
   - **Em andamento:** Trabalhando + Aguardando.
   - **Em revisão.**

   Na rota, o `filter` vira `all | attention | active | review`. As rotas salvas com `active`/`attention` mantêm o valor. Reaproveitar `filterTasks`/`needsAttention` de `shared/task-lanes.ts`.

## Fica com quem constrói

- Visual do seletor de projetos (popover com checkboxes e "Todos").
- Como mostrar o projeto no card (pílula com nome curto ou faixa de cor).
- Onde guardar o último recorte usado quando o Quadro abre sem rota.
- Se a busca de vários projetos usa o `OverviewService` direto ou junta os `useBoard` de cada projeto.
