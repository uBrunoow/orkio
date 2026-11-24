# Orkio: agentes trabalhando enquanto as tarefas chegam (design)

Data: 2026-11-23. Inspirado no CompozyOS (github.com/compozy/compozy), analisado nesta data.
Branch: `feat/controle-do-fluxo` (sem commit até o usuário pedir).

## Intenção e porquê

O usuário quer um "Claude Desktop melhorado": agentes pegam as tarefas que chegam do Notion e
trabalham sozinhos; ele só entra para **aprovar a spec, aprovar o plano e ler o code review da
PR**. Hoje o Orkio roda um Claude Code por tarefa, com modelo só por alias (`sonnet`/`opus`/
`haiku`), sem raciocínio, sem anexos, sem ver os subagentes que o Claude abre e sem começar
nada sozinho (o orquestrador deixou de puxar da fila nesta mesma branch, porque a tarefa
começava sem o usuário entendê-la).

O ponto de equilíbrio: começar sozinho **só até a spec**. Aprovar a spec é o momento em que o
usuário entende a tarefa; antes disso o agente não implementa nada.

## Objetivos

1. **Integrações em grade** (como o Marketplace do compozy): seções por categoria, cards com
   logo, nome, categoria, estado e ação; clicar abre a configuração que já existe.
2. **Modelo e raciocínio** por agente, por passo de fluxo e por mensagem (campo da sessão), para
   o Claude Code hoje, com a peça de "agente de código" pronta para outros CLIs.
3. **Anexos** no campo da sessão (imagem, PDF, markdown, texto).
4. **Subagentes visíveis**: os subagentes que o Claude abre (ferramenta `Task`/`Agent`, ex.: o
   `/alva-flow:implement`) aparecem na conversa como um grupo "N subagentes" com o estado de cada.
5. **Começar sozinho até a spec** (opção por projeto, desligada por padrão): tarefa nova com
   descrição entra na primeira etapa de trabalho, roda o fluxo da coluna e para no gate
   "Aprovar spec".
6. **Revisão no painel**: aba "Revisão" com o resultado do `/review` mais recente e os comentários
   da PR, para o usuário ler o code review sem abrir o log.
7. **Delegar pelo Orkio**: ferramenta `orkio__delegate` (no servidor MCP que o Orkio já injeta)
   para o agente abrir execuções filhas do Orkio, com agente/modelo/raciocínio próprios, no mesmo
   worktree ou num worktree filho; o pai acorda quando os filhos terminam.

## Não objetivos (desta rodada)

- **Codex, Cursor, Gemini etc.** A interface fica pronta (`AgentRuntimeId`), mas só o Claude Code é
  implementado: o Codex não está instalado na máquina do usuário e não dá para validar.
- **ACP (Agent Client Protocol)** como camada de execução. Fica para quando entrar o 2º CLI (ver
  Abordagens).
- Marketplace que **instala** extensões, plugins ou MCPs de terceiros.
- Loops/DSL, agendamentos (cron), webhooks, "agentes sempre ligados" com check-ins.
- Reserva com prazo (lease) de tarefas: a persistência de `flow_runs` já recupera ao reabrir.

## Anti-objetivos (falharia mesmo funcionando)

- Qualquer código começar sozinho **sem o usuário ter ligado** a opção no projeto.
- Tarefa começar sozinha e **passar da spec** sem aprovação.
- Tarefa sem descrição começar.
- Afrouxar permissões: política, modo entrega, gates e `redactSecrets` valem igual para filhos.
- Renderer mandar caminho de arquivo; token/segredo em log; `<style>` em runtime (CSP).
- Baixar código a cada execução (`npx -y …@latest`, como o compozy faz).

## Abordagens

**Camada de execução dos agentes**

| Abordagem                                                                                                                                           | Troca                                                                                                                                                                                                            | Decisão                                                                                                                                                                           |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. Migrar tudo para ACP (`@agentclientprotocol/claude-agent-acp`, `codex-acp`)                                                                      | Um protocolo para todos os CLIs e lista de modelos lida do agente; mas reescreve runner, ponte de permissões, modo entrega, `--resume` e o parser do stream, com risco alto e adaptador que depende do Agent SDK | Fica para o 2º CLI                                                                                                                                                                |
| B. Manter o `claude -p` stream-json e criar a interface `AgentRuntime` (Claude nativo hoje; outros CLIs entram por ACP ou adaptador próprio depois) | Nada do que funciona muda; `--model` e `--effort` já existem no CLI 2.1.x; lista de modelos fica curada + nome livre                                                                                             | **Escolhida** (call do Claude: a proposta falava em testar ACP primeiro; ao checar, o CLI já tem `--effort`, e o Codex nem está instalado, então o teste não destrava nada agora) |

**Anexos**

| Abordagem                                                                                                            | Troca                                                                           | Decisão       |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------- |
| Blocos de imagem/documento no stream-json                                                                            | Depende do formato de entrada aceito pelo CLI e não sobrevive bem ao `--resume` | Não           |
| Salvar em `.orkio/attachments/` do worktree e citar no texto ("Anexos: …"); o Claude lê com `Read` (lê imagem e PDF) | Simples, funciona com `--resume`, fica fora do git (`.orkio/.gitignore` = `*`)  | **Escolhida** |

**Delegar** (objetivo 7)

| Abordagem                                                                                                                                             | Troca                                                                    | Decisão       |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------- |
| Ferramenta que bloqueia até os filhos terminarem (`wait`)                                                                                             | Simples, mas esbarra no tempo limite de ferramenta MCP e prende uma vaga | Não           |
| Assíncrono: o pai delega e termina o turno; o Orkio guarda e, quando todos os filhos acabam, continua a sessão do pai (`--resume`) com um aviso curto | Igual ao compozy; reaproveita `resumeWithReply`/`--resume`               | **Escolhida** |

## Decisões (do usuário e calls do Claude)

- Usuário: proposta em 6 etapas aprovada; "crie a spec e implemente com o superpowers".
- Call: "Começar sozinho até a spec" é **opção por projeto, desligada por padrão** (o usuário não
  respondeu à pergunta; isso respeita o pedido anterior de não puxar da fila).
- Call: Integrações em grade entram nesta mesma branch.
- Call: só tarefas que **aparecem depois de ligar** a opção começam sozinhas (linha de base, como
  as automações da 3B), para não disparar o backlog antigo.

## Design por parte

### 1. Integrações em grade

- `IntegrationsPage` vira catálogo: busca (`/` foca) + seções **Tarefas** (Notion; "Bancos e
  campos" como card filho), **Código** (GitHub, GitHub CLI), **Agentes de código** (Claude Code;
  sub-item "Plugins e comandos") — grade de 2 colunas (1 abaixo de ~900 px).
- Card: logo, nome, categoria em mono apagado, `StatusDot` + texto, botão (`Conectar`,
  `Gerenciar`, `Configurar`, `Como resolver`). Topo: "N prontas" (contagem) como no "4 installed".
- Clicar no botão abre a configuração do card **embaixo da seção** (mesmos componentes de hoje:
  `NotionConnectionCard`, `NotionWorkspaceCard`, `GitHubConnectionCard`, `ClaudeCodeCard`); um
  aberto por vez. Pendentes abrem sozinhas como hoje.
- Só integrações reais (regra do CLAUDE.md). Sem logos novos além dos que já existem em `icons.tsx`.
- E2E: os testes que procuram as linhas do catálogo continuam por nome acessível
  (`list "Catálogo de integrações"` vira `region`/lista por seção; ajustar fixtures).

### 2. Modelo e raciocínio

- `shared/agent-runtime.ts` (novo, puro):
  - `AgentRuntimeId = 'claude'` (união pronta para `'codex' | …`).
  - `RuntimeChoice = { runtime: AgentRuntimeId; model: string | null; effort: Effort | null }`.
  - `EFFORTS = ['low','medium','high','xhigh','max']` (os do `claude --effort`); rótulos pt-BR
    ("Baixo", "Médio", "Alto", "Muito alto", "Máximo").
  - Catálogo de modelos do Claude: `default` (padrão do usuário), `fable`, `opus`, `sonnet`,
    `haiku` + "Outro…" com nome completo validado (`/^[a-z][a-z0-9.\-\[\]]{0,60}$/`, ex.
    `claude-opus-5-5`, `claude-sonnet-5-5[1m]`).
  - `resolveRuntime(message?, step?, agent?)`: a escolha da mensagem vence a do passo, que vence a
    do agente; `null` = não passa a flag.
- Perfil do agente (`shared/agent.ts`): `model` aceita alias ou nome completo; novo campo opcional
  `effort`. `orkio: agent/v1` continua (campos novos opcionais; arquivo antigo lê igual).
  `AGENT_MODELS` vira a lista de sugestões, não a validação.
- Passo `claude_command` (5A): `model?`/`effort?` opcionais (config só com campos opcionais;
  sem subir versão se a migração não precisar).
- Runner: `--model <m>` e `--effort <e>` quando definidos (validados de novo no main).
- `detect.ts`: o status do Claude Code ganha `supportsEffort` (pela versão mínima que tem a flag;
  sem isso o seletor de raciocínio some e a flag não é passada).
- UI: `RuntimePicker` (Popover + cmdk, não modal): linha "Claude Code · Opus · Alto" no rodapé do
  `SessionComposer` (como "gpt-5.6-sol ▾" do compozy); mesmo picker no editor do agente e no
  editor do passo. A escolha da mensagem vale só para aquela mensagem.
- `claude:send` recebe `runtime?: { model, effort }`; `startForFlow` lê do passo/agente.
- Execução registra o modelo e o raciocínio usados (`agent_runs` ganha `effort`; modelo já vem do
  `init`). O `RunBlock` mostra "Opus · Alto".

### 3. Anexos

- Campo da sessão: botão de clipe (input `type=file` múltiplo) e soltar arquivos no campo.
  Faixa de anexos acima do texto (nome, tamanho, remover).
- Renderer lê o conteúdo (`File.arrayBuffer`) e manda `{ name, mime, data: Uint8Array }` —
  **nunca caminho**. Até 5 arquivos, 10 MB cada, tipos: png, jpeg, webp, gif, pdf, md, txt.
- Main (`claude/attachments.ts`): valida tipo pelo conteúdo (assinatura de bytes para imagens e
  PDF; UTF-8 válido para texto), nome saneado, grava em `<worktree>/.orkio/attachments/<sha8>-<nome>`
  (0600), e acrescenta ao texto: "Anexos (leia com a ferramenta Read): .orkio/attachments/…".
  O worktree é criado antes se ainda não existir (mesmo caminho do `send`).
- Nada do conteúdo vai para o log; o evento da mensagem guarda só os nomes.
- Com fluxo rodando (mensagem interrompe), os anexos seguem junto do `resumeWithReply`.

### 4. Subagentes do Claude visíveis

- `stream.ts`: `tool` ganha `parent?: string` (o `parent_tool_use_id`). Ferramentas `Task`/`Agent`
  na conversa principal viram `{ kind: 'subagent', id, title, agentType }`; eventos com `parent`
  contam para aquele subagente; o `tool_result` do id fecha (ok/erro).
- `run-transcript.ts` (puro): agrupa subagentes **lançados no mesmo turno** num item
  `subagents` com `{ id, title, type, tools, state: running|done|failed, startedAt, endedAt }`.
- UI `SubagentGroup`: cabeçalho "3 subagentes · 2 trabalhando · 1m 57s", linhas com título, tipo
  (ex. `implementation-agent`), contagem de ferramentas e estado; recolhível; ao vivo enquanto roda.
- Acima do campo, com subagentes rodando: "Esperando 3 subagentes: título, título…" (como o
  banner do compozy); o "Parar" continua parando a execução inteira.
- Formato `jsonl` só ganha campos: logs antigos leem igual.

### 5. Começar sozinho até a spec

- Config do orquestrador: `autoStart: { enabled: boolean; since: string | null }` (opcional;
  `queueStageId` e `maxActive`, mantidos por compatibilidade, voltam a ter uso).
- `planTick` ganha a decisão `auto_start` (pura, testada):
  - tarefa na `queueStageId`, **vista pela primeira vez depois de `since`** (`task_state`
    `created_at`/primeira observação > `since`), não bloqueada, sem fluxo, sem pausa;
  - descrição: a página do Notion lida e não vazia (`descriptionEmpty` do `prepare`); vazia →
    não move e cria o item "Esperando você: tarefa sem descrição" (evento `auto_start_skipped`
    com motivo, uma vez por tarefa);
  - respeita `maxActive` (tarefas com fluxo ativo nas etapas do caminho) e os limites diários dos
    agentes (8A);
  - move para a 1ª etapa do caminho (`lanes[0]`) com `source: 'automation'` e detalhe
    `orchestrator: auto_start` → o fluxo da coluna dispara pelo caminho de sempre.
- **Até a spec:** o fluxo da coluna precisa ter um gate antes de implementar. Validação
  (`validateOrchestrator`): com `autoStart` ligado, aviso se o fluxo da 1ª etapa não tiver gate
  antes do primeiro passo que escreve código (`/implement`, `delivery`); os templates Alva já têm
  `aprovar-spec`.
- UI (seção Orquestrador): interruptor "Começar sozinho até a spec" com a frase do que acontece
  ("Tarefa nova com descrição em Prioridades vai para Em andamento e para em 'Aprovar spec'.
  Sem descrição, fica esperando você."), "Tarefas ao mesmo tempo" (maxActive) e o que ficou de
  fora na última rodada.

### 6. Revisão no painel

- Aba **Revisão** no painel da fase (depois de Mudanças), visível quando há execução de
  `/alva-flow:review` (ou comando com `review` no nome) ou PR com comentários.
- Conteúdo: resultado final (texto) da execução de review mais recente (`MarkdownText`), com
  data e veredito quando o texto trouxer ("blocker"/`alva.review_blocker`), e a lista de threads
  da PR (já nos sinais: resolvidas/não resolvidas, link para o GitHub).
- `defaultPanelTab`: fase "Revisão" abre esta aba.

### 7. Delegar pelo Orkio

- Ponte MCP (`bridge/permission-mcp.ts`) ganha ferramentas `delegate`, `subagent_status` e
  `subagent_cancel` (mesmo socket/token). Entrada do `delegate`:
  `{ title, task, agent?, model?, effort?, isolation: 'shared' | 'worktree' }` (até 4 por turno).
- Main (`claude/delegation.service.ts`):
  - cria execuções filhas (`agent_runs.parent_run_id`, SQLite nova migração) na mesma tarefa;
    a regra "1 execução por tarefa" passa a valer para execuções **raiz**;
  - `shared` = mesmo worktree; `worktree` = worktree filho
    `<userData>/worktrees/<projectId>/<ID>--sub-<n>` com branch `<branch-da-tarefa>--sub-<n>` a
    partir do HEAD da tarefa (commits pendentes do pai não vão: o pai é avisado no resultado);
  - filhos usam a mesma política/permissões; **nunca** modo entrega; agente opcional só restringe;
  - limite: `maxParallel` sobe para 4 (configurável), filhos entram na mesma fila;
  - id do filho idempotente por (`run`, `tool_use_id`).
- O pai: quando o turno termina com filhos rodando, a execução fica `waiting_subagents` (não
  conta como vaga). Quando todos terminam, o Orkio continua a sessão do pai (`--resume`) com:
  "Subagentes terminaram: <título> (ok, branch x, 3 commits)… Use orkio subagent_status para
  ler os resultados." Resultado de cada filho: texto final até 60 mil caracteres, redigido.
- Fluxo: passo de comando com filhos pendentes só termina quando o pai termina de verdade.
- UI: filhos aparecem no mesmo `SubagentGroup` (marcados "Orkio"), com link para abrir a
  execução filha; filhos contam em "Rodando" na lateral.

## Ordem de implementação

1 Integrações → 2 Modelo e raciocínio → 3 Anexos → 4 Subagentes visíveis → 5 Começar sozinho →
6 Revisão → 7 Delegar. Cada parte termina com `pnpm typecheck && pnpm lint && pnpm test` e o E2E
das telas tocadas; CLAUDE.md e CHANGELOG atualizados por parte.

## Restrições

- CLAUDE.md inteiro vale: CSP (sem Radix Select/ScrollArea, Dialog/Menu não modais), pt-BR,
  tokens só no main, renderer sem caminhos, `ConfigStore` para config, migração SQLite só
  acrescentando, testes que provam que nada vaza.
- E2E: o Claude simulado (`e2e/fake-claude/claude`) ganha: registrar `--effort`/`--model` no
  `agent-args.log`; cenário `subagentes` (emite `Task` com eventos filhos); cenário `delegar`
  (chama a ferramenta `delegate` pela ponte MCP real).

## Respostas à revisão do construtor (calls do Claude)

1. **Pai que delega (parte 7):** a continuação **é a mesma linha** de `agent_runs` (mesmo id,
   mesmo `.jsonl`; outro processo com `--resume`). Status continua `running` (sem mexer no CHECK)
   com a coluna nova `waiting_subagents INTEGER NOT NULL DEFAULT 0`; o `FlowRunner` segue
   esperando um `runId` só e não muda. Um processo do pai por vez: acordar com o pai ainda ativo
   entra numa fila e vai quando o turno acaba. Mensagem do usuário com filhos rodando vai ao pai
   na hora (os filhos continuam; o aviso diz quantos ainda rodam). "Parar" cancela pai e filhos.
   Reabrir o app: pai e filhos `running` viram `failed` como hoje (o fluxo pausa; "Retomar").
2. **Tarefa "nova" (parte 5):** a que **entrou na etapa de fila depois de `since`** (evento
   `added`/`moved`/`reconciled` com destino na fila e `created_at > since`); mover uma tarefa
   antiga para Prioridades conta como chegada. Sem descrição → evento `auto_start_skipped` uma
   vez e item "Esperando você"; não tenta de novo (você move à mão depois de escrever). Página
   ilegível (`pageWarning`) → **não começa** (mesmo tratamento de "sem descrição", motivo próprio).
3. **Gate antes de código:** com `autoStart` ligado, fluxo da 1ª etapa sem gate antes do primeiro
   `/implement`/passo de entrega é **erro** (não salva). `autoStart` exige o orquestrador ligado
   (as passagens depois da aprovação já são dele).
4. **Revisão (parte 6):** mostra o resultado do `/review` e as **threads da PR com texto**, lidas
   sob demanda ao abrir a aba (uma query GraphQL nova: corpo, autor, arquivo/linha, url,
   resolvida), só em memória, cache de 60 s, com link para o GitHub. Snapshot da 3B não muda.
5. **Worktree filho:** quem junta é o **agente pai** (`git merge` no worktree dele; a mensagem de
   acordar diz a branch e os commits). O Orkio remove os worktrees filhos quando a execução raiz
   termina (branch filha apagada se já estiver contida na da tarefa; senão fica). Branches com
   sufixo `--sub-<n>` ficam **fora dos sinais e das automações** (`isSubagentBranch`).
6. **Subagentes em segundo plano (parte 4):** `Task`/`Agent` com `run_in_background: true` aparece
   como "em segundo plano" sem fim conhecido (não bloqueia nada).
7. **Correções ao código atual:** `task_state` não tem `created_at` (usar `task_events`, item 2);
   `descriptionEmpty` é falso com página ilegível (usar `pageWarning`, item 2); sinais não têm
   texto de comentário (item 4); a ponte MCP não recebe `tool_use_id` nas ferramentas próprias →
   id do filho = `<runId>:<n>` (sequência por execução), e a UI casa com o `tool_use`
   `mcp__orkio__delegate` pela ordem; cabeçalho de `shared/orchestrator.ts` e a seção 8B do
   CLAUDE.md passam a descrever o `autoStart`.

## Para o construtor decidir

- Nomes exatos de componentes e arquivos novos além dos citados.
- Visual fino dos cards (dentro do tema e do mockup).
- Como achar o "resultado do review" quando o comando não é do alva-flow (heurística simples).

## Acréscimo (aprovado pelo usuário em 2026-11-23): revisão publicada como `orkio[bot]`

Motivo: o usuário quer que a revisão do agente apareça na PR com a identidade do Orkio (não a dele),
para que "Request changes" funcione na própria PR e dispare "Alterações pedidas → Revisado".

- **GitHub App "Orkio"** (o usuário cria; permissões _Pull requests: Read & write_, _Metadata: Read_;
  sem webhook). Chave privada **só na Vercel** (`GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`).
- **Rota do site** `POST /github/review` `{ owner, repo, number, userToken, review: { event, body,
comments } }` (runtime Node, mesmo padrão do intermediário do Notion: sem `console.*`, limitador
  por IP, nada logado). **O token do App nunca sai do site** (revisão de segurança da Task 17: o
  token com `pull_requests: write` também permite APPROVE; devolvê-lo deixaria qualquer pessoa com
  push aprovar a própria PR como `orkio[bot]` e contar na proteção de branch):
  1. valida `event ∈ { COMMENT, REQUEST_CHANGES }` (APPROVE/qualquer outro → `bad_request`), owner/
     repo/número e limites (corpo, nº e tamanho dos comentários, `path`/`line`);
  2. `GET /repos/{owner}/{repo}` com o `userToken` → exige `permissions.push === true`; depois
     `GET /user` (mesmo token) → login validado (sem login válido → `forbidden`), que vai numa
     linha no fim da revisão: "Publicado pelo Orkio a pedido de @login" (responsabilização);
  3. JWT RS256 do App (iat −60 s, exp +9 min) → `GET /repos/{owner}/{repo}/installation` →
     `POST /app/installations/{id}/access_tokens` com `repositories: [repo]` e
     `permissions: { pull_requests: 'write' }`;
  4. o próprio site posta `POST /repos/{o}/{r}/pulls/{n}/reviews` com esse token e devolve só
     `{ url }` (link da revisão). Erros: `not_installed` (412 + link de instalação), `forbidden`
     (sem push), `not_configured` (env ausente), `bad_request`, `upstream`. O texto da revisão só
     passa pelo site (não é gravado nem logado). Prazo total de 15 s para todas as chamadas ao
     GitHub (cada uma com o próprio limite, incluindo a leitura do corpo), menor que os 25 s do app;
     no timeout, o app avisa que a revisão pode ter sido publicada (conferir a PR antes de repetir).
- **App (main):** `GitHubReviewPoster` — monta a revisão (owner/repo/número validados; **APPROVE
  nunca**; comentários de linha conferidos contra os arquivos/linhas do diff da PR; corpo redigido
  com `redactSecrets`, limites de tamanho) e a manda ao site com o token OAuth do conector. O POST ao
  site é feito **dentro do conector** (o token do usuário sai do main só para a origem do site do
  Orkio, fixada na construção do conector: `MAIN_VITE_SITE_URL` e, só sem ela, a origem do
  intermediário do Notion, que ainda pode ser o Worker da Cloudflare sem a rota; por HTTPS;
  `http://127.0.0.1` só em build de E2E; nunca vai ao renderer nem a um callback arbitrário).
- **Fluxo:** ação `publish_review` (com confirmação/gate, padrão `OrkioAction.confirm`): lê
  `.orkio/review.json` `{ event, summary, comments[] }` escrito pelo passo anterior; o gate mostra o
  resumo, o tipo e os comentários; aprovar posta como `orkio[bot]`; evento `delivery`
  `action: 'review_post'` no histórico com link. Sem App configurado/instalado → falha do passo com
  explicação e link de instalação (nada é postado).
- **Modelo:** "Alva: revisão publicada" (ou passo opcional no modelo de entrega): `/alva-flow:review`
  → passo prompt `readOnly` que converte o resultado em `.orkio/review.json` → `publish_review`.
- **Fora de escopo:** webhooks do App, APPROVE, revisão em repositórios onde o usuário não tem push.
