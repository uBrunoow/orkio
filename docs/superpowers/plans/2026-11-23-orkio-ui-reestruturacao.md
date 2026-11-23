# Reestruturação da interface do Orkio — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar o menu de 9 telas por uma moldura centrada na tarefa (lista lateral por "o que
fazer", tela da tarefa com fases e painel, Quadro/Agentes no estilo Compozy, Configurações reunindo
Integrações/Projetos/Quadro e automações) e um "Primeiros passos" guiado, tudo numa branch.

**Architecture:** Só renderer, com três exceções no main, todas pequenas: (1) remover o contexto do
projeto do briefing e seus canais IPC (D5); (2) `AgentView.activity` (somente leitura); (3)
`BoardView.ruleCountsWeek` (somente leitura). Regras de tela que dão para isolar viram funções puras
com teste (grupos da lista lateral, rota inicial, fases da tarefa, aba inicial do painel, passos do
setup, checagens do projeto, chips de resposta); o resto reaproveita componentes existentes e é
provado pelo E2E.

**Tech Stack:** Electron + electron-vite, React, TypeScript strict, Astryx (`@astryxdesign/core`) com
tema Orkio, Vitest, Playwright (Electron).

**Spec:** `docs/superpowers/specs/2026-11-23-orkio-ui-reestruturacao-design.md` (decisões D1–D16).
Mockup: `docs/superpowers/specs/2026-11-23-orkio-ui-mockup.html` (abas 1–7). Leia os dois antes de
cada tarefa de tela.

## Global Constraints

- Regras do `CLAUDE.md` valem em tudo: Astryx + tokens do tema (nada de hex/px, `<div>`/`<span>`
  cru, CSS de layout), CSP estrita (sem `<style>` em runtime; nada de `CodeBlock`, `Chat`, gaveta
  do `AppShell`), ícones só via `components/icons.tsx`, estado em `StatusToken`, dados densos em
  `List`/`Item`, textos pt-BR, Prettier (sem `;`, aspas simples, 100 colunas).
- Leia as props com `pnpm exec astryx component <Nome>` antes de usar um componente novo.
- Renderer nunca envia caminhos; seletor de pasta continua no main (`selectionId`).
- Nada de escrita nova no main, IPC, config ou SQLite além das exceções da Architecture.
- Menu principal: exatamente Quadro, Agentes, Configurações (Ctrl/Cmd+1…3 nessa ordem).
- O Orkio não cria tarefas: o botão é "Buscar tarefa" (Ctrl/Cmd+K) (D16).
- Primeiros passos abrem sozinhos só sem nenhum projeto (D10); GitHub é opcional; "completo" =
  passos notion, claude, folder, notion-data, board feitos para o projeto atual.
- Nomes acessíveis que continuam valendo: `navigation "Navegação principal"`, `list "Log da
  execução"`, `list "Linha do tempo do fluxo"`, `region "Fluxo da tarefa"`, `region "Sessão da
  tarefa"`, `region "Spec e plano"`, `region "Diff para aprovar"`, `list "Histórico da tarefa"`.
- Antes de concluir cada tarefa: `pnpm typecheck && pnpm lint && pnpm test`. Tarefas de UI também
  `pnpm build`. `pnpm e2e` (Linux: `xvfb-run -a pnpm e2e`) verde só é exigido ao fim da Tarefa 15.

## Review Focus

1. **Projeto sem vínculo com o Notion ou sem quadro**: lista lateral, Quadro e tela da tarefa mostram
   `PageState` vazio com a ação certa ("Continuar configuração"), nunca quebram. → teste em Tarefa 2
   (`taskGroups` com `board: null`) e E2E em Tarefa 15.
2. **Abrir tarefa de outro projeto** (notificação `board:open-task`, item do sino, Command Palette):
   troca o projeto atual e abre a tela da tarefa. → teste em Tarefa 1 (`routeForTaskRef`) e E2E.
3. **Rota de tarefa que sumiu** (tarefa saiu do cache do Notion, foi reatribuída): tela mostra
   "Tarefa não encontrada" + "Voltar ao quadro". → E2E em Tarefa 15 e estado em Tarefa 5.
4. **Janela estreita (1000×700)**: na tela da tarefa, abaixo de 1200 px o painel da direita vira abas
   acima da conversa; a lista lateral nunca some. → `taskLayout` em Tarefa 5.
5. **Setup interrompido** (GitHub pulado, Notion com erro no meio, app reaberto): passos derivam do
   estado real e o primeiro pendente vira `current`. → testes em Tarefa 13.

---

### Task 0: Branch e arquivos de apoio

**Files:**
- Modify: `.gitignore`
- Add: `docs/superpowers/specs/2026-11-23-orkio-ui-reestruturacao-design.md`,
  `docs/superpowers/specs/2026-11-23-orkio-ui-mockup.html`, este plano

- [ ] **Step 1:** `git switch main && git pull --ff-only && git switch -c feat/ui-reestruturacao`
  (os arquivos de `docs/superpowers/` não estão versionados e acompanham a troca).
- [ ] **Step 2:** Acrescentar `.superpowers/` ao `.gitignore`.
- [ ] **Step 3:** Commit: `docs: design e plano da reestruturação da interface`.

---

### Task 1: Rotas e atalhos novos

**Files:**
- Modify: `src/renderer/src/app/routes.ts`, `src/renderer/src/app/shortcuts.ts`
- Test: `src/renderer/src/app/routes.test.ts`, `src/renderer/src/app/shortcuts.test.ts`

**Interfaces:**
- Produces:
```ts
export type SettingsSection = 'integrations' | 'projects' | 'board' | 'agents' | 'updates' | 'about'
export type BoardSettingsTab = 'columns' | 'rules' | 'flows' | 'delivery'
export type Route =
  | { name: 'setup'; projectId?: string }          // Primeiros passos (projectId = só os pendentes dele)
  | { name: 'board'; projectId?: string }
  | { name: 'task'; projectId: string; taskId: string; section?: TaskSection }
  | { name: 'agents' }
  | { name: 'settings'; section?: SettingsSection; tab?: BoardSettingsTab; projectId?: string }
export const ROUTE_TITLES: Record<Route['name'], string>
  // setup 'Primeiros passos', board 'Quadro', task 'Tarefa', agents 'Agentes', settings 'Configurações'
export const SETTINGS_TITLES: Record<SettingsSection, string>
  // integrations 'Integrações', projects 'Projetos', board 'Quadro e automações',
  // agents 'Agentes do projeto', updates 'Atualizações', about 'Sobre e diagnóstico'
export function routeForTaskRef(ref: BoardTaskRef): Route   // { name: 'task', projectId, taskId, section? }
export const SHORTCUTS: readonly Shortcut[] // mod+1 board, mod+2 agents, mod+3 settings
```
  `routerReducer`, `initialRouter`, `RouterState` mantêm a assinatura. Somem `welcome`, `overview`,
  `projects`, `integrations`, `automations`, `flows`, `context`, `ProjectRouteName`,
  `PROJECT_ROUTES`, `isProjectRoute`, `FlowsTab`. `Shortcut.isProjectScreen` continua (true só no
  Quadro).

- [ ] **Step 1: Testes que falham** em `routes.test.ts`:
  `routeForTaskRef({ projectId: 'p2', taskId: 't9', section: 'flow' })` →
  `{ name: 'task', projectId: 'p2', taskId: 't9', section: 'flow' }`; sem `section` não tem a chave
  (`exactOptionalPropertyTypes`); `ROUTE_TITLES.settings === 'Configurações'`;
  `SETTINGS_TITLES.board === 'Quadro e automações'`. Em `shortcuts.test.ts`:
  `SHORTCUTS.map((s) => s.route.name)` igual a `['board', 'agents', 'settings']`;
  `globalShortcut({ key: '4', ctrlKey: true, … }, false)` → `null`.
- [ ] **Step 2:** `pnpm vitest run src/renderer/src/app` → FAIL.
- [ ] **Step 3:** Implementar. Apague os testes antigos que citam rotas removidas.
- [ ] **Step 4:** `pnpm vitest run src/renderer/src/app` → PASS. (`pnpm typecheck` vai falhar até a
  Tarefa 3 ligar a moldura; é esperado entre as Tarefas 1 e 3.)
- [ ] **Step 5:** Commit `feat(ui): rotas e atalhos da nova navegação`.

---

### Task 2: Grupos da lista lateral e rota inicial (puros)

**Files:**
- Create: `src/renderer/src/app/task-groups.ts`, `src/renderer/src/app/initial-route.ts`
- Test: `src/renderer/src/app/task-groups.test.ts`, `src/renderer/src/app/initial-route.test.ts`

**Interfaces:**
- Consumes: `OverviewSnapshot`, `WaitingItem`, `RunningItem` (`shared/overview.ts`), `BoardView`,
  `BoardCard` (`shared/ipc-contract.ts`), `priorityRank` (`shared/orchestrator.ts`), `StatusTone`
  (`components/StatusToken.tsx`), `Route` (Task 1).
- Produces:
```ts
export interface SidebarTask {
  taskId: string; displayId: string | null; title: string; tone: StatusTone; detail: string | null
  section?: TaskSection
}
export interface TaskGroups { waiting: SidebarTask[]; running: SidebarTask[]; todo: SidebarTask[]; todoTotal: number }
export const TODO_LIMIT = 8
export function taskGroups(input: {
  projectId: string; snapshot: OverviewSnapshot | null; board: BoardView | null; queueStageId: string | null
}): TaskGroups
export function initialRoute(input: {
  projectCount: number; currentProjectId: string | null; groups: TaskGroups | null
}): Route
```
  Regras: `waiting` = itens de `snapshot.waiting` do projeto, uma linha por tarefa (fica o mais
  antigo, `detail = what`, tone `warning`, `section` do item); `running` = `snapshot.running` do
  projeto sem as tarefas já em `waiting` (tone `running`, `detail = label`); `todo` = cards do
  quadro na etapa `queueStageId` (ou a de menor `order`) que não estão em waiting/running, ordenados
  por `priorityRank(card.priority?.name)` e, no empate, mais antigo primeiro (os cards vêm do Notion
  por `created_time` desc, então índice maior = mais antigo), cortados em `TODO_LIMIT`; tone
  `neutral`. Título: `task.title` do snapshot, senão `card.title`, senão `'Tarefa do Notion'`.
  `initialRoute`: sem projeto → `{ name: 'setup' }`; primeiro de `groups.waiting` →
  `{ name: 'task', projectId, taskId, section }`; senão `{ name: 'board' }`.

- [ ] **Step 1: Testes que falham** (`task-groups.test.ts`), com fábricas locais de snapshot/board:
  - `'agrupa por projeto e não repete tarefa'`: duas waiting da mesma tarefa → 1 item com o `what`
    da mais antiga; waiting de outro projeto fica de fora; running da mesma tarefa some de `running`.
  - `'a fazer vem da etapa de fila por prioridade e antiguidade'`: cards em ordem
    `[novaAlta, velhaAlta, velhaBaixa]` com prioridades `Alta/Alta/Baixa` → `todo` =
    `[velhaAlta, novaAlta, velhaBaixa]`.
  - `'sem fila configurada usa a primeira etapa'` e `'corta em 8 e conta o total'` (10 cards →
    `todo.length === 8`, `todoTotal === 10`).
  - `'sem quadro e sem snapshot não quebra'`: `board: null, snapshot: null` → grupos vazios,
    `todoTotal === 0` (Review Focus 1).
  - `initial-route.test.ts`: os três casos acima de `initialRoute`.
- [ ] **Step 2:** `pnpm vitest run src/renderer/src/app` → FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** → PASS.
- [ ] **Step 5:** Commit `feat(ui): grupos da lista lateral e tela inicial`.

---

### Task 3: Moldura (lista lateral, barra superior, sino) e fim da Visão geral

**Files:**
- Create: `src/renderer/src/app/Sidebar.tsx`, `src/renderer/src/app/TopBar.tsx`,
  `src/renderer/src/app/WaitingBell.tsx`, `src/renderer/src/app/useSidebarData.ts`
- Modify: `src/renderer/src/App.tsx`, `src/renderer/src/app/CommandMenu.tsx`
- Delete: `src/renderer/src/features/overview/OverviewPage.tsx` (o `useOverview.ts` fica)

**Interfaces:**
- Consumes: Task 1 e 2; `useOverview()` (`features/overview/useOverview.ts`), `useBoard(projectId)`,
  `window.orkio.agents.orchestrator(projectId)` (para `queueStageId`), `PR_REASON_LABEL`.
- Produces: `Sidebar({ projects, currentProjectId, onSelectProject, groups, setupPending, route,
  onNavigate, onSearch })`; `WaitingBell({ snapshot, onOpen(ref: BoardTaskRef) })` com
  `aria-label` `"<n> esperando você"` (o mesmo texto que o `overview.spec` lê hoje);
  `useSidebarData(projectId: string | null): { groups: TaskGroups | null; snapshot: OverviewSnapshot | null }`.

- [ ] **Step 1:** `App.tsx`: `AppShell` com a coluna larga (ver mockup, aba 2) no lugar da coluna de
  ícones + `TopNav`. A `navigation "Navegação principal"` contém só Quadro, Agentes e Configurações
  (`aria-keyshortcuts` `Control+1…3`/`Meta+…`). Acima dela: logo, seletor de projeto (o que hoje
  está no `TopNav`), botão "Buscar tarefa" (abre a Command Palette) e as listas "Esperando você",
  "Rodando", "A fazer" (`List` com `aria-label` igual ao título; item = ponto do `StatusToken`, ID
  em `Code`, título truncado; clique → `routeForTaskRef`; "Ver todas" quando `todoTotal > 8` →
  Quadro). `setupPending > 0` mostra no topo das listas a linha "Falta N passos · continuar" →
  `{ name: 'setup', projectId }` (o número vem da Task 13; até lá passe `0`).
- [ ] **Step 2:** `TopBar`: breadcrumb (projeto › tela ou `ID · título`), slot para as fases (Task 5)
  e `WaitingBell` (todos os projetos): popover com "Esperando você" agrupado por projeto e a seção
  "PRs com atenção" (`snapshot.prs`, motivos por `PR_REASON_LABEL`) (D11). O contador do menu que
  existia some; o badge do ícone do app continua no main, sem mudança.
- [ ] **Step 3:** Abertura do app com `initialRoute`; `board:open-task` e cliques do sino usam
  `routeForTaskRef` e trocam o projeto atual quando preciso (Review Focus 2). Command Palette:
  telas = Quadro, Agentes, Configurações e cada `SETTINGS_TITLES`; tarefas e "trocar projeto" ficam.
- [ ] **Step 4:** Telas que ainda não existem: `settings` renderiza o `SettingsPage` atual e
  `setup` o `WelcomePage` atual até as Tarefas 6 e 13; `task` usa o `TaskPage` atual até a Tarefa 5.
- [ ] **Step 5:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build` → verde.
- [ ] **Step 6:** Commit `feat(ui): moldura com lista de tarefas e sino; sai a Visão geral`.

---

### Task 4: Sai o Contexto do Claude (D5)

**Files:**
- Delete: `src/renderer/src/features/claude/ProjectContextPage.tsx`; `ContextPage` em
  `features/board/ProjectPages.tsx`
- Modify: `src/main/claude/claude.service.ts` (remover `getContext`, `saveContext`, `searchPages`,
  `projectContext` e a chamada na linha ~185), `src/main/ipc/claude.ipc.ts`, `src/preload/index.ts`,
  `src/shared/ipc-contract.ts` (canais `claude.getContext|saveContext|searchPages` e métodos),
  `src/shared/agent-run.ts` (`contextWarnings`), `src/main/index.ts` (dep `searchPages` do
  `ClaudeService`), `src/shared/briefing.ts` (remover `buildProjectContext` e o campo de contexto
  do briefing), quem mostrava `contextWarnings` no formulário (`features/claude/session-parts.tsx`)
- Test: `src/main/claude/claude.service.test.ts`, `src/shared/briefing.test.ts`
- Keep: `claudeContexts` em `orkio-config.ts` (fica sem uso; sem migração)

- [ ] **Step 1: Teste que falha** em `claude.service.test.ts`:
  `'briefing ignora o contexto do projeto salvo na config'` — config com
  `claudeContexts[p] = { instructions: 'NAO-DEVE-APARECER', notionPages: [{ id: 'x', name: 'X' }] }`;
  o briefing montado não contém `'NAO-DEVE-APARECER'` nem `'Contexto do projeto'`, e
  `getBlockChildren` não é chamado com `'x'`.
- [ ] **Step 2:** `pnpm vitest run src/main/claude` → FAIL.
- [ ] **Step 3:** Remover o código listado; apagar os testes de `getContext`/`saveContext`/
  `searchPages`/`buildProjectContext`. `notion.searchPages` no conector fica se outro serviço usar;
  se não, remova também.
- [ ] **Step 4:** `pnpm typecheck && pnpm lint && pnpm test` → verde.
- [ ] **Step 5:** Commit `refactor(claude): contexto do projeto sai; contexto vem só da tarefa`.

---

### Task 5: Tela da tarefa (fases, conversa, painel)

**Files:**
- Create: `src/renderer/src/features/task/task-phases.ts`, `panel-tab.ts`, `reply-chips.ts`,
  `task-layout.ts`, `TaskScreen.tsx`, `TaskPhaseBar.tsx`, `TaskSidePanel.tsx`
- Test: `src/renderer/src/features/task/task-phases.test.ts`, `panel-tab.test.ts`,
  `reply-chips.test.ts`, `task-layout.test.ts`
- Modify: `features/board/TaskPanel.tsx` (vira o miolo reutilizado pelo `TaskScreen`; some
  `variant='panel'`, `onExpand`), `features/board/BoardPage.tsx` (sem painel; clique no card →
  `onOpenTask(taskId)`), `App.tsx` (rota `task` → `TaskScreen`), cartões de gate/pergunta
  (`features/task-flows/TaskFlowSection.tsx`, `features/claude/QuestionCard.tsx`) para os chips
- Delete: `features/board/TaskPage.tsx`

**Interfaces:**
- Consumes: `PlanStep`, `PlanState`, `flowPlan(run)` (`features/task-flows/flow-plan.ts`),
  `BoardStage`, `WaitingKind`.
- Produces:
```ts
// task-phases.ts
export type PhaseState = 'done' | 'current' | 'waiting' | 'failed' | 'next'
export interface TaskPhase { id: string; label: string; state: PhaseState }
export function phaseLabel(detail: string): string | null
export function taskPhases(input: {
  plan: readonly PlanStep[] | null; stages: readonly BoardStage[]; stageId: string | null
}): TaskPhase[]
// panel-tab.ts
export type PanelTab = 'spec' | 'plan' | 'changes' | 'pr' | 'details'
export function availableTabs(hasBacklogDoc: boolean): PanelTab[]
export function defaultPanelTab(input: {
  currentPhase: string | null; hasBacklogDoc: boolean; hasDiff: boolean; hasPr: boolean
}): PanelTab
// reply-chips.ts
export interface ReplyChip { label: string; action: 'approve' | 'reject' | 'adjust' }
export function replyChips(kind: WaitingKind): ReplyChip[]
// task-layout.ts
export const SIDE_PANEL_MIN_WIDTH = 1200
export function taskLayout(windowWidth: number): 'columns' | 'stacked'
```
  `phaseLabel`: `/alva-flow:spec`→`Spec`, `plan`→`Plano`, `implement`→`Implementar`,
  `review` e `fix`→`Revisão`, `commit`, `pr` e "Ação do Orkio: push"→`PR`; outro comando →
  o nome sem `/` e sem prefixo de plugin; gate/ação sem comando → `null` (entra na fase anterior).
  `taskPhases` com plano: fases na ordem do plano, consecutivas iguais fundidas; estado da fase =
  `failed` > `waiting` > `current` se algum passo tiver esse estado; todos `done`/`skipped` →
  `done`; senão `next` (`PlanState` `waiting`→`waiting`, `failed`→`failed`, `current`→`current`).
  Sem plano: etapas por `order`, a de `stageId` `current`, antes `done`, depois `next`.
  `availableTabs(false)` = `['changes','pr','details']`; `(true)` = todas na ordem acima.
  `defaultPanelTab`: Spec→`spec`, Plano→`plan` (só com doc), Implementar/Revisão→`changes`,
  PR→`pr`; sem correspondência → `changes` se `hasDiff`, senão `details` (D14).
  `replyChips`: `gate` e `action` → `[{ 'Aprovar', approve }, { 'Pedir ajuste…', adjust }]`;
  demais tipos → `[]` (D12). `approve` chama a mesma função do botão Aprovar do cartão; `adjust` só
  foca o `SessionComposer` com o texto vazio.
  `taskLayout(w)` = `w < 1200 ? 'stacked' : 'columns'`.

- [ ] **Step 1: Testes que falham**:
  - `task-phases.test.ts`: `'funde comandos e gates na fase'` (plano spec done, gate done, plan
    waiting, implement next, review next, fix next, commit next, pr next →
    `[Spec done, Plano waiting, Implementar next, Revisão next, PR next]`);
    `'falha vence'` (fix `failed` com review `done` → Revisão `failed`);
    `'sem fluxo usa as colunas'` (3 etapas, `stageId` a do meio → done/current/next);
    `phaseLabel('/meu-plugin:deploy') === 'deploy'`.
  - `panel-tab.test.ts`: tabela dos casos de `defaultPanelTab` acima (incluindo Plano sem doc →
    `changes` com diff e `details` sem).
  - `reply-chips.test.ts`: gate → 2 chips com `approve`/`adjust`; `question` → `[]`.
  - `task-layout.test.ts`: `taskLayout(1199) === 'stacked'`, `taskLayout(1200) === 'columns'`
    (Review Focus 4).
- [ ] **Step 2:** `pnpm vitest run src/renderer/src/features/task` → FAIL.
- [ ] **Step 3:** Implementar os puros → PASS.
- [ ] **Step 4:** `TaskScreen({ project, taskId, section })` (mockup aba 2): `TaskPhaseBar` no slot
  de fases da `TopBar` (clique rola até a primeira mensagem daquela fase), conversa ao centro com o
  `TaskSession` + `SessionComposer` atuais (mesmos nomes acessíveis), `TaskSidePanel` à direita com
  `Tabs` de `availableTabs` (`Spec`/`Plano` usam `BacklogDocumentView`; Mudanças = `DiffView` +
  artefatos; PR & CI = sinais 2D, entrega e pedir review; Detalhes = `TaskDetails` atual, com
  "Histórico completo", "Nova sessão…" e limpar ambiente). No modo `stacked`, o painel vira abas
  acima da conversa. Nome de cada bloco da conversa com o avatar do agente (`AgentAvatar`) quando a
  execução tem agente. Tarefa ausente do quadro → `PageState kind="empty"` "Tarefa não encontrada"
  com "Voltar ao quadro" (Review Focus 3). Os papéis `tab "Sessão"/"Mudanças"/"Detalhes"` deixam de
  existir: a Task 15 ajusta `taskTab`.
- [ ] **Step 5:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build` → verde.
- [ ] **Step 6:** Commit `feat(ui): tela da tarefa com fases e painel da fase`.

---

### Task 6: Configurações com navegação interna

**Files:**
- Modify: `src/renderer/src/features/settings/SettingsPage.tsx`, `App.tsx`
- Create: `src/renderer/src/features/settings/SettingsNav.tsx`

**Interfaces:**
- Consumes: `SettingsSection`, `BoardSettingsTab`, `SETTINGS_TITLES` (Task 1).
- Produces: `SettingsPage({ section, tab, project, onNavigate })`; seção padrão `integrations`.
  `SettingsNav` = `navigation "Configurações"` com grupos Geral (Integrações, Projetos) ·
  `Projeto · <nome>` (Quadro e automações, Agentes do projeto; ocultos sem projeto) · App
  (Atualizações, Sobre e diagnóstico). `UpdatesSection` e `AboutSection` ficam como estão.

- [ ] **Step 1:** Implementar a casca (mockup abas 5–7) e ligar as seções: Integrações →
  `IntegrationsPage` atual, Projetos → `ProjectsPage` atual, Quadro e automações →
  `AutomationsPage` atual, Agentes do projeto → regras + `OrchestratorSection` tiradas do
  `AgentsPage` (as Tarefas 7–11 redesenham cada uma).
- [ ] **Step 2:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build` → verde.
- [ ] **Step 3:** Commit `feat(ui): Configurações com Integrações, Projetos e telas do projeto`.

---

### Task 7: Integrações em lista

**Files:**
- Modify: `features/integrations/IntegrationsPage.tsx`, `NotionConnectionCard.tsx`,
  `GitHubConnectionCard.tsx`, `features/claude/ClaudeCodeCard.tsx`,
  `features/notion-workspace/NotionWorkspaceCard.tsx`
- Create: `features/integrations/IntegrationRow.tsx`

**Interfaces:**
- Produces: `IntegrationRow({ logo, name, purpose, status: { label; tone }, actions, children?, sub? })`
  — `Item` de uma `List "Integrações"`; `children` = área inline que abre na própria linha (login,
  token, assistente); `sub` = sublinhas recuadas.

- [ ] **Step 1:** Linhas (mockup aba 5): Notion (sublinha "Bancos e campos", resumo
  `Projetos → <nome> · Tarefas → <nome> · N de 6 campos ligados`, "Revisar campos" abre o
  assistente do `NotionWorkspaceCard` inline); GitHub; Claude Code (sublinha "Plugins e comandos":
  versão do alva-flow e contagens do catálogo, "Ver catálogo"); GitHub CLI (opcional; estado do
  item `gh` de `alva.precheck` do projeto atual, "Como resolver" mostra o `fix`). Os fluxos de
  conexão atuais (OAuth, Device Flow com `data-testid="device-code"`, token, desconectar) abrem
  dentro da linha, sem mudar os nomes acessíveis usados pelos helpers `notionCard`/`githubCard`
  (se o papel mudar, ajuste os helpers na Task 15).
- [ ] **Step 2:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build` → verde.
- [ ] **Step 3:** Commit `feat(ui): Integrações em lista com estado e ação por linha`.

---

### Task 8: Projetos com checagens

**Files:**
- Create: `src/renderer/src/features/projects/project-checks.ts`
- Test: `src/renderer/src/features/projects/project-checks.test.ts`
- Modify: `features/projects/ProjectsPage.tsx`

**Interfaces:**
- Consumes: `ProjectView`, `AlvaPrecheck` (`shared/alva.ts`).
- Produces:
```ts
export type CheckId = 'folder' | 'github' | 'notion' | 'board' | 'alva' | 'gh'
export interface ProjectCheck { id: CheckId; label: string; state: 'ok' | 'warning' | 'problem' }
export function projectChecks(input: {
  project: ProjectView; boardConfigured: boolean; precheck: AlvaPrecheck | null
}): ProjectCheck[]
export function missingSteps(checks: readonly ProjectCheck[]): number
```
  Rótulos: folder "Pasta e git" (problem se `project.local === null`, label "Pasta não
  encontrada"); github "GitHub (push)" (warning sem repo ou sem push); notion
  `Notion: página "<nome>"` ou "Sem página no Notion" (warning); board "Quadro: N colunas" ou "Sem
  quadro" (warning); alva só com precheck: "alva-flow" ok se `ready`, senão warning; gh só com o
  item `gh` do precheck. `missingSteps` = quantos de `notion` e `board` não estão `ok` (são os
  passos do setup que o projeto ainda deve).

- [ ] **Step 1: Testes que falham**: `'projeto pronto'` (tudo ok → `missingSteps === 0`);
  `'sem Notion e sem quadro faltam 2'`; `'pasta sumida é problema'`; `'sem precheck não mostra
  alva nem gh'`.
- [ ] **Step 2:** → FAIL. **Step 3:** implementar → PASS.
- [ ] **Step 4:** `ProjectsPage` (mockup aba 6): `List` com linha por projeto (nome, caminho · repo ·
  branch em `Code`, checagens como `StatusToken` pequenos, estado geral), ações "Abrir quadro" (pronto),
  "Continuar configuração" (`missingSteps > 0` → `{ name: 'setup', projectId }`), "Localizar pasta" e
  "Remover" (já existem). "Adicionar projeto" no cabeçalho abre o `AddProjectPanel` atual inline.
- [ ] **Step 5:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build` → verde.
- [ ] **Step 6:** Commit `feat(ui): Projetos com checagens e continuar configuração`.

---

### Task 9: Quadro e automações em abas (com contagem de disparos)

**Files:**
- Modify: `features/board/FlowPage.tsx` (separar em abas), `features/board/ProjectPages.tsx`
  (`AutomationsPage` recebe `tab`; `FlowsPage` some), `features/task-flows/TaskFlowsPage.tsx`
  (vira o conteúdo da aba Fluxos; "Modelos do alva-flow" como seção), `features/alva/AlvaPage.tsx`
  (pré-checagem sai daqui — já está em Projetos/Integrações; os templates vão para a aba Fluxos),
  `features/task-flows/DeliverySection.tsx` (aba Entrega)
- Create: `features/board/RulesTab.tsx`, `features/board/ColumnsTab.tsx`
- Modify (main, somente leitura): `src/main/board/board.store.ts`, `src/main/board/board.service.ts`,
  `src/shared/ipc-contract.ts` (`BoardView.ruleCountsWeek: Record<string, number>`)
- Test: `src/main/board/board.store.test.ts`

**Interfaces:**
- Produces: `BoardStore.ruleCounts(projectId: string, sinceIso: string): Record<string, number>` —
  conta `task_events` com `source = 'automation'`, `kind = 'moved'`, `at >= sinceIso`, agrupado por
  `json_extract(detail_json, '$.ruleId')`. `BoardService.get` preenche `ruleCountsWeek` com
  `since = now - WEEK_MS` (`shared/overview.ts`).
- Consumes: `describeRule(rule, stages)` (`shared/flow.ts`), `validateFlow`, `SaveBar`.

- [ ] **Step 1: Teste que falha** em `board.store.test.ts`: `'conta disparos por regra na semana'`
  — eventos `moved/automation` com `ruleId` `r1` (2×, dentro), `r1` (1×, há 8 dias), `r2` (1×,
  `kind: 'automation'` com outcome skipped), `r3` manual → `{ r1: 2 }`.
- [ ] **Step 2:** → FAIL. **Step 3:** implementar store + service + tipo → PASS.
- [ ] **Step 4:** Tela (mockup aba 7) com `Tabs` Colunas · Automações · Fluxos · Entrega sobre o
  MESMO rascunho e um único `SaveBar`/"Salvar fluxo" (mesma validação e histórico):
  - Colunas: linha por etapa (ponto, nome, ↔, `Selector` do status do Notion, fluxo ao entrar,
    contagem) e o editor da etapa escolhida (nome, status, "Fluxo desta coluna"); etapas removidas
    com tarefas; "Etapa Orkio"/"Bloqueada" (o `BoardSettings` atual) num `Collapsible`
    "Campos extras do Notion".
  - Automações: todas as regras na ordem, cada uma como frase (`describeRule`), `Switch`
    liga/desliga, `"disparou N× esta semana"` de `ruleCountsWeek` (`—` sem disparo), menu ⋯
    (editar, mover, remover), "+ Nova automação" e "Testar automação" (o `simulate` atual);
    notificações e histórico de alterações abaixo.
  - Fluxos: editor da 5A + modelos do alva-flow.
  - Entrega: `DeliverySection`.
  "Restaurar padrão", "Simular…", exportar/importar no cabeçalho. Os nomes acessíveis atuais dos
  editores (`region "Nova automação"`, `"Validação do fluxo"`, `"Fluxos do projeto"`,
  `group "Fluxo desta coluna"`) continuam.
- [ ] **Step 5:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build` → verde.
- [ ] **Step 6:** Commit `feat(ui): Quadro e automações em abas com disparos da semana`.

---

### Task 10: Agentes do projeto (configurações)

**Files:**
- Create: `features/agents/ProjectAgentsSettings.tsx`
- Modify: `features/agents/AgentsPage.tsx` (tira regras e orquestrador),
  `features/agents/OrchestratorSection.tsx`

- [ ] **Step 1:** Seção "Agentes do projeto": regras de atribuição por coluna (o editor que hoje está
  no `AgentsPage`) e a `OrchestratorSection` inteira (frase do caminho, carga, "Rodar agora",
  "Configurar orquestrador"). `region "Agentes"` e os nomes usados por `agents.spec`/
  `orchestrator.spec` ficam.
- [ ] **Step 2:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build` → verde.
- [ ] **Step 3:** Commit `feat(ui): regras e orquestrador em Configurações > Agentes do projeto`.

---

### Task 11: Tela Agentes no estilo Compozy (com atividade)

**Files:**
- Modify (main, somente leitura): `src/main/agents/agents.service.ts` (`list`), `src/shared/agent.ts`
  (`AgentView.activity: number[]`)
- Test: `src/main/agents/agents.service.test.ts`
- Create: `features/agents/agent-state.ts`, `features/agents/AgentCard.tsx`,
  `features/agents/Sparkline.tsx`
- Test: `features/agents/agent-state.test.ts`
- Modify: `features/agents/AgentsPage.tsx`, `features/agents/AgentAvatar.tsx` (tamanho `lg`)

**Interfaces:**
- Produces (main): `AgentView.activity` = 12 números, execuções de `agent_runs` com esse
  `agent_key` (todos os projetos) iniciadas em cada uma das últimas 12 horas, do mais antigo ao mais
  recente (`ACTIVITY_HOURS = 12` em `shared/agent.ts`).
- Produces (renderer):
```ts
export type AgentFilter = 'all' | 'waiting' | 'working' | 'stopped'
export interface AgentNow { filter: Exclude<AgentFilter, 'all'>; tone: StatusTone; text: string; tasks: { taskId: string; displayId: string | null; hot: boolean }[] }
export function agentNow(input: {
  agent: AgentView; badges: Record<string, AgentBadge>; snapshot: OverviewSnapshot | null; projectId: string
}): AgentNow
```
  Tarefas do agente = `badges` (taskId → `AgentBadge.key`) com a mesma `key`. Alguma em
  `snapshot.waiting` → `waiting`, tone `warning`, texto `"Esperando você em <ID>"` (pergunta:
  `"Pergunta em <ID>"`); senão alguma em `snapshot.running` → `working`, `running`,
  `"Trabalhando em <ID>"`; senão `stopped`, `neutral`, `"Livre"` (com `assigned > 0`:
  `"Livre · <n> tarefas atribuídas"`); perfil `needs_review`/`invalid` → `stopped`, `"Precisa de
  revisão"`/`"Perfil inválido"`. `hot` = a tarefa está em waiting.

- [ ] **Step 1: Testes que falham**:
  - `agents.service.test.ts`: `'atividade por hora nas últimas 12 h'` — com `now` fixo e 3 runs do
    agente (agora-10min, agora-10min, agora-5h) + 1 de outro agente + 1 de 13 h atrás →
    `activity.length === 12`, `activity[11] === 2`, `activity[6] === 1`, soma `=== 3`.
  - `agent-state.test.ts`: os quatro casos de `agentNow` (waiting vence running; livre com
    atribuídas; perfil a revisar).
- [ ] **Step 2:** → FAIL. **Step 3:** implementar → PASS.
- [ ] **Step 4:** Tela (mockup aba 4): cabeçalho "Agentes N", atalho "Orquestrador: ligado/desligado"
  (→ Configurações › Agentes do projeto), "+ Novo agente"; barra com busca (`/` foca), pílulas
  Todos/Esperando você/Trabalhando/Parados com contagem, Cards/Linhas; seções "Trabalhando agora"
  (waiting + working) e "Disponíveis". `AgentCard`: avatar `lg`, nome, descrição de uma linha,
  `StatusToken` com `agentNow.text`, `Sparkline` de `activity` (barras com `style` de altura, cor
  por token), tags das tarefas (`hot` em tom de destaque), `"<ativos>/<capacidade> vagas · US$ x
  hoje"` (carga do `OrchestratorState.agents`, custo de `usageToday`). Clique abre o editor de
  perfil que já existe. A tela usa o projeto atual (agentes `builtin`/`local` aparecem em todos).
- [ ] **Step 5:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build` → verde.
- [ ] **Step 6:** Commit `feat(ui): Agentes em cards com estado e atividade`.

---

### Task 12: Quadro no estilo Compozy

**Files:**
- Modify: `features/board/BoardColumns.tsx`, `features/board/BoardCardView.tsx`,
  `features/board/card-status.ts`, `features/board/BoardPage.tsx`
- Test: `features/board/card-status.test.ts`

**Interfaces:**
- Produces: `cardStatus` ganha `detail: string | null` — a linha cinza do card: waiting →
  `what` (ex.: "Aprovar plano"), run/fluxo → nome do passo e tempo (`"/implement · 4 min"`), PR →
  `"#31 · 2 comentários"`; a função continua decidindo um estado só.

- [ ] **Step 1: Teste que falha** em `card-status.test.ts`: `'linha de detalhe do card'` — waiting
  `{ what: 'Aprovar plano' }` → `detail === 'Aprovar plano'`; sem nada → `detail === null`.
- [ ] **Step 2:** → FAIL. **Step 3:** implementar → PASS.
- [ ] **Step 4:** Visual (mockup aba 3): faixa de avatares dos agentes com tarefa no quadro;
  cabeçalho da coluna com ponto, nome, contagem e o status do Notion em cinza (`Notion: <nome>`);
  card de 3 linhas (avatar pequeno + ID + estado · título · detalhe e tempo relativo). Kanban/Lista,
  arrasto, "Mover para…", recolher coluna, "Atualizar" e "Buscar tarefa" continuam; clicar no card
  abre a tela da tarefa (Task 5).
- [ ] **Step 5:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build` → verde.
- [ ] **Step 6:** Commit `feat(ui): quadro com cards de três linhas e faixa de agentes`.

---

### Task 13: Primeiros passos

**Files:**
- Create: `src/renderer/src/features/setup/setup-steps.ts`, `SetupPage.tsx`, `useSetupState.ts`
- Test: `src/renderer/src/features/setup/setup-steps.test.ts`
- Modify: `features/welcome/WelcomePage.tsx` (fica só a abertura animada + `LoginPanel`, chamados
  pelo `SetupPage`), `App.tsx` (rota `setup`; `setupPending` na `Sidebar`)

**Interfaces:**
- Consumes: `ConnectionStatus`, `ClaudeCodeStatus`, `ProjectView`, `NotionWorkspaceStatus`
  (o setup calcula o próprio estado; não usa `missingSteps` da Task 8).
- Produces:
```ts
export type SetupStepId = 'github' | 'notion' | 'claude' | 'folder' | 'notion-data' | 'board' | 'first-task'
export type SetupStepState = 'done' | 'current' | 'todo' | 'skipped'
export interface SetupStep { id: SetupStepId; title: string; summary: string | null; state: SetupStepState }
export interface SetupInput {
  github: ConnectionStatus | null; githubSkipped: boolean; notion: ConnectionStatus | null
  claude: ClaudeCodeStatus | null; project: ProjectView | null
  workspace: NotionWorkspaceStatus | null; boardConfigured: boolean
}
export function setupSteps(input: SetupInput): SetupStep[]
export function setupPending(steps: readonly SetupStep[]): number
```
  Títulos (mockup aba 1): "Entrar com GitHub", "Conectar o Notion", "Claude Code", "Escolher a
  pasta do projeto", "Onde ficam suas tarefas no Notion", "Montar o quadro", "Abrir a primeira
  tarefa". Feito: github = conectado (`skipped` se `githubSkipped` e não conectado); notion =
  conectado; claude = instalado, versão mínima e logado; folder = `project !== null`; notion-data =
  `workspace.config !== null` e `project.notionProject !== null`; board = `boardConfigured`;
  first-task nunca fica `done` (é o passo final). O primeiro não feito e não pulado é `current`; os
  seguintes, `todo`. `setupPending` = quantos de notion, claude, folder, notion-data, board não
  estão `done` (D10). `summary` = o que já se sabe (`"uBrunoow"`, `"v2.4.1 · logado"`, caminho
  curto, nome da página do Notion).

- [ ] **Step 1: Testes que falham**:
  - `'tudo vazio: GitHub é o atual'`;
  - `'GitHub pulado não trava: Notion vira o atual'` (Review Focus 5);
  - `'Notion com erro no meio volta a ser o atual'` (`notion.state === 'error'` com projeto já
    escolhido → notion `current`, folder `done`);
  - `'pendentes contam só os passos 2 a 6'` (só falta board → `setupPending === 1`; tudo feito →
    `0`);
  - `'primeira tarefa nunca fica feita'`.
- [ ] **Step 2:** → FAIL. **Step 3:** implementar → PASS.
- [ ] **Step 4:** `SetupPage({ projectId? })` (mockup aba 1): tela cheia sem menu; à esquerda os
  passos (`List "Primeiros passos"`, cada `Item` com o número/✓, título e `summary`), à direita o
  passo atual com título, uma frase, o conteúdo e "Por que isso?" (uma linha), "Voltar" e "Fazer
  depois" (→ `initialRoute`). Conteúdo reaproveitado: 1 `LoginPanel` (+ "Usar token" e
  "Continuar sem GitHub" → `githubSkipped` só em memória); 2 fluxo do `NotionConnectionCard`;
  3 estado do `ClaudeCodeCard` com o comando a rodar; 4 `AddProjectPanel`; 5 assistente do
  `NotionWorkspaceCard` com a sugestão já aplicada + vínculo do `ProjectNotionSection` (lista
  ordenada por semelhança, primeira escolhida), botão "Parece certo · continuar"; 6 criação do
  quadro do `BoardSettings` com a sugestão e as regras padrão, sem "Etapa Orkio"/"Bloqueada" (D15);
  7 lista das tarefas da pessoa (cards do quadro) → abre a tela da tarefa. Com `projectId`, os
  passos 1–3 já feitos aparecem marcados e o atual é o primeiro pendente do projeto. A abertura
  animada continua antes, só sem projeto.
- [ ] **Step 5:** `Sidebar` recebe `setupPending(setupSteps(…))` do projeto atual.
- [ ] **Step 6:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build` → verde.
- [ ] **Step 7:** Commit `feat(ui): Primeiros passos em sete passos com estado real`.

---

### Task 14: Densidade e limpeza

**Files:**
- Modify: componentes que ficaram sem uso (`features/overview/OverviewPage.tsx` já saiu;
  `features/board/ProjectPages.tsx` `FlowsPage`; `features/alva/AlvaPage.tsx` se vazio;
  `components/PageHeader.tsx` se o h1 duplicar com a `TopBar`)

- [ ] **Step 1:** `rg -l "OverviewPage|ContextPage|FlowsPage|TaskPage\b|isProjectRoute|ROUTE_TITLES\.(overview|context|flows|automations|projects|integrations|welcome)" src` → nada.
- [ ] **Step 2:** Uma tela tem um só h1 (`PageHeader`) — com a `TopBar`, o breadcrumb não é h1.
- [ ] **Step 3:** `pnpm exec astryx doctor --built src/renderer` sem falhas novas;
  `pnpm typecheck && pnpm lint && pnpm test && pnpm build` → verde.
- [ ] **Step 4:** Commit `chore(ui): remove telas e código sem uso`.

---

### Task 15: E2E

**Files:**
- Modify: `e2e/fixtures.ts` (`enterApp`, `navTo`, `taskTab`, `expectTaskHistory`, `notionCard`,
  `githubCard`), todos os `e2e/*.spec.ts` que navegam
- Rewrite: `e2e/navigation.spec.ts`, `e2e/overview.spec.ts` (vira o sino)
- Create: `e2e/setup.spec.ts`

**Interfaces:**
- `navTo(page, name)` aceita `'Quadro' | 'Agentes' | 'Configurações'` e os títulos de
  `SETTINGS_TITLES` (clica em Configurações e depois no item da `navigation "Configurações"`).
  Chamadas antigas: `'Etapas e automações'` → `'Quadro e automações'`; `'Fluxos'` →
  `'Quadro e automações'` + aba Fluxos (novo helper `boardSettingsTab(page, 'Fluxos')`);
  `'Contexto do Claude'` → os testes do contexto saem.
- `enterApp(page)`: sem projeto, passa pela abertura/login até a lista dos Primeiros passos; com
  projeto, espera a `navigation "Navegação principal"` e vai para Configurações › Projetos.
- `taskTab(screen, name)` passa a aceitar `'Spec' | 'Plano' | 'Mudanças' | 'PR & CI' | 'Detalhes'`
  (abas do painel); o antigo `'Sessão'` some (a conversa está sempre visível).
- Abrir tarefa: clique no card → tela da tarefa; `getByRole('complementary', { name: 'Detalhes de
  ORK-2' })` vira o painel da tela da tarefa (mantenha esse nome acessível no `TaskSidePanel` para
  reduzir mudanças).

- [ ] **Step 1:** `navigation.spec.ts`: menu tem exatamente Quadro, Agentes, Configurações; Ctrl+1…3;
  Ctrl+4 não faz nada; clicar numa tarefa da lista lateral abre a tela; tarefa inexistente
  (`board:open-task` com id que não está no quadro) mostra "Tarefa não encontrada" (Review Focus
  3); notificação de tarefa de outro projeto troca o projeto (Review Focus 2); janela 1000×700
  mostra o painel em abas acima da conversa (Review Focus 4).
- [ ] **Step 2:** `overview.spec.ts` → sino: contador `"1 esperando você"`, popover com o item,
  "Abrir" leva à tela da tarefa, aprovar some do sino e da lista lateral.
- [ ] **Step 3:** `setup.spec.ts`: sem projeto abre Primeiros passos; "Continuar sem GitHub" →
  Notion atual; conectar Notion (simulado) → Claude; escolher pasta (`queueFolderPicks`) → passo 5
  com bancos e campos sugeridos; "Parece certo" → passo 6; criar quadro → passo 7 lista ORK-2 e
  abre a tela; reabrir o app com projeto e sem quadro → app abre no Quadro com "Falta 1 passo ·
  continuar" (Review Focus 1 e 5).
- [ ] **Step 4:** Ajustar os demais specs às novas rotas/nomes. Não adicione ganchos de teste ao app.
- [ ] **Step 5:** `pnpm build && xvfb-run -a pnpm e2e` → todos verdes (o `@site` pode pular sem
  `site/.next`). `cspViolations` vazio em todos.
- [ ] **Step 6:** Commit `test(e2e): navegação nova, sino e primeiros passos`.

---

### Task 16: Documentação e verificação final

**Files:**
- Modify: `CLAUDE.md` (lista de funcionalidades: Visão geral e Contexto do Claude; "Interface
  (6E)" → nova navegação; seção "Claude Code (4B)" sem o contexto do projeto; "Visão geral (6D)"
  descreve o sino e a lista lateral; estrutura de pastas com `app/`, `features/task/`,
  `features/setup/`; atalhos 1…3), `docs/ui-redesign.md` (nova linha na tabela de fases:
  "9. Reestruturação" com link para o spec), `CHANGELOG.md` (`## [Não lançado]`)
- Create: `docs/ui-redesign/reestruturacao/` com prints 1280×800 e 1000×700 das 7 telas (pelo
  Playwright do E2E, sem ganchos novos)

- [ ] **Step 1:** Atualizar os documentos.
- [ ] **Step 2:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build && xvfb-run -a pnpm e2e` →
  verde.
- [ ] **Step 3:** Commit `docs: nova navegação no CLAUDE.md, redesign e changelog`.
