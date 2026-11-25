# Quadro unificado (fim da tela Tarefas) — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O Quadro passa a mostrar um, vários ou todos os projetos, com a situação calculada de
cada tarefa como badge no card, filtros pela situação e Kanban | Lista na rota. A tela Tarefas
deixa de existir.

**Architecture:** Só renderer. Não há IPC novo: os cards vêm da fonte `board` (uma chave por
projeto, a mesma do Quadro de hoje) e a situação vem de `overview.tasks()` (`PersonalTask`), numa
fonte nova `personalTasks`. As regras ficam em funções puras com teste: filtros e badge
(`shared/task-lanes.ts`, `lib/status-text.ts`, `card-status.ts`), colunas e cards do Quadro
(`features/board/board-model.ts`) e a rota (`app/routes.ts`, `app/tabs.ts`). As colunas, a lista e o
card passam a receber "entradas" (`BoardEntry`) em vez de `BoardCard`. Assim o Quadro de um projeto
e o de vários usam os mesmos componentes, mudando só o conjunto de colunas.

**Tech Stack:** Electron + electron-vite, React, TypeScript strict, shadcn/Radix + Tailwind v4,
Vitest, Playwright (Electron).

**Spec:** `docs/superpowers/specs/2026-11-25-quadro-unificado-design.md`. A seção "Decisões
tomadas depois da leitura do revisor" vale mais que qualquer outra parte do spec. Leia também, no
`CLAUDE.md`, "Quadro (Etapa 3A)", "Tarefas (Fase 1)", "Casca do app (Fase 0)" e "Desktops e
divisão" em "O resto (Fase 5)".

## Global Constraints

- Regras do `CLAUDE.md`: IPC declarativo (aqui não entra canal novo); textos de estado em
  `lib/status-text.ts`; CSP estrita (`style` só onde já existe: card arrastável/flutuante); pt-BR;
  Prettier (sem `;`, aspas simples, 100 colunas).
- Colunas de papel, nesta ordem e com estes rótulos: `queue` A fazer, `plan` Planejando, `work`
  Trabalhando, `review` Em revisão, `reviewed` Revisada, `done` Concluída. Coluna extra: "Outras
  etapas".
- Cores do badge (`StatusToken`): Precisa de você = `warning`, Trabalhando = `running`, Aguardando e
  Em revisão = `neutral`. "Concluído" e card sem `PersonalTask` ficam sem badge. Nenhuma cor nova.
- O badge substitui só a parte de fluxo do estado do card. Continuam como estão "Não sincronizou",
  "Sincronizando" e "Bloqueada". A PR fica no botão "#n", com os rótulos de `PR_CHIP_TEXT` dentro
  dele, sem repetir em outro lugar.
- Filtros na rota: `filter` = `all | attention | active | review` (Todas / Precisa de você / Em
  andamento / Em revisão). Precisa de você = `needsAttention`; Em andamento = `working` +
  `waiting`; Em revisão = `in_review`. O filtro esconde cards e mantém as colunas. A contagem da
  coluna é a de cards visíveis.
- Rota do Quadro: `{ name: 'board'; projectId?; projectIds?: readonly string[] | 'all'; view?:
  'kanban' | 'list'; filter? }`. `placeOf` continua `'board'`: uma aba de Quadro por desktop.
  Mudar o recorte, a visão ou o filtro usa `replace`.
- Um projeto selecionado = o projeto atual do app. Vários ou todos ficam só na rota, sem mexer no
  projeto atual.
- Arrastar com vários projetos move para a etapa daquele papel **no projeto do card**, pelo mesmo
  `useBoard(...).move` de hoje. Alvo inexistente ou "Outras etapas" = coluna desabilitada durante o
  arraste e o card fica onde está.
- Acessibilidade: badge com texto, botões de filtro com `aria-pressed`, "Mover para…" pelo teclado
  como hoje.
- Verificação de cada tarefa: `pnpm typecheck && pnpm lint && pnpm test`. E2E sempre num comando
  separado: `xvfb-run -a pnpm e2e <spec>`, nunca junto com `pnpm test`.
- Commits em pt-BR (Conventional Commits), terminando com a linha
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Rota salva com projeto que não existe mais** (desktop restaurado depois de desvincular um
   projeto): o Quadro mostra os que sobraram. Se não sobrar nenhum, mostra o projeto atual, sem
   tela vazia nem erro. Teste: `boardSelection` (Tarefa 2).
2. **A mesma página do Notion em dois projetos locais**: cada card tem chave `projectId + taskId`.
   Arrastar ou abrir um card nunca age no card do outro projeto. Teste: `boardEntries` (Tarefa 2).
3. **Projeto selecionado ainda sem quadro** (`view.config === null`): fica fora das colunas e
   aparece numa linha "Sem quadro ainda" com atalho para criá-lo. As colunas dos outros projetos
   não quebram. Teste: `roleBoardColumns`/`boardEntries` (Tarefa 2).
4. **Soltar numa coluna sem destino** (o projeto do card não tem etapa com aquele papel, ou
   "Outras etapas"): nenhum `board.move`, nenhuma escrita no Notion, card no lugar. Testes:
   `dropStageFor` (Tarefa 2) e E2E (Tarefa 8).
5. **Abas antigas com a rota `tasks` no mesmo desktop que uma aba de Quadro**: depois de restaurar,
   fica uma aba de Quadro só, com "Todos os projetos" e o filtro antigo, e o índice da aba ativa
   continua válido. Teste: `parseSavedTabs` (Tarefa 7).

---

## Lacunas do spec decididas neste plano

O spec deixa estes pontos em aberto. O plano decidiu assim, e as tarefas seguem estas decisões:

- **Dados de vários projetos:** os cards vêm da fonte `board` de cada projeto (`useBoards`). O
  `OverviewService.tasks()` só tem as tarefas em que o Orkio mexeu, não todos os cards. A situação
  (badge e filtros) vem de `overview.tasks()`, na fonte `personalTasks`. Não entra IPC nem busca
  nova ao Notion.
- **Onde ficam "configurar etapas e regras":** o Quadro de hoje não tem esses botões. Eles entram no
  menu "Mais ações do quadro", junto com "Como as colunas rodam" (`ColumnSetupsDialog`, que estava
  na tela Tarefas). Com vários projetos, cada um vira um submenu com os projetos. O "ponto de
  partida" da tela Tarefas (modelos "Usar em <coluna>") sai.
- **Card "Sem etapa" com vários projetos:** vai para "Outras etapas", com "Sem etapa" no card.
- **Forma da rota:** `projectIds: string[] | 'all'`; nunca junto com `projectId`; lista de um vira
  `projectId` (`boardRoute`). `'all'` com um só projeto vinculado mostra o Quadro de um projeto.
- **Ctrl/⌘1 "como estiver":** `{ name: 'board' }` sem recorte mantém `projectIds`, `view` e `filter`
  da aba de Quadro, mas não o `projectId` (o projeto atual manda no Quadro de um projeto). A mesma
  regra vale para o dock e para a tela inicial, então o último recorte vive na aba salva do
  desktop.
- **Projeto trocado na lista lateral com o Quadro de vários projetos:** só muda o projeto atual; o
  Quadro continua com o recorte dele.
- **Fusão de abas antigas:** a aba de Quadro fica na posição da primeira e com a rota migrada de
  `tasks` ("Todos os projetos" + o filtro).
- **Estado do card:** a parte de PR do `cardStatus` de hoje (CI falhou, mudanças pedidas, em
  revisão, rascunho, mergeada) também sai, porque a raia `in_review` e os chips no "#n" já dizem
  isso. A segunda linha mostra o `what` só em Precisa de você, Trabalhando e Aguardando; o
  tooltip do badge mostra sempre.
- **Só no Quadro de um projeto:** linha de agentes, avisos de etapas (`issues`), linha de automações
  e o submenu de modo ao mover (`runModes`).
- **Contagem de "Precisa de você":** sobre os projetos escolhidos, antes da busca e dos outros
  filtros.
- **`filterTasks` e `groupByLane`** saem com a tela Tarefas. O que se reaproveita é
  `matchesTaskFilter` + `needsAttention`. O filtro `active` muda de sentido (Trabalhando +
  Aguardando), e as rotas salvas mantêm a chave.
- **`ColumnSetupsDialog`, `ModeCards` e `TaskRunSetup`** continuam em `features/tasks/`. Mudar a
  pasta não traz ganho que pague a troca de imports.
- **Projeto escolhido sem quadro:** linha "Sem quadro ainda" com "Criar quadro de <nome>", que abre
  o Quadro daquele projeto.

---

## Mapa de arquivos

| Arquivo | Papel |
| --- | --- |
| `src/shared/task-lanes.ts` | filtros novos (`matchesTaskFilter`); `filterTasks`/`groupByLane` saem na Tarefa 7 |
| `src/shared/board.ts` | `STAGE_ROLE_COLUMN` (rótulos curtos das colunas de papel) |
| `src/renderer/src/lib/status-text.ts` | `TASK_LANE_STATUS` (rótulo + tom do badge) |
| `src/renderer/src/features/board/card-status.ts` | `laneBadge`, `cardSyncStatus`, `prButtonText` (saem `cardStatus`/`cardDetail`) |
| `src/renderer/src/features/board/board-model.ts` (novo) | colunas, entradas, destino do arraste, seleção, filtros visíveis |
| `src/renderer/src/app/routes.ts`, `tabs.ts`, `App.tsx` | rota do Quadro, "como estiver", migração de `tasks` |
| `src/renderer/src/lib/ipc.ts` | `useSourceMany` |
| `src/renderer/src/app/sources.tsx` | fonte `personalTasks` |
| `src/renderer/src/features/board/useBoard.ts` | extrai `boardControls`; novo `useBoards` |
| `src/renderer/src/features/board/BoardColumns.tsx`, `BoardList.tsx`, `BoardCardView.tsx` | passam a receber `BoardEntry` + colunas |
| `src/renderer/src/features/board/BoardFilters.tsx` (novo) | filtros com contagem e busca |
| `src/renderer/src/features/board/BoardProjectPicker.tsx` (novo) | seletor de projetos |
| `src/renderer/src/features/board/MultiBoard.tsx` (novo) | Quadro de vários projetos |
| `src/renderer/src/features/board/BoardPage.tsx` | escolhe entre um ou vários; menu "Mais ações" |
| `src/renderer/src/features/board/task-activity.tsx` | apagado (o card não lê mais a atividade) |
| `src/renderer/src/features/tasks/TasksPage.tsx` | apagado. `ColumnSetupsDialog`, `ModeCards` e `TaskRunSetup` ficam em `features/tasks/` |
| `src/renderer/src/app/screens.ts`, `ScreenPages.tsx`, `commands.ts` | sai a tela `tasks`; Ctrl/⌘2 = Quadro com todos os projetos |

---

### Task 1: Filtros e badge (lógica pura)

**Files:**
- Modify: `src/shared/task-lanes.ts:148-176`
- Modify: `src/shared/board.ts:18-25` (acrescentar abaixo de `STAGE_ROLE_LABEL`)
- Modify: `src/renderer/src/lib/status-text.ts`
- Modify: `src/renderer/src/features/board/card-status.ts`
- Test: `src/shared/task-lanes.test.ts`, `src/renderer/src/features/board/card-status.test.ts`

**Interfaces:**
- Produces:
  - `TASK_FILTERS = ['all', 'attention', 'active', 'review'] as const`; `TaskFilter`;
    `TASK_FILTER_TEXT: Record<TaskFilter, string>` = Todas / Precisa de você / Em andamento / Em
    revisão.
  - `matchesTaskFilter(t: PersonalTask | null, filter: TaskFilter): boolean`. `null` passa só em
    `all`. `filterTasks(tasks, filter, query)` passa a usá-la e continua com a mesma assinatura.
  - `STAGE_ROLE_COLUMN: Record<StageRole, string>` (rótulos das Global Constraints).
  - `TASK_LANE_STATUS: Record<TaskLane, { label: string; tone: StatusTone } | null>` em
    `status-text.ts`: label = `TASK_LANE_TEXT[lane].label`, `done` = `null`.
  - Em `card-status.ts`:
    - `laneBadge(t: PersonalTask | null): { lane: TaskLane; label: string; tone: StatusTone; what: string } | null`
    - `cardSyncStatus(card: Pick<BoardCard, 'sync'>): CardStatus | null`: `failed` → "Não
      sincronizou"/`danger`, `pending` → "Sincronizando"/`neutral`, `kind: 'sync'`.
    - `prButtonText(pr: TaskPullRequest): string`: `#n`, e com a PR aberta (`open`) também
      `prChips(pr)` como ` · ` + rótulos de `PR_CHIP_TEXT`.
  - `cardStatus` e `cardDetail` continuam por enquanto (saem na Tarefa 4).

- [ ] **Step 1: Escrever os testes que falham**

Em `task-lanes.test.ts`, troque o caso "filtros: …" por este. Acrescente uma tarefa `t5`
trabalhando (`running` com `state: 'running'`) e uma `t6` aguardando (`running` com `state:
'queued'`):

```ts
it('filtros: atenção = espera você ou PR com problema; em andamento = trabalhando + aguardando', () => {
  // tasks = [t1 needs_you, t2 in_review CI falhando, t3 in_review, t4 done, t5 working, t6 waiting]
  expect(filterTasks(tasks, 'all')).toHaveLength(6)
  expect(filterTasks(tasks, 'attention').map((t) => t.task.taskId)).toEqual(['t1', 't2'])
  expect(filterTasks(tasks, 'active').map((t) => t.task.taskId)).toEqual(['t5', 't6'])
  expect(filterTasks(tasks, 'review').map((t) => t.task.taskId)).toEqual(['t2', 't3'])
  expect(filterTasks(tasks, 'all', 'nada')).toHaveLength(0)
  expect(matchesTaskFilter(null, 'all')).toBe(true)
  for (const f of ['attention', 'active', 'review'] as const) {
    expect(matchesTaskFilter(null, f)).toBe(false)
  }
})
```

Em `card-status.test.ts`, acrescente (mantenha os casos antigos até a Tarefa 4):

```ts
describe('laneBadge', () => {
  it('cores do app; concluído e sem tarefa não têm badge; o quê vai junto', () => {
    expect(laneBadge(personal('needs_you', 'Conferir o diff'))).toEqual({
      lane: 'needs_you', label: 'Precisa de você', tone: 'warning', what: 'Conferir o diff'
    })
    expect(laneBadge(personal('working'))?.tone).toBe('running')
    expect(laneBadge(personal('waiting'))?.tone).toBe('neutral')
    expect(laneBadge(personal('in_review'))?.label).toBe('Em revisão')
    expect(laneBadge(personal('done'))).toBeNull()
    expect(laneBadge(null)).toBeNull()
  })
})
describe('cardSyncStatus', () => {
  it('só a sincronização', () => {
    expect(cardSyncStatus({ sync: { state: 'synced' } })).toBeNull()
    expect(cardSyncStatus({ sync: { state: 'failed' } })).toMatchObject({ kind: 'sync', label: 'Não sincronizou', tone: 'danger' })
    expect(cardSyncStatus({ sync: { state: 'pending' } })?.label).toBe('Sincronizando')
  })
})
describe('prButtonText', () => {
  it('número e rótulos da PR aberta, sem repetir', () => {
    expect(prButtonText(pr({ state: 'open', checks: 'failure', unresolvedComments: 2 }))).toBe('#7 · CI falhando · Comentários')
    expect(prButtonText(pr({ state: 'open', reviewDecision: 'approved', checks: 'success' }))).toBe('#7 · Pronta')
    expect(prButtonText(pr({ state: 'merged' }))).toBe('#7')
    expect(prButtonText(pr({ state: 'draft' }))).toBe('#7')
  })
})
```

`personal(lane, what = 'x')` monta um `PersonalTask` mínimo. `pr(partial)` monta um
`TaskPullRequest` com `number: 7`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run src/shared/task-lanes.test.ts src/renderer/src/features/board/card-status.test.ts`
Expected: FAIL (`matchesTaskFilter`/`laneBadge`/`cardSyncStatus`/`prButtonText` não existem;
`review` não é filtro).

- [ ] **Step 3: Implementar** as interfaces acima. `TasksPage` itera `TASK_FILTERS`, então continua
  compilando: lá aparecem os quatro filtros, com o texto novo.

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm vitest run src/shared/task-lanes.test.ts src/renderer/src/features/board/card-status.test.ts && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/task-lanes.ts src/shared/task-lanes.test.ts src/shared/board.ts src/renderer/src/lib/status-text.ts src/renderer/src/features/board/card-status.ts src/renderer/src/features/board/card-status.test.ts
git commit -m "feat(quadro): filtros pela situação e badge da raia (lógica pura)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Modelo do Quadro (colunas, entradas, destino, seleção)

**Files:**
- Create: `src/renderer/src/features/board/board-model.ts`
- Test: `src/renderer/src/features/board/board-model.test.ts`
- Modify: `src/renderer/src/features/board/BoardColumns.tsx:14` (o `NO_STAGE` passa a vir de
  `board-model.ts` e é reexportado dali)

**Interfaces:**
- Consumes: `STAGE_ROLES`, `stageWithRole`, `STAGE_ROLE_COLUMN` (Tarefa 1), `matchesTaskFilter`,
  `needsAttention`, `TaskFilter`.
- Produces (todos em `board-model.ts`):

```ts
export const NO_STAGE = '__sem-etapa__'
export const OTHER_STAGES = '__outras-etapas__'
export type BoardMode = 'single' | 'roles'
export const taskKey = (projectId: string, taskId: string): string => `${projectId}\u0000${taskId}`

export interface ProjectBoardInput {
  projectId: string
  projectName: string
  /** `null` = projeto ainda sem quadro (fica de fora das colunas). */
  stages: readonly BoardStage[] | null
  cards: readonly BoardCard[]
}
export interface BoardColumnDef {
  id: string                 // id da etapa | NO_STAGE (single); papel | OTHER_STAGES (roles)
  name: string
  hint: string               // tooltip do título
  aside: string              // texto à direita ("Notion: X"); '' = nada
  stage: BoardStage | null   // etapa da cor do ponto (roles: a 1ª etapa com o papel)
  role: StageRole | null
}
export interface BoardEntry {
  key: string                // taskKey(projectId, card.taskId)
  projectId: string
  projectName: string
  card: BoardCard
  stages: readonly BoardStage[]   // etapas do projeto do card ("Mover para…")
  columnId: string
  /** Nome da etapa no card: só em "Outras etapas" (etapa sem papel ou "Sem etapa"). */
  stageName: string | null
  personal: PersonalTask | null
  signals: TaskSignals | undefined
}

export function boardEntries(
  boards: readonly ProjectBoardInput[],
  mode: BoardMode,
  personal: ReadonlyMap<string, PersonalTask>,           // chave taskKey
  signals: ReadonlyMap<string, Record<string, TaskSignals>> // por projectId
): BoardEntry[]
export function singleBoardColumns(stages: readonly BoardStage[], entries: readonly BoardEntry[]): BoardColumnDef[]
export function roleBoardColumns(boards: readonly ProjectBoardInput[], entries: readonly BoardEntry[]): BoardColumnDef[]
export function dropStageFor(entry: BoardEntry, columnId: string, mode: BoardMode): string | null
export function visibleEntries(
  entries: readonly BoardEntry[],
  f: { filter: TaskFilter; query: string; priority: string | null; onlyBlocked: boolean }
): BoardEntry[]
export function attentionCount(entries: readonly BoardEntry[]): number
export type BoardSelection =
  | { kind: 'one'; projectId: string | null }
  | { kind: 'many'; projectIds: string[] }
export function boardSelection(
  route: { projectIds?: readonly string[] | 'all' },
  linkedIds: readonly string[],   // projetos vinculados ao Notion, na ordem da lista
  currentId: string | null
): BoardSelection
```

Regras que o código precisa seguir:
- `boardEntries`: projeto com `stages === null` não gera entradas. `single`: `columnId` =
  `card.stageId` se a etapa existe, senão `NO_STAGE`, e `stageName` é `null`. `roles`: a etapa do
  card com papel vai para a coluna desse papel (`stageName` `null`). Etapa sem papel vai para
  `OTHER_STAGES` com `stageName` = nome da etapa. Card sem etapa vai para `OTHER_STAGES` com
  `stageName` = "Sem etapa". A ordem é a dos projetos de entrada e, dentro de cada projeto, a dos
  cards.
- `singleBoardColumns`: igual ao `columns` de hoje em `BoardColumns.tsx`. São as etapas e depois
  "Sem etapa", só se alguma entrada cair nela. `hint` = `Status no Notion: X` ou `Status do Notion
  que nenhuma etapa usa`; `aside` = `Notion: X` ou `Sem etapa`.
- `roleBoardColumns`: entram os papéis de `STAGE_ROLES` que existem em pelo menos um projeto com
  quadro, nessa ordem, com nome `STAGE_ROLE_COLUMN[role]`. Depois vem "Outras etapas", só se alguma
  entrada cair nela. `hint` da coluna de papel = `Etapas: <nomes das etapas com o papel, sem
  repetir>`; o de "Outras etapas" = `Etapas sem papel; não dá para soltar aqui`. `aside` = `''`.
- `dropStageFor`: `single` → `null` para `NO_STAGE`, senão `columnId`. `roles` → `null` para
  `OTHER_STAGES`, senão `stageWithRole(entry.stages, columnId)`.
- `visibleEntries`: `matchesTaskFilter(e.personal, filter)`; busca (sem diferenciar maiúsculas) em
  `displayId`, título e `projectName`; prioridade e "só bloqueadas" como no `cards` de hoje do
  `BoardPage`.
- `attentionCount`: entradas com `personal` e `needsAttention`, antes da busca. Quem chama passa as
  entradas sem filtro.
- `boardSelection`: `'all'` vira todos os `linkedIds`. Uma lista é filtrada pelos `linkedIds`, sem
  repetir. Com 2 ou mais, `many`. Com 1, `one` daquele projeto. Com 0 ou sem `projectIds`, `one` do
  `currentId`.

- [ ] **Step 1: Escrever os testes que falham** (`board-model.test.ts`), com dois projetos A (as
  cinco etapas do `DEFAULT_STAGE_TEMPLATE`, todas com papel) e B (`Prioridades` com `queue`,
  `Fazendo` com `work`, `Finalizada` **sem papel**), mais C com `stages: null`:

```ts
it('roles: colunas na ordem dos papéis, sem as que nenhum projeto tem, e "Outras etapas"', () => {
  const entries = boardEntries([A, B, C], 'roles', new Map(), new Map())
  expect(roleBoardColumns([A, B, C], entries).map((c) => c.name)).toEqual([
    'A fazer', 'Trabalhando', 'Em revisão', 'Revisada', 'Concluída', 'Outras etapas'
  ])
})
it('roles: etapa sem papel e card sem etapa vão para Outras etapas com o nome', () => {
  const e = boardEntries([B], 'roles', new Map(), new Map())
  expect(e.find((x) => x.card.taskId === 'b-done')).toMatchObject({ columnId: OTHER_STAGES, stageName: 'Finalizada' })
  expect(e.find((x) => x.card.taskId === 'b-none')).toMatchObject({ columnId: OTHER_STAGES, stageName: 'Sem etapa' })
  expect(e.find((x) => x.card.taskId === 'b-work')).toMatchObject({ columnId: 'work', stageName: null })
})
it('projeto sem quadro fica fora; a mesma tarefa em dois projetos tem duas chaves', () => {
  const same = { ...B, cards: [{ ...A.cards[0]! }] }
  const e = boardEntries([A, same, C], 'roles', new Map(), new Map())
  expect(e.some((x) => x.projectId === C.projectId)).toBe(false)
  const keys = e.filter((x) => x.card.taskId === A.cards[0]!.taskId).map((x) => x.key)
  expect(new Set(keys).size).toBe(2)
})
it('dropStageFor: etapa do papel no projeto do card; sem papel ou Outras etapas = null', () => {
  const [a] = boardEntries([A], 'roles', new Map(), new Map())
  const [b] = boardEntries([B], 'roles', new Map(), new Map())
  expect(dropStageFor(a!, 'done', 'roles')).toBe(stageWithRole(A.stages!, 'done'))
  expect(dropStageFor(b!, 'done', 'roles')).toBeNull()
  expect(dropStageFor(b!, OTHER_STAGES, 'roles')).toBeNull()
  expect(dropStageFor(a!, NO_STAGE, 'single')).toBeNull()
  expect(dropStageFor(a!, 'st-2', 'single')).toBe('st-2')
})
it('single: etapas reais e "Sem etapa" só quando há card', () => {
  const e = boardEntries([A], 'single', new Map(), new Map())
  expect(singleBoardColumns(A.stages!, e).map((c) => c.name)).toEqual(A.stages!.map((s) => s.name))
  const loose = { ...A, cards: [...A.cards, { ...A.cards[0]!, taskId: 'a-x', stageId: null }] }
  const e2 = boardEntries([loose], 'single', new Map(), new Map())
  expect(singleBoardColumns(A.stages!, e2).at(-1)).toMatchObject({ id: NO_STAGE, name: 'Sem etapa' })
  expect(e2.find((x) => x.card.taskId === 'a-x')?.columnId).toBe(NO_STAGE)
})
it('visibleEntries/attentionCount: filtro pela situação, busca no projeto', () => {
  // personal: a1 needs_you, a2 working, b1 in_review com chip ci_failed, b2 sem PersonalTask
  expect(visibleEntries(entries, { ...none, filter: 'attention' }).map(k)).toEqual(['a1', 'b1'])
  expect(visibleEntries(entries, { ...none, filter: 'active' }).map(k)).toEqual(['a2'])
  expect(visibleEntries(entries, { ...none, filter: 'review' }).map(k)).toEqual(['b1'])
  expect(visibleEntries(entries, { ...none, query: 'site' }).every((x) => x.projectName === 'site')).toBe(true)
  expect(attentionCount(entries)).toBe(2)
})
it('boardSelection: todos, lista filtrada, um só, nenhum', () => {
  expect(boardSelection({ projectIds: 'all' }, ['a', 'b'], 'a')).toEqual({ kind: 'many', projectIds: ['a', 'b'] })
  expect(boardSelection({ projectIds: 'all' }, ['a'], 'a')).toEqual({ kind: 'one', projectId: 'a' })
  expect(boardSelection({ projectIds: ['b', 'x', 'b', 'a'] }, ['a', 'b'], 'a')).toEqual({ kind: 'many', projectIds: ['b', 'a'] })
  expect(boardSelection({ projectIds: ['x', 'b'] }, ['a', 'b'], 'a')).toEqual({ kind: 'one', projectId: 'b' })
  expect(boardSelection({ projectIds: ['x'] }, ['a', 'b'], 'a')).toEqual({ kind: 'one', projectId: 'a' })
  expect(boardSelection({}, ['a', 'b'], null)).toEqual({ kind: 'one', projectId: null })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run src/renderer/src/features/board/board-model.test.ts`
Expected: FAIL (módulo não existe).

- [ ] **Step 3: Implementar `board-model.ts`** e trocar o `NO_STAGE` local de `BoardColumns.tsx`
  pelo import daqui. O resto de `BoardColumns` não muda nesta tarefa.

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm vitest run src/renderer/src/features/board/board-model.test.ts && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/features/board/board-model.ts src/renderer/src/features/board/board-model.test.ts src/renderer/src/features/board/BoardColumns.tsx
git commit -m "feat(quadro): modelo de colunas por etapa ou por papel e seleção de projetos

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Rota do Quadro (recorte, visão, filtro; Ctrl/⌘1 "como estiver")

**Files:**
- Modify: `src/renderer/src/app/routes.ts` (tipo `Route`, `TASKS_VIEWS` → `BOARD_LAYOUTS`,
  `parseRoute`, novas `boardRoute`/`boardRouteAsIs`)
- Modify: `src/renderer/src/app/tabs.ts:112-136` (`navigate`) e `:170-176` (`open`)
- Modify: `src/renderer/src/App.tsx:380-393` (`onChooseProject` da `Sidebar`)
- Modify: `src/renderer/src/features/tasks/TasksPage.tsx` (import renomeado)
- Modify: `src/renderer/src/features/board/BoardPage.tsx` (visão vem da rota) e
  `src/renderer/src/app/ScreenPages.tsx:165-180` (passa `route` e `replace`)
- Test: `src/renderer/src/app/routes.test.ts`, `src/renderer/src/app/tabs.test.ts`

**Interfaces:**
- Consumes: `TASK_FILTERS`/`TaskFilter` (Tarefa 1).
- Produces:
  - `BOARD_LAYOUTS = ['kanban', 'list'] as const`; `BoardLayout`. A rota `tasks` passa a usar
    `view?: BoardLayout`.
  - Rota `{ name: 'board'; projectId?: string; projectIds?: readonly string[] | 'all'; view?: BoardLayout; filter?: TaskFilter }`.
    Depois de normalizada, a rota nunca tem `projectId` e `projectIds` juntos.
  - `boardRoute(input: Omit<Extract<Route, { name: 'board' }>, 'name'>): Extract<Route, { name: 'board' }>`:
    normaliza a rota. Tira repetidos, limita a 50 ids e cada id a 200 caracteres. Lista vazia some.
    Lista com 1 vira `projectId`. Com `projectIds` (2 ou mais, ou `'all'`), o `projectId` sai. Chaves
    sem valor não aparecem.
  - `parseRoute` do `board` lê `projectIds`, `view` e `filter`, valida com `pick`/`str` e devolve
    por `boardRoute`.
  - `boardRouteAsIs(current: Route, next: Route): Route`: se `next` é `{ name: 'board' }` sem
    `projectId`, `projectIds`, `view` nem `filter`, e `current` é um `board`, devolve `next` com
    `projectIds`, `view` e `filter` de `current` (o `projectId` de `current` **não** passa). Nos
    outros casos devolve `next`.
  - `tabs.ts` `navigate`: nos dois caminhos que reaproveitam uma aba do mesmo lugar (a ativa e a
    `existing`), a rota usada é `boardRouteAsIs(<rota atual daquela aba>, route)`. O `reset` também
    passa por aqui, então a tela inicial `{ name: 'board' }` mantém o recorte restaurado.
  - `App.tsx`: trocar o projeto na lista lateral com a rota `board` que tem `projectIds` só chama
    `chooseProject(id)`, sem navegar.
  - `BoardPage` recebe `route: Extract<Route, { name: 'board' }>` e `onRoute(route: Route): void`.
    O `SegmentedControl` Kanban | Lista lê `route.view ?? 'kanban'` e grava com
    `onRoute(boardRoute({ ...route, view }))`. O `useState` `layout` sai.

- [ ] **Step 1: Escrever os testes que falham**

Em `routes.test.ts`:

```ts
describe('boardRoute / parseRoute do Quadro', () => {
  it('normaliza o recorte', () => {
    expect(boardRoute({ projectIds: ['a', 'a'] })).toEqual({ name: 'board', projectId: 'a' })
    expect(boardRoute({ projectId: 'x', projectIds: ['a', 'b'] })).toEqual({ name: 'board', projectIds: ['a', 'b'] })
    expect(boardRoute({ projectIds: [] })).toEqual({ name: 'board' })
    expect(boardRoute({ projectIds: 'all', view: 'list', filter: 'review' })).toEqual({
      name: 'board', projectIds: 'all', view: 'list', filter: 'review'
    })
  })
  it('parseRoute aceita só o que o tipo aceita', () => {
    expect(parseRoute({ name: 'board', projectIds: ['a', 7, 'b'], view: 'grade', filter: 'x' })).toEqual({
      name: 'board', projectIds: ['a', 'b']
    })
    expect(parseRoute({ name: 'board', projectIds: 'all', filter: 'attention' })).toEqual({
      name: 'board', projectIds: 'all', filter: 'attention'
    })
  })
})
describe('boardRouteAsIs', () => {
  it('Quadro sem recorte mantém o recorte da aba (não o projeto)', () => {
    expect(boardRouteAsIs({ name: 'board', projectIds: 'all', view: 'list', filter: 'active' }, { name: 'board' }))
      .toEqual({ name: 'board', projectIds: 'all', view: 'list', filter: 'active' })
    expect(boardRouteAsIs({ name: 'board', projectId: 'a', view: 'list' }, { name: 'board' }))
      .toEqual({ name: 'board', view: 'list' })
  })
  it('rota com recorte ou outra tela não muda', () => {
    expect(boardRouteAsIs({ name: 'board', projectIds: 'all' }, { name: 'board', projectId: 'b' }))
      .toEqual({ name: 'board', projectId: 'b' })
    expect(boardRouteAsIs({ name: 'agents' }, { name: 'board' })).toEqual({ name: 'board' })
  })
})
```

Em `tabs.test.ts`:

```ts
it('Ctrl/⌘1 e o dock abrem o Quadro como estiver (recorte, visão e filtro)', () => {
  let s = run(nav({ name: 'board', projectIds: 'all', filter: 'review' }), nav({ name: 'agents' }))
  s = tabsReducer(s, nav({ name: 'board' }))
  expect(currentRoute(s)).toEqual({ name: 'board', projectIds: 'all', filter: 'review' })
  s = tabsReducer(s, { type: 'reset', route: { name: 'board' } })
  expect(currentRoute(s)).toEqual({ name: 'board', projectIds: 'all', filter: 'review' })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run src/renderer/src/app/routes.test.ts src/renderer/src/app/tabs.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar** as interfaces acima e ligar `ScreenPages` → `BoardPage` com `route` e
  `ctx.replace`.

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm vitest run src/renderer/src/app && pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/app/routes.ts src/renderer/src/app/routes.test.ts src/renderer/src/app/tabs.ts src/renderer/src/app/tabs.test.ts src/renderer/src/App.tsx src/renderer/src/app/ScreenPages.tsx src/renderer/src/features/board/BoardPage.tsx src/renderer/src/features/tasks/TasksPage.tsx
git commit -m "feat(quadro): recorte, visão e filtro na rota; Ctrl/⌘1 abre o Quadro como estiver

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Card com badge e PR, colunas e lista por entradas (um projeto)

**Files:**
- Modify: `src/renderer/src/app/sources.tsx` (fonte `personalTasks`)
- Create: `src/renderer/src/features/board/usePersonalTasks.ts`
- Modify: `src/renderer/src/features/board/BoardCardView.tsx`, `BoardColumns.tsx`, `BoardList.tsx`,
  `BoardPage.tsx`
- Modify: `src/renderer/src/features/board/card-status.ts` (saem `cardStatus` e `cardDetail`) e
  `card-status.test.ts` (saem os testes deles)
- Delete: `src/renderer/src/features/board/task-activity.tsx`
- Modify E2E: `e2e/task-flows.spec.ts:184,201,294`, `e2e/agents.spec.ts:243`,
  `e2e/automation.spec.ts:324`

**Interfaces:**
- Consumes: `laneBadge`, `cardSyncStatus`, `prButtonText` (Tarefa 1); `BoardEntry`,
  `BoardColumnDef`, `BoardMode`, `boardEntries`, `singleBoardColumns`, `dropStageFor`, `taskKey`
  (Tarefa 2).
- Produces:
  - `AppSources.personalTasks: Source<PersonalTasksSnapshot>`, chave `''`. Carrega com
    `window.orkio.overview.tasks()`. Relê com `overview.onChanged`, `taskFlows.onChanged` e
    `board.onChanged`, e por poll de 30 s com a janela visível. São as mesmas assinaturas do
    `useIpcResource` de `TasksPage.tsx:55-65`.
  - `usePersonalTasks(): { byKey: ReadonlyMap<string, PersonalTask>; reload(): Promise<void> }`
    (chave `taskKey`).
  - `BoardColumns({ mode, columns, entries, actionsFor })` e `BoardList({ mode, columns, entries, actionsFor })`,
    com `actionsFor(projectId: string): CardActions` (a interface `CardActions` não muda).
  - `BoardCardBody({ entry, showProject, actions })` e `BoardCardItem({ entry, showProject, actions, cardRef, onPointerDown })`,
    com `onPointerDown(e, key)`. O mapa de elementos do card usa `entry.key`.
  - `data-testid` do card: `card-lane` (badge, `title` = `what`), `card-sync` (continua),
    `card-detail` (segunda linha = `what` só nas raias `needs_you`, `working`, `waiting`),
    `card-project` (pílula com o nome do projeto, só com `showProject`), `card-stage` (o
    `stageName`, quando houver). Os testids `card-flow` e `card-status` deixam de existir. Os
    atributos `data-task-id` e `data-sync` continuam, e entra `data-project-id`.
  - Lista agrupada: para cada coluna com entradas visíveis, uma `<section aria-label={coluna}>`
    com cabeçalho (nome + contagem `data-testid="column-count"`) e `<ul aria-label={`Tarefas em
    ${coluna}`}>`. O invólucro mantém `data-testid="board-list"`. Cada linha tem ID, título, badge,
    botão da PR (`prButtonText`), projeto (com `showProject`), etapa e o menu do card.

Regras:
- O arraste em `BoardColumns` usa `dropStageFor(entry, target, mode)`. No `pointerup`, se o destino
  existe e é diferente de `entry.card.stageId`, chama `actionsFor(entry.projectId).onMove(taskId, stageId)`.
  Durante o arraste, a coluna com destino `null` recebe `aria-disabled="true"` e
  `data-drop="blocked"`, sem o realce de alvo e sem o espaço reservado. Soltar nela não faz nada.
- O menu "Mover para…" do card continua `cardMenuItems(entry.card, entry.stages, actions)`.
- O botão da PR continua com `aria-label="Abrir a PR #n no GitHub"` e o `PrHoverCard`. O texto é
  `prButtonText(pr)`, com `pr` = `entry.signals?.pr`.
- `BoardPage` (um projeto): monta as entradas com `boardEntries([{ projectId, projectName, stages:
  view.config.stages, cards: view.cards }], 'single', personal.byKey, new Map([[projectId, signals]]))`
  e as colunas com `singleBoardColumns`. O filtro de agente continua no `BoardPage`. O
  `AgentRow` continua lendo `activityByTask`. Sai só o `TaskActivityProvider`. "Atualizar" e o
  efeito de `fetchedAt` também chamam `personal.reload()`.

- [ ] **Step 1: Ajustar os testes primeiro**

Em `card-status.test.ts`, apague os blocos `describe('cardStatus')` e `describe('cardDetail')`.
Nos specs E2E:
- `e2e/task-flows.spec.ts:184` e `:294`: `getByTestId('card-flow')).toHaveText('Esperando você'` →
  `getByTestId('card-lane')).toHaveText('Precisa de você'`.
- `e2e/task-flows.spec.ts:201`: `card-flow` → `card-lane` (`toHaveCount(0)`, porque o fluxo
  terminado vira `done`, sem badge).
- `e2e/agents.spec.ts:243`: mesma troca da linha 184.
- `e2e/automation.spec.ts:324`:
  `await expect(card(page).getByRole('button', { name: 'Abrir a PR #7 no GitHub' })).toContainText('#7 · Comentários')`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm typecheck`
Expected: FAIL (`cardStatus`/`cardDetail` ainda são importados pelos componentes).

- [ ] **Step 3: Implementar** a fonte, o hook e os componentes acima. Apague
  `task-activity.tsx` e os dois exports antigos de `card-status.ts`.

- [ ] **Step 4: Verificar**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS.

Run (separado): `xvfb-run -a pnpm e2e e2e/board.spec.ts e2e/task-flows.spec.ts e2e/agents.spec.ts e2e/automation.spec.ts e2e/orchestrator.spec.ts`
Expected: PASS. O arraste do critério 3 continua levando o card para Finalizada, e o `card-sync`
continua "Sincronizando".

- [ ] **Step 5: Commit**

```bash
git add -A src/renderer/src e2e/task-flows.spec.ts e2e/agents.spec.ts e2e/automation.spec.ts
git commit -m "feat(quadro): badge da situação e chips da PR no card; lista agrupada por coluna

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Filtros com contagem e "Mais ações" (um projeto)

**Files:**
- Create: `src/renderer/src/features/board/BoardFilters.tsx`
- Modify: `src/renderer/src/features/board/BoardPage.tsx` (barra de filtros, menu "Mais ações do
  quadro", `ColumnSetupsDialog`)
- Modify: `src/renderer/src/app/ScreenPages.tsx` (`onOpenBoardSettings(projectId)`)

**Interfaces:**
- Consumes: `TASK_FILTERS`, `TASK_FILTER_TEXT`, `visibleEntries`, `attentionCount` (Tarefas 1–2),
  `boardRoute` (Tarefa 3), `ColumnSetupsDialog` (`features/tasks/ColumnSetupsDialog.tsx`, sem
  mudança).
- Produces:
  - `BoardFilters({ filter, attention, onFilter, query, onQuery })`. É um `role="toolbar"` com
    `aria-label="Filtros do quadro"` (o mesmo de hoje, onde também ficam a prioridade e "Só
    bloqueadas"). Tem um botão por `TASK_FILTERS` com `aria-pressed`. "Precisa de você" mostra a
    contagem (`data-testid="attention-count"`). A busca continua com `aria-label="Buscar tarefas"`.
    O placeholder fica "Filtrar por ID, título ou projeto".
  - `filter` vem de `route.filter ?? 'all'` e grava com `onRoute(boardRoute({ ...route, filter }))`.
  - Itens novos no menu "Mais ações do quadro": "Configurar etapas e regras" →
    `onOpenBoardSettings(projectId)` = `navigate({ name: 'settings', section: 'board', tab: 'columns', projectId })`;
    "Como as colunas rodam" → abre `ColumnSetupsDialog({ projectId, onClose })`. "Pausar
    todas"/"Retomar automações" continua.

- [ ] **Step 1: Escrever o teste E2E que falha** em `e2e/board.spec.ts`, depois do teste
  "bloqueada: …":

```ts
test('filtros pela situação mantêm as colunas; Lista agrupa por etapa; Mais ações', async () => {
  const { page } = orkio!
  const stages = ['Prioridades', 'Em andamento', 'Revisando', 'Revisado', 'Finalizada']
  await page.getByRole('button', { name: 'Em revisão', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Em revisão', exact: true })).toHaveAttribute('aria-pressed', 'true')
  // Sem fluxo nem PR neste spec: nenhuma tarefa está em revisão, mas as colunas ficam.
  for (const name of stages) {
    await expect(column(page, name)).toBeVisible()
    await expect(column(page, name).getByTestId('column-count')).toHaveText('0')
  }
  await expect(card(page)).toHaveCount(0)
  await page.getByRole('button', { name: 'Todas', exact: true }).click()
  await expect(card(page)).toBeVisible()
  await page.getByRole('radio', { name: 'Lista' }).click()
  await expect(page.getByTestId('board-list').getByRole('region').filter({ hasText: 'ORK-2' })).toHaveCount(1)
  await page.getByRole('radio', { name: 'Kanban' }).click()
  await page.getByRole('button', { name: 'Mais ações do quadro' }).click()
  await page.getByRole('menuitem', { name: 'Como as colunas rodam' }).click()
  await expect(page.getByTestId('column-setups')).toBeVisible()
  await page.getByTestId('column-setups').getByRole('button', { name: 'Fechar' }).first().click()
})
```

(Não dependa da coluna onde ORK-2 terminou nos testes anteriores.)

- [ ] **Step 2: Rodar e ver falhar**

Run: `xvfb-run -a pnpm e2e e2e/board.spec.ts`
Expected: FAIL (não existe botão "Em revisão" nem os itens novos no menu).

- [ ] **Step 3: Implementar** `BoardFilters` e os itens do menu. As entradas visíveis vêm de
  `visibleEntries`. O filtro de agente continua sobre elas.

- [ ] **Step 4: Verificar**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS.

Run (separado): `xvfb-run -a pnpm e2e e2e/board.spec.ts e2e/navigation.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/features/board src/renderer/src/app/ScreenPages.tsx e2e/board.spec.ts
git commit -m "feat(quadro): filtros pela situação com contagem e Como as colunas rodam no Quadro

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Quadro de vários projetos

**Files:**
- Modify: `src/renderer/src/lib/ipc.ts` (`useSourceMany`)
- Modify: `src/renderer/src/features/board/useBoard.ts` (`boardControls` + `useBoards`)
- Create: `src/renderer/src/features/board/BoardProjectPicker.tsx`
- Create: `src/renderer/src/features/board/MultiBoard.tsx`
- Modify: `src/renderer/src/features/board/BoardPage.tsx` (decide um ou vários pela seleção)
- Modify: `src/renderer/src/app/ScreenPages.tsx` (passa `linkedProjects`, `chooseProject`,
  `openTask`)
- Test: sem teste unitário (os testes do projeto não têm DOM; `useSourceMany` e os componentes são
  provados pelo E2E `e2e/board-projects.spec.ts` da Tarefa 8). A lógica já está testada na Tarefa 2.

**Interfaces:**
- Consumes: `boardSelection`, `boardEntries`, `roleBoardColumns`, `visibleEntries`,
  `attentionCount`, `taskKey` (Tarefa 2); `BoardColumns`/`BoardList`/`BoardFilters` (Tarefas 4–5);
  `usePersonalTasks` (Tarefa 4).
- Produces:
  - `useSourceMany<T, A>(source: Source<T, A>, keys: readonly string[]): readonly SourceState<T>[]`.
    Assina todas as chaves. O `getSnapshot` guarda o último array e o devolve enquanto cada item
    for `===` ao `source.get(key)` (o `useSyncExternalStore` exige foto estável). As dependências
    são `keys.join('\u0000')`.
  - `boardControls(sources: Pick<AppSources, 'board' | 'projectFlows'>, projectId: string | null)`
    devolve as funções de `UseBoard` (`load`, `replace`, `move`, `setBlocked`,
    `setAutomationPaused`, `save`, `retryNow`, `dismissNotice`), sem hooks. `useBoard` passa a ser
    `useSource` + `boardControls`, com o mesmo contrato de hoje.
  - `useBoards(projectIds: readonly string[]): { projectId: string; state: SourceState<BoardState>; controls: ReturnType<typeof boardControls> }[]`.
  - `BoardProjectPicker({ projects, selection, all, onChange })`, com
    `onChange(next: { projectIds: string[] | 'all' })`. Usa um `Popover`. O gatilho é um botão
    `aria-label="Projetos do quadro"`, com o texto "Todos os projetos", o nome do projeto ou "N
    projetos". Dentro, um `role="group" aria-label="Projetos do quadro"` com o checkbox "Todos os
    projetos" e um checkbox por projeto vinculado. O último marcado não desmarca. Desmarcar
    "Todos" deixa só o projeto atual.
  - `BoardPage`: `boardSelection(route, linkedIds, linkedProject?.id ?? null)`. Com `one`, usa o
    `Board` de hoje, já com o seletor. Com `many`, usa `MultiBoard`. Mudar o seletor:
    - para um projeto: `chooseProject(id)` + `onRoute(boardRoute({ projectId: id, view, filter }))`;
    - para vários ou todos: `onRoute(boardRoute({ projectIds, view, filter }))`, sem mexer no
      projeto atual.
  - `MultiBoard({ route, projects, onRoute, onOpenTask(ref: BoardTaskRef), onOpenBoardSettings(projectId), onOpenSingle(projectId) })`:
    - Dados: `useBoards(ids)`, `useSourceMany(signals, ids)`, `usePersonalTasks()`. As entradas
      saem de `boardEntries(boards, 'roles', …)` e as colunas de `roleBoardColumns`. `BoardColumns`
      e `BoardList` usam `mode='roles'`, `showProject`, e
      `actionsFor(projectId)` = `onMove`/`onToggleBlocked`/`onToggleAutomation` do `controls`
      daquele projeto, com `onOpen` = `onOpenTask({ projectId, taskId })`, sem `runModes`.
    - Barra: `BoardProjectPicker`, Kanban | Lista, `BoardFilters`, prioridade e "Só bloqueadas".
      "Atualizar" faz, para cada projeto, `automation.runNow(id)` e depois
      `board.reload(id, { force: true })`, e por fim `personal.reload()`.
    - "Mais ações do quadro" tem "Configurar etapas e regras" e "Como as colunas rodam" como
      submenus (`DropdownMenuSub`) com um item por projeto selecionado. Também tem "Pausar
      todas"/"Retomar automações".
    - Avisos: a soma de `pendingCount` no mesmo `Alert` "N alterações aguardando o Notion" com
      "Tentar agora", e o `notice` de cada projeto prefixado com o nome do projeto. Ficam fora a
      linha de automações, a linha de agentes e os `issues`.
    - Projetos sem quadro (`view.config === null`): um parágrafo "Sem quadro ainda: <nomes>", com
      um botão `Criar quadro de <nome>` por projeto, que chama `onOpenSingle(projectId)`.
    - Carregando: `PageState kind="loading" label="Carregando quadros"` até todos os projetos
      terem `value` ou `error`. Erro de um projeto vira `ErrorAlert` com o nome dele, e os outros
      continuam.

- [ ] **Step 1: Prova manual guiada pelo typecheck** (a prova automática é a Tarefa 8)

Run: `pnpm typecheck`
Expected: FAIL até `BoardPage`/`ScreenPages` passarem as props novas.

- [ ] **Step 2: Implementar** as interfaces acima.

- [ ] **Step 3: Verificar**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS.

Run (separado): `xvfb-run -a pnpm e2e e2e/board.spec.ts e2e/shell.spec.ts e2e/desktops.spec.ts`
Expected: PASS (o Quadro de um projeto não muda).

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src
git commit -m "feat(quadro): vários projetos com colunas pelo papel da etapa e seletor de projetos

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Sai a tela Tarefas; rotas antigas viram Quadro com todos os projetos

**Files:**
- Delete: `src/renderer/src/features/tasks/TasksPage.tsx`
- Modify: `src/renderer/src/app/routes.ts` (sai a variante `tasks` do `Route` e de `ROUTE_TITLES`;
  `parseRoute` migra)
- Modify: `src/renderer/src/app/tabs.ts` (`parseSavedTabs` junta lugares repetidos)
- Modify: `src/renderer/src/app/screens.ts` (sai a entrada `tasks` e o import de `ListIcon` se ficar
  sem uso), `src/renderer/src/app/ScreenPages.tsx` (sai `tasks:`)
- Modify: `src/renderer/src/app/commands.ts` (comando `go:board:all`)
- Modify: `src/shared/task-lanes.ts` (saem `filterTasks` e `groupByLane`; ficam `matchesTaskFilter`
  e `needsAttention`) e `src/shared/task-lanes.test.ts`
- Test: `src/renderer/src/app/tabs.test.ts`, `desktops.test.ts`, `commands.test.ts`
- Modify E2E: `e2e/navigation.spec.ts:76-80`, `e2e/shell.spec.ts:104-108`,
  `e2e/overview.spec.ts:160`, `e2e/fixtures.ts:1442-1444` (`navTo` sem 'Tarefas')
- Modify E2E: `e2e/tasks.spec.ts` (o kanban derivado vira badge e filtro no Quadro)

**Interfaces:**
- Consumes: `boardRoute` (Tarefa 3).
- Produces:
  - `parseRoute({ name: 'tasks', view?, filter? })` →
    `boardRoute({ projectIds: 'all', view, filter })`, com `view`/`filter` validados. `active` e
    `attention` mantêm a chave.
  - `parseSavedTabs`: depois do `parseRoute`, rotas com o mesmo `placeOf` (não `null`) viram uma
    só. A aba fica na posição da primeira. Se uma delas veio de `tasks`, a rota que fica é a
    migrada; senão, a primeira. `active` aponta para a aba que ficou.
  - `APP_COMMANDS` ganha `{ id: 'go:board:all', label: 'Quadro de todos os projetos', menu: 'go',
    block: 0, icon: BoardIcon, keys: 'mod+2', keywords: ['tarefas', 'todos os projetos'], visible:
    (ctx) => ctx.hasProject, run: (ctx) => ctx.navigate({ name: 'board', projectIds: 'all' }) }`.
    Esse `navigate` leva uma rota com recorte, então `boardRouteAsIs` não a muda: ela troca o
    recorte da aba de Quadro.
  - Dock: Quadro · Agentes · Configurações (Ctrl/⌘1, 3, 4 continuam como estão).

- [ ] **Step 1: Escrever os testes que falham**

Em `tabs.test.ts`, troque o caso de `parseRoute({ name: 'tasks', … })` (linhas 134-139) por:

```ts
it('rota tasks antiga vira o Quadro com todos os projetos e o mesmo filtro', () => {
  expect(parseRoute({ name: 'tasks', view: 'list', filter: 'attention', x: 1 })).toEqual({
    name: 'board', projectIds: 'all', view: 'list', filter: 'attention'
  })
  expect(parseRoute({ name: 'tasks', view: 'grade', filter: 1 })).toEqual({ name: 'board', projectIds: 'all' })
})
it('abas salvas: tasks + Quadro no mesmo desktop viram uma aba de Quadro', () => {
  const saved = parseSavedTabs({
    routes: [{ name: 'board', projectId: 'a' }, { name: 'agents' }, { name: 'tasks', filter: 'active' }],
    active: 2
  })
  expect(saved).toEqual({
    routes: [{ name: 'board', projectIds: 'all', filter: 'active' }, { name: 'agents' }],
    active: 0
  })
})
```

Em `desktops.test.ts:129-134`, troque `{ name: 'tasks' }` por `{ name: 'board' }` e
`{ name: 'tasks', view: 'list' }` por `{ name: 'board', view: 'list' }`. A intenção do teste
continua a mesma: `replace` com `id` muda só aquela aba.

Em `commands.test.ts`: na linha 110, `expect(go('2')).toEqual({ name: 'board', projectIds: 'all' })`;
na linha 155, `.toBe('go:board:all')`; e
`expect(ids(state({ hasProject: false }))).not.toContain('go:board:all')`.

Em `task-lanes.test.ts`, apague as chamadas de `filterTasks`/`groupByLane`. O caso de filtros da
Tarefa 1 passa a usar `tasks.filter((t) => matchesTaskFilter(t, f))`, com as mesmas expectativas.
A busca por texto já é coberta por `visibleEntries`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run src/renderer/src/app src/shared/task-lanes.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar.** Apague `TasksPage.tsx` e a tela/rota `tasks`. Os E2E:
  - `navigation.spec.ts`: "menu com três telas", `toHaveCount(3)` e a lista `['Quadro', 'Agentes',
    'Configurações']`. Ajuste também o nome do teste e o comentário.
  - `shell.spec.ts:104-108`: `toHaveCount(3)` e o comentário.
  - `overview.spec.ts:160`: comentário "Quadro, Agentes, Configurações".
  - `fixtures.ts`: tirar `'Tarefas'` do `navTo` (que só clica no dock).
  - `e2e/tasks.spec.ts`: reescrito aqui mesmo, para o spec continuar verde neste commit (ver o
    Step 3b).

- [ ] **Step 3b: Reescrever `e2e/tasks.spec.ts`** (o kanban derivado vira badge e filtro no Quadro)

- O comentário do topo diz "Quadro: badge 'Precisa de você'…". O teste passa a se chamar `'Como
  deve rodar: modelo na coluna pelo Quadro, "Rodar uma vez" nativo com revisor e o badge no card'`.
- Linhas 87-109 (ponto de partida + "Como as colunas rodam"): no Quadro, `Mais ações do quadro` →
  `Como as colunas rodam`. No diálogo `column-setups`, clique no rádio `/^Rodar uma vez/` (a coluna
  aberta é a de papel `work`, "Em andamento") e confira `aria-checked="true"`. Depois Avançado →
  "Quem revisa" contém 'Padrão do Orkio (Revisor)' → Fechar. Saem a função `lane()` e o "Nada em
  andamento ainda".
- Linhas 179-192 (kanban derivado) passam a ser:

```ts
await navTo(page, 'Quadro')
const ork2 = page.getByRole('listitem', { name: ORK2, exact: true })
await expect(ork2.getByTestId('card-lane')).toHaveText('Precisa de você', { timeout: 20_000 })
await expect(ork2.getByTestId('card-detail')).toContainText('Conferir o diff')
await expect(page.getByTestId('attention-count')).toHaveText('1')
await page.getByRole('button', { name: /^Precisa de você/ }).click()
await expect(ork2).toBeVisible()
await page.getByRole('button', { name: 'Em revisão', exact: true }).click()
await expect(ork2).toHaveCount(0)
await page.getByRole('button', { name: 'Todas', exact: true }).click()
await page.getByRole('radio', { name: 'Lista' }).click()
await expect(page.getByTestId('board-list').getByRole('listitem', { name: ORK2 })).toContainText('Precisa de você')
await page.getByTestId('board-list').getByRole('listitem', { name: ORK2 }).click()
await expect(taskScreen(page, 'ORK-2')).toBeVisible()
```

- [ ] **Step 4: Verificar**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS.

Run (separado): `xvfb-run -a pnpm e2e e2e/navigation.spec.ts e2e/shell.spec.ts e2e/overview.spec.ts e2e/desktops.spec.ts e2e/tasks.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A src e2e/navigation.spec.ts e2e/shell.spec.ts e2e/overview.spec.ts e2e/fixtures.ts e2e/tasks.spec.ts
git commit -m "feat(quadro)!: a tela Tarefas sai; Ctrl/⌘2 abre o Quadro de todos os projetos

Abas e desktops salvos com a rota tasks viram a aba de Quadro com todos os
projetos e o mesmo filtro.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: E2E do Quadro unificado

**Files:**
- Modify: `e2e/fixtures.ts` (`seedConfig` aceita projetos extras)
- Create: `e2e/board-projects.spec.ts`

**Interfaces:**
- Produces: `seedConfig(userDataDir, project, extra: SeedProject[] = [])`, com
  `SeedProject = { id; name; localPath; repo: typeof FAKE_REPO | null; notionProject?: { id: string; name: string } }`.
  Sem `notionProject`, vale o de hoje (`NOTION_FAKE.orkioPage`, "Orkio Desktop").

- [ ] **Step 1: Estender `seedConfig`** conforme a Interface acima (`notionProject` por projeto).

- [ ] **Step 2: Escrever `e2e/board-projects.spec.ts`** (serial, mesmo esqueleto de
  `board.spec.ts`). A config tem `proj-a` ("orkio-app", Notion "Orkio Desktop": ORK-1, ORK-2) e
  `proj-b` ("site", `notionProject: { id: NOTION_FAKE.sitePage, name: 'Site institucional' }`:
  ORK-3 com status "A fazer").

```ts
test('vários projetos: colunas pelo papel, projeto no card, arrastar no projeto certo', async () => {
  // 1. conecta o Notion; Quadro de orkio-app → "Criar quadro"; troca para "site" pela lista lateral
  //    (botão "Projeto atual: … Trocar projeto") → Quadro → "Criar quadro".
  // 2. fecha o app, tira `role` da etapa "Finalizada" de boards['proj-b'] no orkio-config.json, reabre.
  // 3. seletor: botão "Projetos do quadro" → checkbox "Todos os projetos".
  await expect(columnNames(page)).resolves.toEqual(['A fazer', 'Trabalhando', 'Em revisão', 'Revisada', 'Concluída', 'Outras etapas'])
  await expect(column(page, 'Trabalhando').getByRole('listitem', { name: ORK2 }).getByTestId('card-project')).toHaveText('orkio-app')
  await expect(column(page, 'Outras etapas').getByRole('listitem', { name: ORK3 }).getByTestId('card-stage')).toHaveText('Sem etapa')
  // 4. arrastar ORK-3 (site) para "Concluída": durante o arraste a coluna fica bloqueada; solta e nada muda.
  await expect(column(page, 'Concluída')).toHaveAttribute('data-drop', 'blocked') // antes do mouse.up
  await expect(column(page, 'Outras etapas').getByRole('listitem', { name: ORK3 })).toBeVisible()
  expect((await pagePatches(app)).filter((p) => p.url.endsWith(NOTION_TASK_IDS.ork3))).toEqual([])
  // 5. arrastar ORK-3 para "A fazer" → etapa Prioridades do site → Notion "Prioridades".
  await expect.poll(async () => (await notionState(app)).status[NOTION_TASK_IDS.ork3]).toBe('Prioridades')
  // 6. arrastar ORK-2 (orkio-app) para "Concluída" → Finalizada do orkio-app → Notion "Finalizadas".
  await expect.poll(async () => (await notionState(app)).status[NOTION_TASK_IDS.ork2]).toBe('Finalizadas')
  // 7. arrastar para "Outras etapas" também fica bloqueado.
})

test('filtro e visão na rota sobrevivem a reabrir; Ctrl/⌘1 mantém, Ctrl/⌘2 abre todos', async () => {
  // filtro "Em andamento" → nenhum card, mas as colunas continuam (column-count "0");
  // Lista → seções por coluna com a pílula do projeto; reabre o app → mesma aba de Quadro com
  // "Todos os projetos", Lista e "Em andamento" (aria-pressed); Mod+1 mantém; escolhe só
  // "orkio-app" no seletor → colunas = etapas reais e o projeto atual vira orkio-app; Mod+2 volta
  // a "Todos os projetos" na mesma aba (tabNames continua com um "Quadro").
})

test('nenhum token nos logs', async () => { /* igual a board.spec.ts */ })
```

`columnNames(page)` lê os `aria-label` dos `listitem` de nível 1 da lista "Etapas do quadro". Para
arrastar, use o mesmo padrão do critério 3 de `board.spec.ts` (`mouse.move` em passos), checando
`data-drop` antes do `mouse.up()`.

- [ ] **Step 3: Rodar**

Run: `xvfb-run -a pnpm e2e e2e/board-projects.spec.ts`
Expected: PASS. Se falhar, corrija no código da tarefa dona (Tarefas 4–7), não no teste, a menos
que o teste contradiga o spec.

- [ ] **Step 4: Rodada completa do que o plano tocou**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Run (separado): `xvfb-run -a pnpm e2e e2e/board.spec.ts e2e/board-projects.spec.ts e2e/tasks.spec.ts e2e/task-signals.spec.ts e2e/navigation.spec.ts e2e/desktops.spec.ts e2e/shell.spec.ts e2e/overview.spec.ts e2e/task-flows.spec.ts e2e/agents.spec.ts e2e/automation.spec.ts e2e/orchestrator.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add e2e/fixtures.ts e2e/board-projects.spec.ts
git commit -m "test(quadro): E2E de vários projetos, badge, filtros e rota do Quadro

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Documentação (CLAUDE.md e CHANGELOG)

**Files:**
- Modify: `CLAUDE.md`. Seções e linhas:
  - visão geral: o item "Interface (reestruturação, fase 9)" fala em "menu com Quadro, Tarefas (Fase
    1), Agentes e Configurações (Ctrl/Cmd+1…4)", e o item "Tarefas (Fase 1)" fala em "a tela
    Tarefas (kanban derivado)";
  - "Quadro (Etapa 3A)", último item "UI";
  - "Visão geral (Etapa 6D)", item "Abertura": "Dock: Quadro · Tarefas · Agentes · Configurações";
  - "Casca do app (Fase 0)": abas;
  - "Tarefas (Fase 1)": itens "UI", "Kanban derivado" e "E2E";
  - "Testes": acrescentar `e2e/board-projects.spec.ts` e o `seedConfig` com projetos extras.
- Modify: `CHANGELOG.md` › `## [Não lançado]`

- [ ] **Step 1: Atualizar o `CLAUDE.md`**

- "Quadro (Etapa 3A)" › "UI": o Quadro mostra um projeto, vários ou todos (seletor "Projetos do
  quadro"; rota `board` com `projectId`/`projectIds`/`view`/`filter`, normalizada por `boardRoute`;
  `boardRouteAsIs` = Ctrl/⌘1 e o dock abrem como estiver). Com vários, as colunas são os papéis
  (`roleBoardColumns`, `STAGE_ROLE_COLUMN`) mais "Outras etapas". Arrastar vai para a etapa do
  papel no projeto do card (`dropStageFor`); coluna sem destino fica desabilitada durante o
  arraste. Card: badge da situação (`laneBadge`, de `PersonalTask` pela fonte `personalTasks`),
  sincronização, "Bloqueada" e a PR no "#n" com os chips (`prButtonText`). Filtros
  `all/attention/active/review`, Kanban | Lista (agrupada por coluna). "Mais ações": Configurar
  etapas e regras, Como as colunas rodam. Modelo puro em `features/board/board-model.ts`.
- "Tarefas (Fase 1)": a tela Tarefas não existe mais. "UI": "Como as colunas rodam" fica no menu
  "Mais ações do quadro" (`ColumnSetupsDialog`, que continua em `features/tasks/`, ao lado de
  `ModeCards`/`TaskRunSetup`). "Kanban derivado" vira "Situação da tarefa": as raias de
  `task-lanes.ts` alimentam o badge do card e os filtros do Quadro, sem colunas próprias, e o
  filtro "Em andamento" passa a ser Trabalhando + Aguardando. O E2E passa a falar do badge no
  Quadro.
- Dock e atalhos: Quadro · Agentes · Configurações; Ctrl/⌘2 = Quadro de todos os projetos (comando
  `go:board:all`). Abas/desktops com a rota `tasks` viram a aba de Quadro com todos os projetos
  (`parseRoute` + `parseSavedTabs` juntam o lugar repetido).

- [ ] **Step 2: Atualizar o `CHANGELOG.md`** em `## [Não lançado]`, no tom das notas anteriores:

```markdown
### Mudado

- **Um Quadro só:** a tela Tarefas saiu e o Quadro ficou com o que ela tinha de bom. Cada card
  mostra em que pé está (Precisa de você, Trabalhando, Aguardando, Em revisão) e a PR com o que
  falta (CI falhando, mudanças pedidas, conflito, comentários). Os filtros Precisa de você, Em
  andamento e Em revisão escondem cards sem sumir com as colunas, e a Lista agrupa por coluna.
- **Vários projetos no Quadro:** escolha um, vários ou todos. Com mais de um, as colunas são o papel
  da etapa (A fazer, Trabalhando, Em revisão…) e cada card mostra o projeto. Arrastar move a
  tarefa para a etapa certa do projeto dela. Ctrl/⌘2 abre o Quadro com todos os projetos, e abas
  antigas da tela Tarefas viram esse Quadro.
```

- [ ] **Step 3: Verificar**

Run: `pnpm lint && pnpm test`
Expected: PASS (`pnpm lint` cobre o Prettier dos `.md`, se configurado; senão, confira a quebra em
100 colunas).

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md CHANGELOG.md
git commit -m "docs: Quadro unificado no CLAUDE.md e no CHANGELOG

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
