# Fluxo Git no Notion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O Orkio preenche no Notion a "Etapa Git", o link da PR e a data do merge na dev a partir dos eventos do GitHub de cada tarefa, e mostra a etapa como selo no card do Quadro.

**Architecture:** Um motor puro (`shared/git-flow.ts`) decide, evento a evento, a etapa nova e as escritas; o `GitFlowService` (main) roda dentro do ciclo das automações (3B), grava o histórico e põe a escrita numa fila própria (`git_flow_writes`, mesma classe `NotionWriteQueue`), separada da pendência do quadro. O mapeamento é um bloco opcional `notion.gitFlow` no `orkio-config`, salvo por um IPC próprio.

**Tech Stack:** Electron + TS strict, `node:sqlite`, Vitest, Playwright, React + shadcn/Tailwind.

**Spec:** `docs/superpowers/specs/2026-11-26-fluxo-git-no-notion-design.md`

## Global Constraints

- Etapas conhecidas e chaves: `branch` (Branch criada), `review` (PR aguardando review), `changes` (Ajustes solicitados), `merged` (Mergeada na dev). "PR para main aberta"/"Em produção" nunca são escritas.
- Ordem das etapas = ordem das opções da propriedade no schema do Notion.
- Só para frente, com as exceções: → `changes` a partir de `review` ou depois (antes de `merged`); `changes` → `review` pelo `pr.review_requested`.
- Destino que conta: base da PR ∉ `NEVER_PR_BASES` (`shared/delivery.ts`). Vale para todo evento de PR.
- Data do merge = `closedAt` da PR mergeada (ISO com hora). Campo PR: escreve se vazio ou se for outra URL `https://github.com/<owner>/<repo>/pull/<n>` do mesmo repositório.
- Respeita `automation.paused` e a pausa da tarefa (evento consumido). "Bloqueada" não impede.
- Só projetos de `automationProjectIds`. Primeira observação = linha de base; o preenchimento inicial roda uma vez por banco (`gitFlow.backfilledAt`).
- `notion.gitFlow` opcional, sem migração do `orkio-config` (ausente = desligado). Só ids e nomes no disco.
- Nada de conteúdo do Notion no disco; textos de UI em pt-BR; cores só por classes do tema (cor do Notion pelo mapa já usado no card de status).
- Antes de concluir: `pnpm typecheck && pnpm lint && pnpm test` e `pnpm e2e` (UI e IPC mudam).

## Review Focus

- Opção mapeada apagada/renomeada no Notion depois de salvar: não escreve, `checkGitFlow` avisa, quadro segue funcionando (Task 1 e Task 5).
- Tarefa já em "Em produção" (opção não mapeada, depois na ordem) recebe `pr.merged` atrasado: não escreve (Task 1).
- Vários eventos no mesmo ciclo (aberta → alterações pedidas → review pedida): termina em `review`, uma escrita só na fila (Task 1 e Task 6).
- Escrita do Git recusada pelo Notion (400): descarta só ela, histórico avisa, o card do quadro não volta (Task 4 e Task 6).
- PR de hotfix direto para `main`: nenhum evento dela mexe na Etapa Git (Task 1 e E2E da Task 7).

---

### Task 1: Motor puro do Fluxo Git

**Files:**
- Create: `src/shared/git-flow.ts`
- Test: `src/shared/git-flow.test.ts`

**Interfaces:**
- Consumes: `NotionPropertySummary` (`shared/notion.ts`), `EventKind`/`AutomationEvent` (`shared/automation.ts`), `NEVER_PR_BASES` (`shared/delivery.ts`), `normalizeLabel` (`shared/text.ts`).
- Produces:
  ```ts
  export type GitStageKey = 'branch' | 'review' | 'changes' | 'merged'
  export const GIT_STAGE_KEYS: readonly GitStageKey[]
  export const GIT_STAGE_LABEL: Record<GitStageKey, string> // 'Branch criada' …
  export interface GitFlowConfig {
    stage: { id: string; name: string; type: 'select' | 'status' }
    options: Partial<Record<GitStageKey, { id: string; name: string }>>
    prUrl?: { id: string; name: string }
    mergedAt?: { id: string; name: string }
    backfilledAt?: string
  }
  export interface GitFlowTaskValue { stage: { id?: string | null; name: string } | null; prUrl: string | null }
  export interface GitFlowPr { number: number; url: string; baseRef: string | null; state: 'draft'|'open'|'merged'|'closed'; closedAt: string | null; changesRequested: boolean }
  export interface GitFlowChange { stage: GitStageKey | null; prUrl: string | null; mergedAt: string | null }
  export function countsAsTarget(baseRef: string | null): boolean
  export function suggestGitFlow(properties: readonly NotionPropertySummary[]): GitFlowConfig | null
  export function checkGitFlow(config: GitFlowConfig, properties: readonly NotionPropertySummary[]): { config: GitFlowConfig | null; warnings: string[] }
  export function nextGitStage(current: GitFlowTaskValue['stage'], target: GitStageKey, config: GitFlowConfig, order: readonly { id: string; name: string }[]): GitStageKey | null
  export function gitFlowForEvents(events: readonly AutomationEvent[], task: GitFlowTaskValue, pr: GitFlowPr | null, repo: { owner: string; name: string } | null, config: GitFlowConfig, order: readonly { id: string; name: string }[]): GitFlowChange | null
  export function gitFlowBackfill(task: GitFlowTaskValue, pr: GitFlowPr | null, hasBranch: boolean, repo: { owner: string; name: string } | null, config: GitFlowConfig, order: readonly { id: string; name: string }[]): GitFlowChange | null
  ```

- [ ] **Step 1: Write the failing tests** (`describe('git-flow')`), com um schema de exemplo igual ao da Alva (opções na ordem: Branch criada, PR aguardando review, Ajustes solicitados, Mergeada na dev, PR para main aberta, Em produção):
  - `suggestGitFlow` acha a propriedade "Etapa Git" (select) e liga as quatro opções pelos nomes; acha `PR` (url) e `Merge na dev` (date) pelo nome; sem select com essas opções → `null`.
  - `checkGitFlow`: opção apagada → some de `options` + aviso `'A opção "Ajustes solicitados" da Etapa Git não existe mais.'`; propriedade da etapa apagada ou de outro tipo → `config: null` + aviso; renomeada → nome atualizado, sem aviso de erro.
  - `nextGitStage`: `null → branch` = `branch`; `review → branch` = `null`; `review → changes` = `changes`; `changes → review` = `review`; `merged → changes` = `null`; atual "Em produção" + alvo `merged` = `null`; atual com nome desconhecido = `null`; alvo sem opção mapeada = `null`.
  - `gitFlowForEvents`: `[pr.opened, pr.changes_requested, pr.review_requested]` com atual `branch` → `{ stage: 'review', prUrl: url, mergedAt: null }`; `pr.merged` → `stage: 'merged'`, `mergedAt: closedAt`; PR com `baseRef: 'main'` → `null` para qualquer evento de PR; `branch.created` com atual `null` → `branch`; `prUrl` atual `https://github.com/acme/app/pull/3` e PR #7 do mesmo repo → troca; atual `https://exemplo.com/x` → `prUrl: null`; `pr.review_requested` com atual `review` → `null`.
  - `gitFlowBackfill`: PR aberta com `changesRequested` → `changes`; aberta → `review`; mergeada para `dev` → `merged` + data; rascunho e branch → `branch`; nada → `null`; respeita "só para frente".

- [ ] **Step 2: Run** `pnpm vitest run src/shared/git-flow.test.ts` — Expected: FAIL (módulo não existe).

- [ ] **Step 3: Implement** as funções acima. Eventos aplicados em sequência, cada um sobre a etapa resultante do anterior; mapeamento evento → alvo: `branch.created→branch`, `pr.opened|pr.ready_for_review→review`, `pr.changes_requested→changes`, `pr.review_requested→review` só com atual `changes`, `pr.merged→merged`; demais eventos ignorados. `prUrl` só junto de alvo `review`/`merged`/`changes`. Resultado sem nenhuma mudança → `null`.

- [ ] **Step 4: Run** `pnpm vitest run src/shared/git-flow.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit** `git commit -m "feat(fluxo-git): motor puro da Etapa Git"`

### Task 2: Escrita de url/date e leitura da etapa no Notion

**Files:**
- Modify: `src/main/connectors/notion/notion.schema.ts` (`PropertyWrite`, `encode/decode/propertyWritesMatch/applyPropertyWrites/propertyWritesKey`, `parseTaskPage`)
- Modify: `src/shared/notion.ts` (`NotionTask`, `NotionWorkspaceConfig.gitFlow?`)
- Test: `src/main/connectors/notion/notion.schema.test.ts`

**Interfaces:**
- Consumes: `GitFlowConfig` (Task 1).
- Produces:
  - `PropertyWrite` += `{ type: 'url'; url: string } | { type: 'date'; start: string }` → payload `{ url }` e `{ date: { start } }`.
  - `parseTaskPage(body, mapping, gitFlow?: GitFlowConfig | null)`; `NotionTask` += `gitStage: { id?: string | null; name: string; color: NotionColor } | null` e `prUrl: string | null` (ambos `null` sem `gitFlow`).
  - `NotionWorkspaceConfig.gitFlow?: GitFlowConfig`.

- [ ] **Step 1: Failing tests:** encode/decode ida e volta de `{ pr: { type: 'url', url } , dt: { type: 'date', start: '2026-11-26T14:03:00Z' } }`; `propertyWritesKey` estável; `propertyWritesMatch` compara url e date (start igual); `parseTaskPage` com `gitFlow` lê a opção (select e status) e a URL; sem `gitFlow` → `gitStage: null, prUrl: null`.
- [ ] **Step 2: Run** `pnpm vitest run src/main/connectors/notion/notion.schema.test.ts` — FAIL.
- [ ] **Step 3: Implement.** Os valores conhecidos (`simplePropertyValues`) passam a guardar url e date para o `match/apply`. Quem chama `parseTaskPage` em `notion-workspace.service.ts` passa `config.gitFlow ?? null`.
- [ ] **Step 4: Run** o arquivo + `pnpm typecheck` — PASS.
- [ ] **Step 5: Commit** `feat(fluxo-git): escrita de url e data no Notion e leitura da Etapa Git`

### Task 3: Destino da PR nos sinais

**Files:**
- Modify: `src/main/connectors/github/github.client.ts:415-470` (parse `base.ref`), `src/main/connectors/github/gh-cli.ts` se montar `PullRequestSummary`, `src/shared/task-signals.ts` (`PullRequestSummary.baseRef?: string | null`)
- Modify: `e2e/fixtures.ts` (`FakePull.base?`, padrão `'dev'`, devolvido como `base: { ref }`)
- Test: `src/main/connectors/github/github.client.test.ts` (ou o teste do parse existente)

**Interfaces:** Produces `PullRequestSummary.baseRef?: string | null` (ausente/inválido = `null`, validado por `isBranchName` de `github-names.ts`).

- [ ] **Step 1:** Teste: item REST com `base: { ref: 'dev' }` → `baseRef: 'dev'`; sem `base` → `null`; `ref` inválido (`'../x'`) → `null`.
- [ ] **Step 2:** Rodar — FAIL. **Step 3:** Implementar. **Step 4:** Rodar + `pnpm typecheck` — PASS. Não entra no `PrSnapshot` (o snapshot da 3B não muda; o motor lê o destino dos sinais do ciclo).
- [ ] **Step 5: Commit** `feat(sinais): destino da PR`

### Task 4: Fila de escrita do Fluxo Git (SQLite)

**Files:**
- Modify: `src/main/db/database.ts` (migração v15: tabela `git_flow_writes`, mesmas colunas de `pending_writes` menos `rollback_json`, `task_page_id` UNIQUE)
- Modify: `src/main/board/write-queue.ts` (tipo do `store` vira a interface `WriteStore<W extends QueuedWrite>`; `onSynced/onRejected/onRetry` genéricos)
- Create: `src/main/git-flow/git-flow.store.ts`
- Test: `src/main/git-flow/git-flow.store.test.ts`, `src/main/board/write-queue.test.ts` (continua passando)

**Interfaces:**
- Produces:
  ```ts
  export interface QueuedWrite { taskPageId: string; properties: PropertyWrites; attempts: number; nextAttemptAt: string; lastErrorCode: string | null }
  export interface WriteStore<W extends QueuedWrite> { allPending(): W[]; pending(id: string): W | null; scheduleRetry(id: string, attempts: number, next: string, code: string): void; deletePending(id: string): void; deletePendingIfUnchanged(id: string, writes: PropertyWrites): boolean }
  export class GitFlowStore implements WriteStore<GitFlowWrite> { constructor(db: Database); merge(input: { taskPageId: string; projectId: string; properties: PropertyWrites; now: string }): void; /* + WriteStore */ }
  export interface GitFlowWrite extends QueuedWrite { projectId: string; createdAt: string }
  ```
- `BoardStore` passa a declarar `implements WriteStore<PendingWrite>` sem mudar comportamento.

- [ ] **Step 1:** Testes do store: `merge` cria; segundo `merge` na mesma tarefa junta propriedades (a última vence por id de propriedade) e zera `attempts`/`nextAttemptAt = now`; `deletePendingIfUnchanged` só apaga se igual; migração sobe `user_version` para 15 num banco v14.
- [ ] **Step 2:** Rodar `pnpm vitest run src/main/git-flow src/main/db src/main/board/write-queue.test.ts` — FAIL.
- [ ] **Step 3:** Implementar (migração acrescentada ao fim de `MIGRATIONS`).
- [ ] **Step 4:** Rodar de novo — PASS.
- [ ] **Step 5: Commit** `feat(fluxo-git): fila de escrita própria no SQLite`

### Task 5: Salvar o Fluxo Git (serviço + IPC)

**Files:**
- Modify: `src/main/notion/notion-workspace.service.ts` (`getGitFlow`, `saveGitFlow`; `getStatus` junta os avisos de `checkGitFlow`), `src/main/config/orkio-config.ts` (parse do `notion.gitFlow` opcional; inválido = some com aviso)
- Modify: `src/shared/ipc/api.ts` (grupo do workspace do Notion: `getGitFlow(): Result<GitFlowSetup>`, `saveGitFlow(input: GitFlowInput | null): Result<NotionWorkspaceStatus>`), `src/shared/ipc/payloads.ts` (`parseGitFlowInput`), `src/main/ipc/notion-workspace.ipc.ts`
- Test: `src/main/notion/notion-workspace.service.test.ts`, `src/main/ipc/ipc.test.ts`, `src/main/config/orkio-config.test.ts`

**Interfaces:**
- Consumes: Task 1 (`suggestGitFlow`, `checkGitFlow`).
- Produces:
  ```ts
  export interface GitFlowInput { stagePropertyId: string; options: Partial<Record<GitStageKey, string>>; prUrlPropertyId: string | null; mergedAtPropertyId: string | null }
  export interface GitFlowSetup { config: GitFlowConfig | null; suggestion: GitFlowConfig | null; properties: NotionPropertySummary[] } // properties = select/status/url/date do banco de Tarefas
  ```
  `saveGitFlow(null)` desliga; trocar `stage.id` apaga `backfilledAt`.

- [ ] **Step 1:** Testes: salvar com ids válidos grava `notion.gitFlow` só com ids/nomes; opção de outro select → erro `'Escolha opções da propriedade da Etapa Git.'`; url/date com tipo errado → erro; propriedade usada duas vezes ou já usada no mapeamento principal → `'Use uma propriedade diferente para cada campo.'`; nenhuma opção → erro; `null` apaga; IPC recusa id malformado ("Pedido inválido"); config v15 sem `gitFlow` lê igual.
- [ ] **Step 2:** Rodar — FAIL. **Step 3:** Implementar. **Step 4:** Rodar + `pnpm typecheck` — PASS.
- [ ] **Step 5: Commit** `feat(fluxo-git): mapeamento do Fluxo Git no Notion`

### Task 6: GitFlowService no ciclo das automações

**Files:**
- Create: `src/main/git-flow/git-flow.service.ts`
- Modify: `src/main/automation/automation.service.ts` (deps `gitFlow?: Pick<GitFlowService, 'apply' | 'backfill'>`; chama dentro da transação do ciclo), `src/main/composition/app.ts` e `lifecycle.ts` (criar, `start`/`stop` da fila), `src/shared/task-events.ts` (tipo `git_flow`), `src/shared/task-history.ts` (texto), `src/shared/board.ts` + `src/main/board/board.service.ts` (`BoardCard.gitStage` = valor do `NotionTask`)
- Test: `src/main/git-flow/git-flow.service.test.ts`, `src/main/automation/automation.service.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 2, 3, 4.
- Produces:
  ```ts
  export class GitFlowService {
    readonly writes: NotionWriteQueue<GitFlowWrite>
    apply(tx: Tx, input: { projectId: string; taskId: string; events: AutomationEvent[]; task: NotionTask | null; signals: TaskSignals | undefined; paused: boolean }): boolean
    backfill(tx: Tx, input: { projectId: string; tasks: NotionTask[]; signals: Record<string, TaskSignals> }): number
  }
  ```
  Evento de histórico `git_flow`: `source: 'automation'`, `groups: ['automation']`, `inSession: false`, `detail: { stage: str, prNumber: num, rejected: str }`; textos "Etapa Git → Mergeada na dev" e "O Notion recusou a Etapa Git: <motivo>".

- [ ] **Step 1:** Testes do serviço com store em memória e `updatePage` falso: eventos `[pr.opened, pr.merged]` → uma escrita com status/select da opção `merged`, url e date; chave `gitflow:<chave do evento>` em `task_events` impede repetir; `paused` → nada escrito e eventos consumidos; tarefa com `gitStage` "Em produção" → nada; `updatePage` rejeita 400 → pendência apagada, evento `git_flow` com `rejected`, nenhum `rolled_back` do quadro; `backfill` escreve só onde há mudança e grava `backfilledAt` (via config) uma vez.
- [ ] **Step 2:** Teste do ciclo (`automation.service.test.ts`): com `gitFlow` nas deps, um `pr.merged` move o card pela regra **e** chama `apply` com os mesmos eventos; sem `notion.gitFlow` não chama.
- [ ] **Step 3:** Rodar — FAIL. **Step 4:** Implementar; o `GitFlowService` lê a tarefa do snapshot do quadro (cards do `board.get`) e a etapa "desejada" = pendência do Git se houver, senão o valor do Notion. `backfill` roda no ciclo quando `gitFlow` existe sem `backfilledAt`.
- [ ] **Step 5:** Rodar `pnpm test` — PASS. **Commit** `feat(fluxo-git): Etapa Git escrita pelos eventos do GitHub`

### Task 7: Tela do Fluxo Git, selo no quadro e E2E

**Files:**
- Create: `src/renderer/src/features/notion-workspace/GitFlowSection.tsx` (dentro do `NotionWorkspaceCard`, depois do mapeamento)
- Create: `src/renderer/src/components/GitStageToken.tsx` (ponto com a cor do Notion + nome, mono não; `data-testid="git-stage"`)
- Modify: `src/renderer/src/features/board/BoardCardView.tsx`, `BoardList.tsx`, `src/renderer/src/features/task/TaskDetails.tsx` (seção GitHub), `src/renderer/src/app/sources.tsx` se o setup vier por fonte
- Create: `e2e/git-flow.spec.ts`; Modify: `e2e/fixtures.ts` (Notion simulado com `Etapa Git` select, `PR` url, `Merge na dev` date; registra os PATCH em `notionState(app).writes`)

- [ ] **Step 1: E2E falhando** `e2e/git-flow.spec.ts`:
  - Configura o Fluxo Git pela tela ("Fluxo Git (opcional)", sugestão já preenchida, "Salvar Fluxo Git"), com a nota "PR para main aberta e Em produção continuam no Notion".
  - PR #5 para `dev` ligada à ORK-2: aberta → PATCH com a opção "PR aguardando review" e `url` da PR; `reviewDecision` CHANGES_REQUESTED → "Ajustes solicitados"; review pedida de novo → "PR aguardando review"; mergeada → "Mergeada na dev" e `date.start` = `closed_at` simulado.
  - O card da ORK-2 mostra `git-stage` com o texto "Mergeada na dev".
  - PR #6 com `base: 'main'` ligada à ORK-3: nenhum PATCH com a propriedade da etapa.
- [ ] **Step 2:** `pnpm build && xvfb-run -a pnpm e2e -- git-flow` (com `unset WAYLAND_DISPLAY GIT_ASKPASS`) — FAIL.
- [ ] **Step 3:** Implementar a seção (campos por `components/form.tsx`: `SelectField` da propriedade, quatro `SelectField` de opção com as opções do select escolhido, `SelectField` de PR e de data com "Não usar"; "Desligar Fluxo Git"; `Alert` com os avisos) e o selo (some sem valor). Conferir por print a 1000×700 e no tema claro.
- [ ] **Step 4:** `pnpm typecheck && pnpm lint && pnpm test && xvfb-run -a pnpm e2e` — PASS (inclui CSP sem violação).
- [ ] **Step 5:** Atualizar `CLAUDE.md` (resumo no topo, "Bancos do Notion", "Automações", "Quadro", "Testes") e `CHANGELOG.md` (`[Não lançado]`: "Etapa Git, link da PR e data do merge preenchidos no Notion pelos eventos do GitHub; selo da etapa no card"). **Commit** `feat(fluxo-git): tela do Fluxo Git e selo da etapa no quadro`
