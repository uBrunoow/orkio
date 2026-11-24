# Agentes, parte A: integrações, modelo e raciocínio, anexos, subagentes visíveis

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrações em grade, escolha de modelo e raciocínio (agente, passo e mensagem), anexos no
campo da sessão e os subagentes do Claude visíveis na conversa.

**Architecture:** Continua o `claude -p` stream-json; uma peça pura `shared/agent-runtime.ts`
descreve o "agente de código" (só `claude` hoje), modelos e níveis de raciocínio; o main passa
`--model`/`--effort`. Anexos são gravados pelo main em `.orkio/attachments/` do worktree e citados
no texto. Subagentes saem do `parent_tool_use_id` do stream.

**Tech Stack:** Electron, React 19, TS strict, Tailwind v4 + shadcn (Popover/cmdk), Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-23-orkio-agentes-paralelos-design.md` (partes 1–4).

## Global Constraints

- CLAUDE.md inteiro vale (CSP sem Radix Select/ScrollArea, Dialog/Menu não modais, pt-BR, renderer
  nunca manda caminho, segredos só no main, `no-console`).
- **Sem commits**: o usuário pediu para não commitar até ele mandar. Onde o fluxo da skill diz
  "Commit", apenas confira `git status`.
- Raciocínio: `EFFORTS = ['low','medium','high','xhigh','max']`, rótulos "Baixo", "Médio", "Alto",
  "Muito alto", "Máximo".
- Modelos sugeridos: `default` ("Padrão do Claude Code"), `fable`, `opus`, `sonnet`, `haiku`;
  nome livre validado por `/^[a-z][a-z0-9.\-\[\]]{0,60}$/`.
- `--effort` só quando o CLI suporta: versão ≥ `CLAUDE_EFFORT_VERSION = '2.1.300'` (call: a 2.1.331
  instalada tem a flag; abaixo disso o seletor some e a flag não vai).
- Anexos: até 5 por mensagem, 10 MB cada; png, jpeg, webp, gif, pdf, md, txt.
- Desvio registrado da spec: o raciocínio usado vai numa linha `info` do log da execução
  ("Modelo: Opus · Raciocínio: Alto"), sem coluna nova em `agent_runs`.
- Antes de encerrar: `pnpm typecheck && pnpm lint && pnpm test` e `pnpm e2e` (com
  `env -u WAYLAND_DISPLAY -u GIT_ASKPASS -u VSCODE_GIT_ASKPASS_MAIN xvfb-run -a`).

## Review Focus

1. Nome de modelo malicioso (`--model "--dangerously…"`, espaços, `;`) vindo do perfil `.md`, do
   passo ou do IPC → recusado, nunca vira argumento (teste no runner e no IPC).
2. Anexo com extensão `.png` mas conteúdo executável/HTML, ou nome `../../x` → recusado / nome
   saneado; nunca grava fora de `.orkio/attachments/` (teste em `attachments.test.ts`).
3. Perfil de agente antigo (sem `effort`, `model: sonnet`) → lê igual e serializa igual (teste).
4. Log `.jsonl` antigo sem `parent` → transcrição igual à de hoje (teste em `run-transcript`).
5. Mensagem com anexo enquanto o fluxo roda (interromper e continuar) → anexos seguem com o texto
   (teste no `claude.service`).

---

### Task 1: Integrações em grade

**Files:**
- Modify: `src/renderer/src/features/integrations/IntegrationsPage.tsx`
- Create: `src/renderer/src/features/integrations/IntegrationCard.tsx`
- Delete (se ficar sem uso): `src/renderer/src/features/integrations/IntegrationRow.tsx`
- Modify: E2E que usam o catálogo (`grep -rn "Catálogo de integrações\|IntegrationRow\|integration-" e2e`)

**Interfaces:**
- Produces: `IntegrationCard({ id, logo, logoClassName, name, category, status: {label, tone}, action, open, onAction, children? })`
  — `article` com `aria-labelledby` no nome; botão com nome acessível "`<ação>` <nome>".

- [ ] **Step 1:** Reescrever a página: `PageHeader` "Integrações" com o subtítulo atual; linha de
  topo "N de M prontas" + campo "Buscar integração" (`/` foca, filtra por nome/categoria);
  seções `section aria-label` "Tarefas" (Notion; "Bancos e campos" como card logo depois),
  "Código" (GitHub, GitHub CLI), "Agentes de código" (Claude Code; "Plugins e comandos").
  Grade `grid grid-cols-1 min-[900px]:grid-cols-2 gap-2`. Card: `rounded-xl border border-border-soft bg-card`,
  logo 32 px, nome `text-sm`, categoria `font-mono text-2xs text-subtle-foreground`, `StatusDot` + texto,
  botão `variant="secondary" size="sm"`.
- [ ] **Step 2:** Configuração aberta: um card aberto por vez por página; o painel abre como linha
  inteira (`col-span-full`) logo abaixo do card, com o componente de hoje
  (`NotionConnectionCard`, `NotionWorkspaceCard`, `GitHubConnectionCard`, `ClaudeCodeCard`,
  dica do `gh`). Mantém a regra atual "pendente abre sozinha; ficou pronta nesta visita continua aberta"
  (reusar a lógica `wasPending`/`justReady`). Remover a nota da borda laranja do rodapé.
- [ ] **Step 3:** Ajustar os E2E que achavam as linhas (`list "Catálogo de integrações"`, botões
  "Conectar"/"Gerenciar") para os novos nomes acessíveis. Rodar:
  `env -u WAYLAND_DISPLAY -u GIT_ASKPASS xvfb-run -a pnpm exec playwright test e2e/notion.spec.ts e2e/github.spec.ts e2e/setup.spec.ts e2e/claude.spec.ts`
  (rodar `pnpm build --mode e2e` antes, como o `pnpm e2e` faz). Esperado: todos passam.
- [ ] **Step 4:** Print com `SHOT_DIR` (`e2e/zz-preview.spec.ts`) da tela e comparar com a imagem do
  Marketplace (grade, densidade). `pnpm typecheck && pnpm lint`.

### Task 2: `shared/agent-runtime.ts` (puro)

**Files:**
- Create: `src/shared/agent-runtime.ts`, `src/shared/agent-runtime.test.ts`

**Interfaces:**
- Produces:
  - `type AgentRuntimeId = 'claude'`
  - `const EFFORTS = ['low','medium','high','xhigh','max'] as const; type Effort`
  - `const EFFORT_LABELS: Record<Effort, string>`
  - `const CLAUDE_MODELS: readonly { id: string; label: string }[]` (default, fable, opus, sonnet, haiku)
  - `isModelName(v: unknown): v is string` (regex acima; `default` vale)
  - `isEffort(v: unknown): v is Effort`
  - `interface RuntimeChoice { model: string | null; effort: Effort | null }` (`null` = não passa a flag)
  - `resolveRuntime(...layers: (Partial<RuntimeChoice> | null | undefined)[]): RuntimeChoice` — o
    primeiro valor definido (≠ `undefined`) de cada campo vence; `'default'` vira `null`.
  - `runtimeLabel(c: RuntimeChoice): string` — "Padrão do Claude Code", "Opus", "Opus · Alto",
    nome livre como está.
  - `CLAUDE_EFFORT_VERSION = '2.1.300'`

- [ ] **Step 1: testes**
  - `resolveRuntime({ model: 'opus' }, { model: 'sonnet', effort: 'high' })` → `{ model: 'opus', effort: 'high' }`
  - `resolveRuntime({ model: 'default' }, { model: 'sonnet' })` → `{ model: null, effort: null }`
  - `resolveRuntime(null, undefined)` → `{ model: null, effort: null }`
  - `isModelName('claude-sonnet-5-5[1m]')` true; `isModelName('--model')`, `'a b'`, `'x;rm'`, `''`, 61+ chars → false
  - `isEffort('xhigh')` true; `isEffort('ultra')` false
  - `runtimeLabel({ model: 'opus', effort: 'high' })` → `'Opus · Alto'`; `{ model: null, effort: null }` → `'Padrão do Claude Code'`
- [ ] **Step 2:** `pnpm vitest run src/shared/agent-runtime.test.ts` → FAIL; implementar; → PASS.

### Task 3: perfil do agente com modelo livre e raciocínio

**Files:**
- Modify: `src/shared/agent.ts` (tipo `AgentProfile`, parse, validação, serialize, `AGENT_MODELS` vira sugestão)
- Modify: `src/shared/agent.test.ts`, `src/shared/agent-presets.ts` (sem mudança de conteúdo, só tipos)
- Modify: `src/main/flows/flow-runner.ts:1444` (`runAgent` passa `effort`), `src/main/claude/run.service.ts:118` (`RunAgent.effort: Effort | null`)

**Interfaces:**
- Consumes: Task 2 (`isModelName`, `isEffort`, `Effort`)
- Produces: `AgentProfile.model: string` (`'default'` ou nome válido), `AgentProfile.effort: Effort | null`;
  `RunAgent { key; name; prompt; model: string | null; effort: Effort | null }`

- [ ] **Step 1: testes** em `agent.test.ts`:
  - perfil com `model: "claude-opus-5-5"` e `effort: "high"` → parse ok, serializa as duas chaves;
  - perfil antigo sem `effort` → `effort: null`, `serializeAgent` não escreve `effort` (texto idêntico ao de antes);
  - `model: "--x"` → agente `invalid` com motivo "Modelo inválido";
  - `effort: "ultra"` → `invalid` com motivo "Raciocínio inválido".
- [ ] **Step 2:** FAIL → implementar (chave `effort` entra em `KNOWN_KEYS`; validação usa `isModelName`) → PASS.
- [ ] **Step 3:** `pnpm typecheck` e corrigir os usos de `AgentModel` (editor de agentes usa a lista
  de sugestão; a UI nova vem na Task 5).

### Task 4: `--model`/`--effort` do agente, do passo e da mensagem até o CLI

**Files:**
- Modify: `src/main/claude/runner.ts` (opção `effort?: Effort | null`; `--effort` só com `isEffort`; `--model` usa `isModelName` em vez de `MODEL_ALIAS`)
- Modify: `src/main/claude/run.service.ts` (`createRun` recebe `effort`; `StartRunInput.runtime?: Partial<RuntimeChoice> | null`; resolve `resolveRuntime(input.runtime, agent)`; linha `info` "Modelo: X · Raciocínio: Y" quando algum vier definido)
- Modify: `src/main/claude/detect.ts` (`ClaudeCodeStatus.supportsEffort: boolean`) e `src/shared/agent-run.ts`
- Modify: `src/main/claude/claude.service.ts` (`send` lê `req.runtime`; `startForFlow` recebe `runtime`; sem suporte a effort → descarta `effort`)
- Modify: `src/shared/agent-run.ts` (`SendMessageRequest.runtime?: Partial<RuntimeChoice>`), `src/main/ipc/claude.ipc.ts:76` (valida com `isModelName`/`isEffort`)
- Modify: `src/shared/task-flow.ts` (`ClaudeCommandStep.model?: string; effort?: Effort`; validação: modelo inválido = erro), `src/main/config/orkio-config.ts:461` (`parseStep` lê os dois, opcionais), `src/main/flows/flow-runner.ts:1175` (passa `runtime: { model: step.model, effort: step.effort }`)
- Modify: `e2e/fake-claude/claude` (grava `model` e `effort` em `agent-args.log`)
- Test: `runner.test.ts`, `run.service.test.ts`, `claude.service.test.ts`, `claude-pure.test.ts` (IPC), `src/shared/task-flow.test.ts`, `src/main/config/orkio-config.test.ts`

**Interfaces:**
- Consumes: Tasks 2–3
- Produces: `SendMessageRequest.runtime?: Partial<RuntimeChoice>`; `ClaudeCodeStatus.supportsEffort`;
  `ClaudeCommandStep.model?`/`effort?`; ordem de precedência **mensagem > passo > agente > padrão**.

- [ ] **Step 1: testes**
  - runner: `{ model: 'opus', effort: 'high' }` → args contêm `--model opus --effort high`; `effort: 'ultra' as never` → sem `--effort`; `model: '--x'` → sem `--model`.
  - run.service: agente `{ model: 'sonnet', effort: null }` + `runtime: { effort: 'max' }` → `createRun` com `model: 'sonnet', effort: 'max'` e log `info` "Modelo: Sonnet · Raciocínio: Máximo".
  - claude.service: `supportsEffort: false` → `effort` descartado; mensagem com `runtime` passa adiante no `--resume`.
  - IPC: `runtime: { model: 'a b' }` → inválido; `{ effort: 'low' }` → válido.
  - parseStep: passo com `model: 'opus', effort: 'low'` preserva; sem os campos, objeto igual ao de antes.
  - validateTaskFlow: `model: '--x'` → erro "modelo inválido".
- [ ] **Step 2:** FAIL → implementar → PASS (`pnpm vitest run src/main/claude src/shared src/main/config`).

### Task 5: seletor de modelo e raciocínio na UI

**Files:**
- Create: `src/renderer/src/features/claude/RuntimePicker.tsx`
- Modify: `src/renderer/src/features/claude/SessionComposer.tsx` (rodapé: `RuntimePicker` à esquerda de "Ctrl ⏎ enviar"; manda `runtime` no `send`)
- Modify: editor de agentes (`features/agents/AgentsPage.tsx`, campo Modelo → `RuntimePicker` com raciocínio)
- Modify: editor do passo do fluxo (`grep -rn "includeBriefing" src/renderer/src/features/task-flows`) → `RuntimePicker` opcional ("Do agente" = sem valor)
- Test: `e2e/claude.spec.ts` (novo teste), `e2e/agents.spec.ts` (ajuste)

**Interfaces:**
- Consumes: Task 2 (listas e rótulos), Task 4 (`supportsEffort`, `runtime`)
- Produces: `RuntimePicker({ value: Partial<RuntimeChoice>, onChange, supportsEffort, inheritLabel?: string })`
  — gatilho `button` com nome "Modelo e raciocínio: <runtimeLabel>"; Popover (não modal) com cmdk:
  grupo "Modelo" (sugestões + "Outro…" com campo validado) e `SegmentedControl` "Raciocínio"
  (Padrão + 5 níveis; some sem `supportsEffort`). `inheritLabel` (ex. "Do agente: Opus") aparece como
  primeira opção e limpa o valor.

- [ ] **Step 1: E2E** (`claude.spec.ts`): abrir a tarefa, escolher "Opus" e "Alto" no seletor,
  enviar "oi" → `agent-args.log` tem `model: "opus"` e `effort: "high"`; mandar outra mensagem sem
  mexer → a escolha da mensagem anterior **não** fica (seletor volta ao herdado).
- [ ] **Step 2:** implementar; rodar o spec → PASS; `agents.spec.ts` → PASS.

### Task 6: anexos no campo da sessão

**Files:**
- Create: `src/main/claude/attachments.ts`, `src/main/claude/attachments.test.ts`
- Modify: `src/shared/agent-run.ts` (`SendMessageRequest.attachments?: { name: string; mime: string; data: Uint8Array }[]`), `src/main/ipc/claude.ipc.ts` (valida quantidade, tamanho, tipo, nome ≤ 120)
- Modify: `src/main/claude/claude.service.ts` (`send`: grava antes de iniciar e acrescenta ao texto; também quando a mensagem vai para o fluxo via `flowMessage`)
- Modify: `SessionComposer.tsx` (clipe + soltar + faixa de anexos)
- Test: `claude.service.test.ts`, `e2e/claude.spec.ts`

**Interfaces:**
- Produces:
  - `ATTACHMENT_LIMITS = { maxFiles: 5, maxBytes: 10 * 1024 * 1024 }`
  - `sniffAttachment(name: string, data: Uint8Array): { ok: true; ext: 'png'|'jpg'|'webp'|'gif'|'pdf'|'md'|'txt' } | { ok: false; message: string }` — assinatura de bytes para imagens/PDF; `.md`/`.txt` exigem UTF-8 válido sem NUL.
  - `safeAttachmentName(name: string): string` — só `[A-Za-z0-9._-]`, sem pontos iniciais, ≤ 80.
  - `saveAttachments(worktree: string, files: {name; data}[]): Promise<string[]>` → caminhos relativos `.orkio/attachments/<sha8>-<nome>` (0600, `mkdir -p`).
  - `attachmentNote(paths: string[]): string` → `"\n\nAnexos (leia com a ferramenta Read): " + paths.join(', ')`.

- [ ] **Step 1: testes** (`attachments.test.ts`): PNG real → ok `png`; bytes `<html>` com nome `x.png` → recusa "O arquivo x.png não é uma imagem PNG."; `../../a.md` → nome `a.md` dentro de `.orkio/attachments/`; 11 MB → recusa "maior que 10 MB"; texto com NUL → recusa.
- [ ] **Step 2: testes** (`claude.service.test.ts`): `send` com anexo → texto enviado termina com a nota; com `flowMessage` usado, o texto passado ao fluxo também tem a nota; o log/evento não contém o conteúdo.
- [ ] **Step 3:** FAIL → implementar → PASS.
- [ ] **Step 4: E2E:** anexar `nota.md` pelo `input[type=file]` (`setInputFiles` com buffer), enviar → o arquivo existe em `.orkio/attachments/` do worktree e o prompt registrado cita o caminho.

### Task 7: subagentes do Claude na conversa

**Files:**
- Modify: `src/shared/agent-run.ts` (`tool.parent?: string`; novo `{ kind: 'subagent'; id: string; title: string; agentType: string | null; background: boolean; at: string }`)
- Modify: `src/main/claude/stream.ts` (com `parent_tool_use_id` → `tool.parent`; `Task`/`Agent` na conversa principal → também emite `subagent` com `at = now().toISOString()`)
- Modify: `src/renderer/src/features/claude/run-transcript.ts` (item `subagents`), `RunTranscript.tsx` (render)
- Create: `src/renderer/src/features/claude/SubagentGroup.tsx`
- Modify: `TaskPanel.tsx`/bloco acima do campo: "Esperando N subagentes: …" quando houver subagentes `running` na execução ativa
- Modify: `e2e/fake-claude/claude` (cenário `subagentes`: 2 `Task` com eventos filhos e resultados)
- Test: `stream` tests (`claude-pure.test.ts` ou o teste do stream), `run-transcript.test.ts`, `e2e/claude.spec.ts`

**Interfaces:**
- Produces: `TranscriptItem` `{ kind: 'subagents'; key; agents: { id; title; type: string | null; tools: number; state: 'running'|'done'|'failed'|'background'; at: string }[] }`
  — subagentes lançados sem texto da conversa principal entre eles ficam no mesmo item; eventos com `parent` não entram no grupo de trabalho principal (contam em `tools` do subagente).

- [ ] **Step 1: testes**
  - stream: linha `assistant` com `parent_tool_use_id: "t1"` e `tool_use Read` → `tool` com `parent: 't1'`; `tool_use Task {description:'Revisar API', subagent_type:'review-agent'}` na principal → `tool` + `subagent { title: 'Revisar API', agentType: 'review-agent', background: false }`; `run_in_background: true` → `background: true`.
  - transcript: dois `subagent` seguidos + 3 `tool` com `parent` + `tool_result` do primeiro → um item com `[done, tools 2]`, `[running, tools 1]`; log sem `parent`/`subagent` → saída igual ao snapshot de hoje.
- [ ] **Step 2:** FAIL → implementar → PASS.
- [ ] **Step 3:** `SubagentGroup`: cabeçalho "N subagentes · K trabalhando" com `StatusDot` (running = laranja), linhas (título, tipo em mono, "N ferramentas", estado); recolhível (`Collapsible`), aberto enquanto algum roda.
- [ ] **Step 4: E2E** (cenário `subagentes`): a conversa mostra "2 subagentes" com os dois títulos e, ao terminar, "concluído".

### Task 8: documentação e verificação final

**Files:** `CLAUDE.md` (Integrações, Agentes 8A: modelo/raciocínio, Sessão da tarefa: anexos e subagentes, E2E do simulado), `CHANGELOG.md` ([Não lançado] › Adicionado)

- [ ] **Step 1:** atualizar os textos.
- [ ] **Step 2:** `pnpm typecheck && pnpm lint && pnpm test` → tudo verde.
- [ ] **Step 3:** `env -u WAYLAND_DISPLAY -u GIT_ASKPASS -u VSCODE_GIT_ASKPASS_MAIN -u VSCODE_GIT_ASKPASS_NODE xvfb-run -a pnpm e2e` → tudo verde (anotar falhas preexistentes, se houver).

---

## Acréscimos pedidos pelo usuário (rodam antes da Task 8)

Origem: o usuário não conseguiu abrir a PR de uma conversa (push/`gh pr` bloqueados fora do modo
entrega, sem caminho na tela) e viu o custo subir US$ 7,56 → 7,83 → 7,97 → 8,06 a cada mensagem.

### Task 9: botão "Abrir PR" (entrega avulsa)

**Files:**
- Modify: `src/shared/alva-templates.ts` (novo `alvaOpenPrFlow(): Flow`, id `ALVA_TEMPLATE_IDS.openPr = 'builtin:abrir-pr'`, nome "Abrir PR", tags `['alva']`: `PUSH()` → `alva('pr', 'Pull Request (/pr, modo entrega)', 'pr', '{{alva.task_id}}', 60, { delivery: true })`; **não** entra em `alvaTemplates()`)
- Modify: `src/main/flows/flow-runner.ts` (`startBuiltin(projectId, taskId, flow: Flow): Promise<FlowRunView>` — mesmo caminho do `startById`, sem acompanhar a etapa; a cópia vai para `flow_json` como sempre)
- Modify: IPC `taskFlows.openPr(projectId, taskId)` (shared/ipc-contract, ipc/task-flows.ipc.ts, preload) → com vínculo do Backlog.md (`alva.task_id`) e plugin alva-flow: `startBuiltin(alvaOpenPrFlow())`; sem vínculo/plugin: só o push pelo Orkio (ação `push` com o mesmo gate) e devolve `compareUrl` = `https://github.com/<owner>/<repo>/compare/<default>...<branch>?expand=1` para "Criar a PR no GitHub" (acrescentar a regra em `EXTERNAL_URL_RULES`: host github.com, prefixo `/<owner>/<repo>/compare/` validado no main)
- Modify: aba **PR & CI** do painel da tarefa: sem PR aberta e com commits à frente da base → botão primário "Abrir PR" (desabilitado com fluxo ativo: "Espere o fluxo atual terminar"); com PR → nada novo
- Test: `alva-templates.test.ts` (fluxo válido em `validateTaskFlow`; passo `pr` com `delivery: true`), `flow-runner.test.ts` (`startBuiltin` cria execução com a cópia do fluxo e recusa com fluxo ativo), IPC test (payload), `e2e/delivery.spec.ts` ou o spec de entrega existente (botão → gate do push → aprovar → `/alva-flow:pr` roda com modo entrega; `gh-calls.log` tem `pr create`)

**Interfaces:**
- Produces: `alvaOpenPrFlow()`, `FlowRunner.startBuiltin(projectId, taskId, flow)`, `window.orkio.taskFlows.openPr(projectId, taskId) → Result<{ started: true } | { pushed: true; compareUrl: string }>`

### Task 10: recibo do bloqueio explica o caminho

**Files:**
- Modify: `src/main/claude/policy.ts:60-63` (`POLICY_MESSAGES.push`/`gh`: manter o começo atual e acrescentar " Para publicar, use “Abrir PR” na aba PR & CI da tarefa.")
- Modify: o texto das regras que o Orkio manda ao agente (`grep -rn "não faça push" src/`): trocar por "Não faça push nem abra PR: o Orkio faz isso pelo botão “Abrir PR” (ou pelo passo de entrega do fluxo). Se o usuário pedir, diga isso a ele." 
- Modify: transcrição: recibo `run_blocked` de push/gh ganha ação "Abrir PR" (mesmo IPC da Task 9) quando a tarefa não tem PR
- Test: `policy.test.ts` (texto novo), `flow-problem.test.ts` continua reconhecendo os textos (os trechos usados nas regex não mudam), `run-transcript.test.ts` se o item mudar

### Task 11: custo por mensagem, não acumulado da sessão

**Files:**
- Modify: `src/main/claude/run.service.ts` (no `result`: com `--resume <S>`, custo desta execução = `max(0, total - custoAnteriorDaSessão)`, onde `custoAnteriorDaSessão` = maior `total` bruto já visto para `S`; guardar o bruto por sessão — coluna nova `session_cost_total REAL` em `agent_runs` via migração nova em `MIGRATIONS` — e gravar em `cost` o delta; sem `--resume` = valor como veio)
- Modify: o evento `result` do log mantém o `costUsd` = delta (a UI e a "Semana" somam deltas)
- Test: `run.service.test.ts`: sessão nova US$ 7,56 → `cost` 7,56; resume com total 7,83 → `cost` 0,27; resume com total menor que o anterior (CLI reiniciou a conta) → `cost` = total; `database.test.ts` (migração)
- Ruling registrado: confirmar com o stream real que `total_cost_usd` é acumulado no `--resume` (os números do usuário indicam que sim); o teste fixa o comportamento.

### Task 12: cartão da PR ao passar o mouse (como no Claude Desktop)

**Files:**
- Modify: `src/main/signals/github-signals.source.ts` (`detailsQuery`: + `title additions deletions changedFiles createdAt author { login }`; `parseDetails` lê os novos campos; logins só em memória, como hoje) e `src/shared/task-signals.ts` (`PullRequestDetails`/`pr` ganham `additions?`, `deletions?`, `changedFiles?`, `author?`)
- Create: `src/renderer/src/features/board/PrHoverCard.tsx` (HoverCard do shadcn — conferir no `test/renderer-csp-guard.test.ts` que não injeta `<style>`; se injetar, Popover aberto por hover/foco)
- Modify: onde o chip da PR aparece (`grep -rn "#\${pr.number}\|pr-chip\|PrChip" src/renderer/src`): card do quadro, painel/aba PR & CI, lista lateral se houver
- Conteúdo: título (2 linhas), `owner/repo #n` mono apagado, avatar com inicial + login + "há 6 h" (`Timestamp`), `+4579` (ok) `−1099` (danger) `· 127 arquivos`, e a pílula de estado: Mudanças pedidas (danger), Aprovada (ok), Revisão pendente (neutro), Rascunho, Mergeada, Fechada; CI (ok/falhou/rodando) e "N comentários sem resposta" quando houver. Campo desconhecido (GraphQL falhou) simplesmente não aparece.
- Test: `github-signals.source.test.ts` (query contém os campos; parse dos números), E2E no spec de sinais/quadro (hover no chip → cartão com título, `+N −M`, "Mudanças pedidas")

### Task 13: revisões da PR com a conta OAuth (bug do usuário) + aviso no Quadro

Causa provável (a confirmar pelo aviso em Projetos › "Ver tarefas"): `detailsQuery` pede
`requestedReviewer { ... on Team { slug } }`, que exige `read:org`; o "Conectar com GitHub" só pede
`repo`. Falta de escopo é checada na validação da query → `data: null` → o cliente lança → nenhum
detalhe (threads, reviews, CI) chega e as regras de revisão da 3B nunca disparam.

**Files:**
- Modify: `src/main/signals/github-signals.source.ts` (`detailsQuery`: tirar o fragmento `... on Team { slug }`; time vira revisor sem login — `reviewerOf` já tolera; se o pedido de review a times da 5C depender disso, ele passa a pedir só usuários e o motivo vai no relatório) e o tratamento de erro: com `errors` e `data` parcial, usar o que veio
- Modify: `src/main/connectors/github/github.client.ts:204-219` (mensagem de escopo clara: "A conexão do GitHub não tem permissão para parte dos detalhes das PRs (escopo read:org).")
- Modify: Quadro: os avisos dos sinais (`signals.result.messages`) aparecem também no Quadro, perto de "Atualizar" (hoje só em Configurações › Projetos › "Ver tarefas")
- Test: `github-signals.source.test.ts` (a query não contém `on Team`; resposta parcial com `errors` ainda devolve detalhes), E2E do GitHub simulado: responder GraphQL com `INSUFFICIENT_SCOPES` quando a query tiver `on Team` (fixture), provando que a leitura funciona; aviso no Quadro

### Task 14: painel "Ambiente" (estilo da coluna do Claude Desktop)

Pedido do usuário (print do Claude Desktop): Environment, Context %, Changes com Create PR, Keep
computer awake. Files, Servers, Background tasks, Side chat e terminal embutido ficam para a
"Parte D" (spec própria).

**Files:**
- Create: `src/renderer/src/features/task/EnvironmentPanel.tsx` (seção no topo da aba Detalhes do painel da fase, ou bloco próprio acima das abas — escolher o que couber melhor no mockup):
  - **Ambiente:** projeto, pasta de trabalho (nome curto, mono), branch da tarefa (mono), botões "Abrir no Cursor/VS Code" (já existem) e **"Abrir terminal aqui"** (novo, IPC `claude.openTerminal(projectId, taskId)`: main resolve o worktree e abre o terminal do sistema com `spawn` sem shell — Linux: `x-terminal-emulator`, senão `gnome-terminal --working-directory`, `konsole --workdir`, `xfce4-terminal --working-directory`; macOS: `open -a Terminal <dir>`; Windows: `wt -d <dir>`, senão `cmd /c start`… sem shell → usar `cmd.exe` com args fixos; sem terminal achado → erro pt-BR)
  - **Contexto:** "Contexto: 41%" com barra fina — % = tokens de entrada do último turno (input + cache_read + cache_creation do `usage` da última mensagem `assistant` principal) ÷ janela do modelo (200 000 padrão; 1 000 000 quando o modelo tem `[1m]`); `stream.ts` passa a emitir `{ kind: 'usage', inputTokens, contextWindow }` (só números)
  - **Mudanças:** `+N −M` da branch contra a base (do `claude.diff` já existente, `--shortstat`) + botão "Abrir PR" (Task 9) ou o chip da PR com estado e CI ("1 falhando")
- Modify: `src/main/index.ts` / power: **"Manter o computador acordado enquanto agentes rodam"** — interruptor em Configurações › Atualizações→ "App" (ou Sobre), `orkio-config` campo opcional `keepAwake: boolean` (padrão falso); main usa `powerSaveBlocker.start('prevent-app-suspension')` quando há execução do Claude rodando ou fluxo `running` e para quando não há (reaproveitar `busy.ts`)
- Test: unitários do cálculo de contexto (stream + função pura `contextPercent`), do `keepAwake` (liga/desliga com ocupado, injetando o `powerSaveBlocker`), do comando de terminal por plataforma (puro: `terminalCommand(platform, env, dir)`); E2E: painel mostra branch, "+N −M" e "Contexto"; "Abrir terminal aqui" chama o spawn simulado (stub via `app.evaluate`, como os diálogos)

### Task 15: o Orkio lê as threads da PR (texto) + aba "Revisão"

Pedido do usuário: ao entrar em Revisado, ser avisado, ver um resumo do que o agente vai corrigir e
aprovar / recusar / pedir ajustes. Hoje o agente nem consegue ler os comentários fora do modo
entrega (`gh pr`/`gh api` bloqueados), então quem lê é o Orkio.

**Files:**
- Modify: conector/fonte do GitHub (`github-signals.source.ts` ou novo `main/signals/review-threads.ts`): `reviewThreads(owner, repo, number)` por GraphQL **só com campos do escopo `repo`**: `reviewThreads(first: 50) { nodes { id isResolved isOutdated path line comments(first: 20) { nodes { author { login } body createdAt url } } } }` + `reviews(last: 20) { nodes { state body submittedAt author { login } } }`. Texto passa por `redactSecrets`, corte por comentário (4 000 caracteres) e total (60 000); só em memória, cache 60 s; nada no SQLite nem no snapshot da 3B
- Create: IPC `signals.reviewThreads(projectId, taskId)` (só ids no payload; o main acha a PR da tarefa pelos sinais) → `{ pr: {number,url}, threads: [{ id, resolved, outdated, path, line, comments: [{ author, body, at, url }] }], reviews: [...] }`
- Create: ação de fluxo `review_snapshot` (registro de ações do Orkio): grava `<worktree>/.orkio/revisao.md` (só threads **não resolvidas**: `path:line`, autor, texto, link) e as variáveis `review.count` (n) e `review.pr` (número); sem PR → falha do passo com mensagem pt-BR
- Create: aba **"Revisão"** no painel da fase (depois de "PR & CI"; aparece quando a tarefa tem PR): threads não resolvidas primeiro (arquivo:linha mono, autor, texto em `MarkdownText`, link "Abrir no GitHub" — allowlist já cobre `/pull/`), resolvidas recolhidas; `defaultPanelTab`: fase "Revisão" abre esta aba
- Test: parse/limites/redação (unit), `review_snapshot` grava o arquivo e as variáveis (unit, worktree temporário), IPC payload, E2E: fake GraphQL devolve threads com texto → aba Revisão mostra; fluxo com `review_snapshot` cria `.orkio/revisao.md`

### Task 16: plano de correção aprovado por você antes de corrigir

**Files:**
- Modify: `src/shared/task-flow.ts` — `ClaudeCommandStep` ganha `prompt?: string` (template com as mesmas variáveis; com `prompt`, `command` fica vazio e a execução é modo `prompt` na **sessão mais recente da tarefa** se houver, senão nova com o briefing) e `readOnly?: boolean` (o CLI recebe `--disallowedTools` para Edit/Write/MultiEdit/NotebookEdit — conferir a flag em `claude --help`; a política continua igual); validação: `command` ou `prompt` obrigatório
- Modify: `GateStep` ganha `show: 'result'` (texto final da última execução do Claude no fluxo, em `MarkdownText`) e `revise?: { step: StepId; max: number }` → o cartão do gate mostra **"Pedir ajustes…"** (campo de texto); `FlowRunner.reviseGate(taskId, text)` (IPC `taskFlows.reviseGate`): `redactSecrets`, guarda em `pendingReply` do passo `revise.step` e salta para ele (o passo continua a mesma sessão com o seu texto); passou de `max` voltas → botão desabilitado "Limite de ajustes atingido"
- Modify: `orkio-config` parse (`parseStep`): campos novos opcionais (`prompt`, `readOnly`, `show: 'result'`, `revise`)
- Modify: `src/shared/alva-templates.ts` — "Alva: comentários da PR" (coluna Revisado) passa a ser:
  1. `review_snapshot` → 2. branch `review.count == 0` → `$fim`
  3. `plano-correcoes` (prompt, `readOnly`): "Leia .orkio/revisao.md (comentários de revisão não resolvidos da PR #{{review.pr}}). Para cada um, diga o que vai mudar e onde, ou por que não vai mudar. Não altere arquivos. Responda só com o plano, em pt-BR, numerado na ordem dos comentários."
  4. gate `aprovar-correcoes` (`show: 'result'`, mensagem "Aprovar correções da PR #{{review.pr}}", `revise: { step: 'plano-correcoes', max: 3 }`, `onReject: 'stop'`)
  5. `aplicar-correcoes` (prompt, `delivery: true`): "Plano aprovado. Aplique as correções, rode os testes do projeto, faça o commit e responda cada thread no GitHub dizendo o que foi feito (resolva as que foram corrigidas)."
  6. `verify_pushed` → push pelo Orkio (gate de push) → `request_review`
  Fluxos já salvos não mudam: na tela alva-flow, o modelo atualizado aparece como "Atualizar modelo" (ou o usuário recria) — escolher o caminho mais simples que já exista e dizer no relatório
- Notificação: o gate já notifica; conferir que o título fica "Aprovar correções da PR #13" no sino/lista lateral
- Test: `task-flow.test.ts` (validação de prompt/readOnly/revise), `flow-runner.test.ts` (reviseGate: guarda o texto, volta ao passo, conta voltas, limite; aprovar segue; recusar encerra), runner (`--disallowedTools` com readOnly), E2E (fake CLI: cenário de plano; gate mostra o plano; "Pedir ajustes" → nova execução com o texto via `--resume`; aprovar → `aplicar-correcoes` roda em modo entrega)

### Task 17: rota `/github/review-token` no site + `GitHubReviewPoster` no app

**Files:**
- Create: `site/app/github/review-token/route.ts`, `site/lib/github-app.ts` (+ teste) — JWT RS256 com `node:crypto` (sem dependência nova), chamadas ao GitHub com `fetch` injetável, timeout 10 s, limitador de `site/lib/rate-limit.ts`, sem `console.*` (lint do site já proíbe); envs `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY` (aceitar `\n` escapado), `GITHUB_API_URL` só fora da Vercel e em `http://127.0.0.1` (E2E), como o `NOTION_TOKEN_URL`
- Create: `src/main/connectors/github/review-poster.ts` (+ teste): `requestToken(owner, repo)` via site (URL base = origem do intermediário já configurado `MAIN_VITE_NOTION_OAUTH_BROKER_URL`, ou nova `MAIN_VITE_SITE_URL` se já existir — usar a que o "Sobre" usa), `postReview(owner, repo, number, review)`; o conector do GitHub expõe só um método que recebe o token do usuário internamente (`withAccessToken`), o token nunca sai do main
- Modify: `docs/` — `docs/github-app.md` (passo a passo: criar o App, permissões, chave na Vercel, instalar no repo)
- Test: site (vitest do site: JWT, sem push → 403, App não instalado → `not_installed`, sucesso com token restrito ao repo e permissão `pull_requests: write`, nenhum log), app (unit do poster: APPROVE recusado, owner/repo/número inválidos recusados, cache do token, mensagens pt-BR), E2E `@site` se o fixture `brokerTarget` permitir (senão só unit)

### Task 18: passo "Publicar revisão na PR (Orkio)" + gate + modelo

**Files:**
- Create: ação `publish_review` no registro de ações (`delivery-actions.ts` ou `review-actions.ts`), com `confirm`: lê e valida `.orkio/review.json` (`event` ∈ COMMENT|REQUEST_CHANGES; `summary` ≤ 20 000; até 50 comentários, cada `path` no diff da PR e `line` dentro de um hunk do lado RIGHT — usar o diff da PR via REST `pulls/{n}/files` pelo conector), mostra no gate (resumo em `MarkdownText`, lista de comentários `arquivo:linha`, pílula "Pedir alterações"/"Comentar"); aprovar → `postReview`; histórico `delivery` `review_post` com link
- Modify: `src/shared/alva-templates.ts`: novo modelo "Alva: revisão publicada" (`/alva-flow:review` → prompt `readOnly`: "Converta a revisão acima em .orkio/review.json no formato {event, summary, comments:[{path,line,body}]} — event REQUEST_CHANGES se houver achado bloqueante, senão COMMENT; só achados com arquivo e linha do diff" (pode escrever só esse arquivo: readOnly bloqueia Edit/Write → usar exceção: o passo de prompt com `writeOnly: ['.orkio/review.json']`? Mais simples: o agente responde só com o JSON e o Orkio grava o arquivo a partir do texto final, validado) → `publish_review`)
- Test: unit da validação do JSON e do casamento com o diff; flow-runner (gate e aprovação chamam o poster simulado); E2E com o site/poster simulado: revisão vira "Pedir alterações" postada (fake GitHub registra o POST) e a regra "Alterações pedidas → Revisado" move a tarefa
- **Acréscimo:** fluxo ligado por padrão a "Revisando" (e o de comentários a "Revisado") — ver `task-18-brief.md` (ligações padrão + migração da config que só preenche etapa sem fluxo; Revisor pode rodar `publish_review`)
