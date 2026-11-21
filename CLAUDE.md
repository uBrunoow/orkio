# CLAUDE.md — convenções do Orkio

App Electron (electron-vite + React + TypeScript strict). Orquestra Notion, GitHub e
Claude Code. Hoje existem:

- **Conectores:** Notion (OAuth via `broker/` + token) e GitHub (OAuth Device Flow + fine-grained PAT).
- **Projetos:** pasta local → repositório GitHub detectado (git local + API), saúde do projeto e
  branch atual ao vivo. Config não secreta em `userData/orkio-config.json` (`ConfigStore`).
- **Bancos do Notion:** assistente (Integrações) escolhe os data sources de Projetos e Tarefas e
  mapeia propriedades; cada projeto local se vincula a uma página de Projetos e lista as tarefas
  ligadas a ela (**só leitura**).
- **Sinais (2D):** branch local/remota e PR de cada tarefa, casadas pelo ID (ex.: ORK-142).
- **Quadro (3A):** kanban por projeto com etapas próprias ligadas ao status do Notion; mover
  card escreve no Notion (fila persistente); estado local e histórico em SQLite.
- **UI:** design system Astryx com o tema Orkio, CSP estrita, textos da Astryx em pt-BR.
- **Automações (3B):** eventos do git/GitHub (por diff de sinais) movem tarefas por regras
  declarativas, em segundo plano, com idempotência no SQLite.
- **Fluxo do projeto (3C):** tela para editar etapas e automações (frases, formulário),
  validação, simulação, restaurar padrão, exportar/importar e histórico de alterações.
- **Claude Code (4A):** roda a tarefa com o CLI `claude` do usuário (login/assinatura dele) num
  worktree isolado por tarefa, com briefing do Notion, permissões pelo Orkio e log ao vivo.
- **Claude Code (4B):** catálogo de comandos (usuário/projeto/plugins), "Rodar de novo", artefatos
  (anexar caminho + commit, publicar no Notion) e contexto do projeto (instruções + páginas).
- **Fluxos de tarefa (5A):** sequências de passos (comandos do Claude Code, gates, ações do
  Orkio, saltos condicionais) ligadas às colunas, disparadas ao entrar ou à mão.
- **alva-flow (5B):** pré-checagem do projeto, vínculo tarefa do Notion ↔ task do Backlog.md,
  extratores e templates "Fluxo Alva" sobre os fluxos da 5A.
- **Entrega (5C):** push da branch da tarefa pelo Orkio (com gate), "modo entrega" por passo para
  `/alva-flow:pr` (gh/push só da branch da tarefa), pedir review pelo conector, CI no painel.
- **Releases (6B):** electron-builder (`electron-builder.ts`) para macOS (dmg+zip, arm64/x64) e
  Windows (nsis), publicados por CI (`release.yml` em tag `v*.*.*`) no repo público
  `uBrunoow/orkio-releases`; `pnpm release`, CHANGELOG e smoke test do app empacotado.
- Ainda não existem: login no app (tela inicial), webhooks.

## Comandos

```bash
pnpm install      # postinstall baixa o binário do Electron
pnpm dev          # app em modo dev
pnpm test         # Vitest (src/**/*.test.ts e test/**/*.test.ts, inclui build real p/ checar a CSP)
pnpm e2e          # build (--mode e2e) + Playwright no app Electron (Notion/GitHub simulados, git real). Linux headless: xvfb-run -a pnpm e2e
pnpm typecheck    # tsc em todos os projetos (node, web, e2e, broker)
pnpm lint         # ESLint
pnpm build        # build em out/
pnpm icons        # regenera ícones a partir de brand/orkio-app-icon-1024.png
pnpm dist         # empacota (electron-builder.ts)
pnpm dist:dir     # só a pasta do app em dist/ (sem instalador)
pnpm smoke:packaged  # smoke do app empacotado (dist/): tela inicial + ponte MCP. Linux: xvfb-run -a
pnpm release <patch|minor|major|beta> [--beta]  # versão + CHANGELOG + commit + tag (sem push)
pnpm astryx:static-css  # regenera o CSS estático das camadas da Astryx (após upgrade)
```

Antes de dar uma tarefa por concluída: `pnpm typecheck && pnpm lint && pnpm test`.
Mudou UI, IPC, preload, segurança ou build? Rode também `pnpm e2e`.

## Estrutura

```
src/
  shared/ipc-contract.ts   # canais IPC, ConnectionStatus, credenciais, OrkioApi. Sem Node/DOM.
  shared/notion-mapping.ts # regras do mapeamento (tipos por campo, obrigatórios) p/ main e renderer
  shared/task-id-match.ts  # casamento puro de IDs (ORK-142) em branches/títulos
  shared/task-signals.ts   # TaskSignals, buildTaskSignals, diffSignals (base da Etapa 3)
  shared/board.ts          # etapas, template, validação e reconciliação do quadro (puras)
  shared/automation.ts     # snapshot, deriveEvents, regras padrão, evaluate (motor puro)
  shared/agent-run.ts      # tipos das execuções do Claude Code (log normalizado, resumo, status)
  shared/briefing.ts       # blocos do Notion → markdown e montagem do briefing (puro)
  shared/slug.ts           # slug e nome da branch da tarefa (<ID>/<slug>)
  shared/task-flow.ts      # 5A: fluxos de tarefa (tipos, motor puro, condições, template, validação)
  shared/alva.ts           # 5B: tipos da pré-checagem, parse da task do Backlog.md (puro)
  shared/alva-templates.ts # 5B: templates "Fluxo Alva" (fluxos de tarefa com os comandos do plugin)
  shared/delivery.ts       # 5C: branches protegidas, checkPushBranch, DeliveryTarget/Settings (puro)
  shared/flow.ts           # editor do fluxo: describeRule, validateFlow, simulate, diffFlow, export/import
  main/                    # processo main (Node). Único lugar com rede, disco e segredos.
    index.ts               # janela, segurança, wiring de dependências e IPC
    connectors/types.ts    # interface Connector
    connectors/<id>/       # <id>.client.ts (HTTP) + <id>.oauth.ts + <id>.connector.ts
    oauth/                 # fluxos genéricos: loopback.ts (redirect, RFC 8252), device-flow.ts (RFC 8628)
    net/parse.ts           # helpers puros de parsing (isRecord, Retry-After, ...)
    net/rate-queue.ts      # fila de rate limit (concorrência, intervalo mínimo, pausa) + backoff
    ipc/                   # handlers finos: validam origem e payload, delegam ao conector/serviço
    storage/secure-store.ts  # SEGREDOS (safeStorage)
    storage/config-store.ts  # config NÃO secreta (JSON atômico, schemaVersion, migrações)
    config/orkio-config.ts   # orkio-config.json (schema v4: projects, notion, boards+rules, automation)
    git/git.ts             # git local via execFile (nunca exec/shell)
    projects/              # remote-url.ts (parser puro), projects.service.ts, head-watcher.ts
    notion/                # notion-workspace.service.ts (bancos, mapeamento, vínculo, tarefas)
    signals/               # github-signals.source.ts (ETag, GraphQL) + task-signals.service.ts
    db/database.ts         # SQLite (node:sqlite) + migrações por PRAGMA user_version
    board/                 # board.store.ts (SQLite), write-queue.ts, board.service.ts
    automation/            # automation.service.ts (ciclo) + scheduler.ts (60 s / local 5 s)
    alva/                  # 5B: precheck.ts, alva.service.ts (vínculo + extrator), alva-flows.service.ts
    delivery/              # 5C: delivery.service.ts (alvo, prévia, push), delivery-actions.ts (ações)
    flows/                 # 5A: flow-runner.ts (execução/persistência/retomada), flows.service.ts
    claude/                # 4A: detect, worktree.service, runner (spawn + PermissionBroker), stream,
                           # policy (+ delivery-policy, 5C), redact, run.service, claude.service;
                           # bridge/permission-mcp.ts
                           # (servidor MCP stdio → out/main/permission-mcp.js)
  preload/index.ts         # contextBridge → window.orkio (API mínima e tipada)
  renderer/src/            # React. Sem acesso a Node; só usa window.orkio.
    features/<feature>/    # componentes + hooks por funcionalidade
      integrations/connection-ui.tsx  # peças comuns dos cards (conectado, erro, token, desconectar)
      projects/            # tela Projetos (useProjects, AddProjectPanel, ActionLink)
      notion-workspace/    # card "Bancos do Notion" (assistente) e seção Notion de cada projeto
      board/               # tela Quadro (colunas com arrasto, card, painel, ajuste de etapas)
    components/Alert.tsx   # mensagens (Banner da Astryx)
    components/PageHeader.tsx  # título da página + ação
    components/OrkioLogo/  # logo (símbolo full/simple + wordmark)
    styles/astryx.css      # reset + CSS pré-compilado da Astryx
    styles/brand.css       # camada orkio-brand: só Jost/mono da marca, com tokens do tema
    styles/fonts.css       # fontes locais via @fontsource
  astryx-themes.ts         # GERADO por `astryx theme add` (tema Orkio)
  themes/orkio/            # GERADO: cópia do tema no app (CSS estático + módulo)
themes/orkio/              # fonte do tema (editor de temas da Astryx)
brand/                     # fonte da verdade da marca (BRAND.md, SVGs, ícone 1024, tokens)
build/                     # ícones do empacotador (gerados por pnpm icons)
resources/icon.png         # ícone da janela em runtime
```

TS: `tsconfig.node.json` (main, preload, shared) e `tsconfig.web.json` (renderer, shared).

## Segurança dos tokens (regra inegociável)

- Chamadas a APIs externas **só no main**. Nunca use `fetch` para serviços externos no renderer.
- Segredos só via `SecureStore` (`safeStorage`). Se a criptografia não estiver disponível,
  **não salve**: lance `EncryptionUnavailableError` e mostre erro. Nunca há fallback para
  texto puro (no Linux, `basic_text` conta como indisponível).
- O token **nunca** volta para o renderer: conectores devolvem só `ConnectionStatus`.
- Nunca logue tokens, headers, corpos de resposta nem `error.message`/`stack` de erros
  desconhecidos. No main, logue no máximo o nome do erro. (`no-console` está ativo no ESLint.)
- Mensagens ao usuário em pt-BR, curtas e acionáveis. Nunca exiba a exceção crua.
- Testes devem provar que o token não vaza (em mensagens de erro, status e logs).
- Não commite `.env`, `*.bin`, `secrets/`.

## Padrão de conectores

Todo serviço externo implementa `Connector` (`src/main/connectors/types.ts`):
`connect(credentials)`, `disconnect()`, `getStatus()` (local, sem rede) e
`testConnection()` (revalida na API).

- Credenciais são uniões discriminadas por `kind`. `ConnectorCredentials`
  (`shared/ipc-contract.ts`) só tem o que o renderer pode mandar (`'token'`).
  `OAuthCredentials<TTokens>` (`kind: 'oauth'`) existe só no main.
- Conectores com OAuth implementam `OAuthConnector`: `getAuthOptions()`, `startOAuth()`
  (resolve quando o fluxo termina) e `cancelOAuth()`. O fluxo roda inteiro no main; o renderer
  só vê `ConnectionStatus`.
- OAuth com redirect: use `authorizeViaLoopback` (`src/main/oauth/loopback.ts`, RFC 8252):
  servidor em `127.0.0.1` só durante o login, `state` aleatório, checagem de `Host`, porta fixa
  registrada no provedor.
- Provedor que exige client secret (Notion): a troca/renovação passa pelo intermediário em
  `broker/`. Nunca coloque client secret no app nem em `.env` do app.
- Tokens rotativos: renovações serializadas por conexão (uma promise em andamento);
  `invalid_grant` é terminal (erro com `hasStoredCredentials` + "Reconectar").
- Separe **client** (HTTP puro, timeout, retry, mapeamento de erros para mensagens) de
  **connector** (validação de entrada, persistência, regras de status).
- Erros esperados viram `{ state: 'error', message }`, sem lançar exceção. Falhas
  transitórias (rede, 5xx, 429) em conexão já salva viram `connected` com `warning`.
- Injete dependências (`fetch`, `sleep`, `store`, `now`) para testar sem rede.
- Para adicionar um conector: `ConnectorId` e canais em `shared/ipc-contract.ts`,
  `connectors/<id>/`, `ipc/<id>.ipc.ts`, exposição no preload e feature no renderer.

## IPC

- Canais definidos em `IPC_CHANNELS` (`shared/ipc-contract.ts`). Use `ipcMain.handle`/`invoke`.
- Todo handler checa a origem com `createSenderGuard` e valida o payload (`unknown`).
- O preload expõe funções específicas, nunca `ipcRenderer` cru.
- Links externos: `window.orkio.openExternal`, com allowlist em `ipc/shell.ipc.ts`
  (`EXTERNAL_URL_RULES`: host + prefixo de caminho opcional). Adicione só o necessário.
- Validação de payload e log de erro: `ipc/payload.ts` (`isTokenCredentials`, `errorName`).
- Fluxos longos (OAuth/Device Flow): uma chamada `invoke` que só resolve no fim
  (`startOAuth`, `waitDeviceFlow`). Não exponha `ipcRenderer.on` sem necessidade.

## Notion

- Versão da API centralizada em `NOTION_VERSION` (`notion.client.ts`), hoje `2026-03-11`.
- Usamos `fetch` nativo (não o SDK). Timeout de 10 s; 429 respeita `Retry-After` (uma
  nova tentativa se a espera for de até 5 s).
- Conexão principal: OAuth (`notion.oauth.ts`): `owner=user`, redirect
  `http://127.0.0.1:47821/oauth/notion/callback`, troca/renovação via `broker/`.
  Token colado continua como alternativa ("Usar token").
- Registro salvo (`secrets/notion.bin`, cifrado) é versionado: `v: 2` com
  `method: 'token' | 'oauth'`. Registros `v: 1` (Etapa 1) são lidos como `token`.
- Chamadas à API passam pelo conector (`withAccessToken`, renova em 401). Serviços recebem só
  métodos de leitura (`searchDataSources`, `getDataSource`, `queryDataSource`,
  `connectionMethod`), nunca o token.
- Leituras de dados usam a API de **data sources** (2025-09-03+): `POST /search` (filtro
  `object: data_source`), `GET /data_sources/{id}`, `POST /data_sources/{id}/query`. Passam pela
  `RateQueue` (2 simultâneas, 350 ms entre inícios ≈ 3 req/s); 429 pausa a fila pelo
  `Retry-After` (ou backoff exponencial) e tenta de novo até 3 vezes (espera máx. 30 s).
  404 → `not_found`, 403 → `forbidden`, 400 → `bad_request`, com mensagens pt-BR.

## Bancos do Notion (Etapa 2C)

- `NotionWorkspaceService` (`main/notion/`). Config em `orkio-config.json` → `notion`:
  `projectsDataSource`/`tasksDataSource` (`{ id, name }`) e `mapping` por **id de propriedade**
  (`{ id, name, type }`); em cada projeto, `notionProject: { id, name } | null`. **Só ids e
  nomes**; nunca conteúdo de páginas.
- Campos: `title`, `status` (status/select), `uniqueId` (unique_id), `project` (relation que
  aponta para o banco de Projetos) obrigatórios; `priority`, `assignee` opcionais
  (`shared/notion-mapping.ts`). Sem `unique_id` o salvar é bloqueado com explicação.
- Sugestão automática (`suggestMapping`): tipo + nomes usuais pt/en; opcionais só com nome
  reconhecido. `checkMapping` revalida: renomeada → aviso e nome atualizado; apagada/tipo
  mudou → erro (`broken`, tarefas bloqueadas) nos obrigatórios, aviso e campo ignorado nos opcionais.
- Revalidação: uma vez por sessão (`getStatus`) e ao mudar a conexão do Notion. Sem rede →
  `unverified` (nada é apagado). Trocar o banco de Projetos desfaz os vínculos.
- Vínculo 1 ↔ 1 (página de Projetos ↔ projeto local); a lista vem ordenada por semelhança de
  nome (Dice em bigramas) com o projeto/repositório.
- Tarefas: `relation.contains` com a página vinculada, `created_time` desc, até 500 (5 páginas),
  cache em memória de 60 s (`force` ignora). Não usamos `filter_properties` (ids de
  propriedade vêm codificados; sem como validar sem a API real).
- OAuth só enxerga o que foi escolhido na autorização: 404/403 em conexão OAuth vira
  `canReconnect` ("Reconectar com Notion").
- Config de build: `MAIN_VITE_NOTION_OAUTH_CLIENT_ID` e `MAIN_VITE_NOTION_OAUTH_BROKER_URL`
  (`.env.example`; `.env.e2e` só para o E2E). Sem elas, OAuth fica indisponível.

## GitHub

- Versão da API em `GITHUB_API_VERSION` (`github.client.ts`), hoje `2026-03-10`; headers em
  `githubHeaders()` (Bearer, `application/vnd.github+json`, `X-GitHub-Api-Version`, User-Agent).
- Rate limits: primário (403/429 + `x-ratelimit-remaining: 0` → `x-ratelimit-reset`) e
  secundário (403/429 + `Retry-After`, ou 1 min). Uma nova tentativa se a espera for ≤ 5 s.
- Conexão principal: OAuth App com **Device Flow** (`github.oauth.ts`), escopo `repo`, sem
  client secret e **sem** `broker/`. Config: `MAIN_VITE_GITHUB_CLIENT_ID`.
- O conector implementa `DeviceFlowConnector` (`startDeviceFlow` → código; `waitDeviceFlow`
  → resultado; `cancelDeviceFlow`). Um fluxo por vez; `startDeviceFlow` repetido devolve o mesmo
  código. Tokens de OAuth App não expiram: 401 → "Reconectar com GitHub".
- Registro salvo: `secrets/github.bin`, `{ v: 1, method: 'device' | 'token', token, scopes, ... }`.
- Fallback: fine-grained PAT ("Usar token").

## Projetos

- **O renderer nunca envia caminhos.** O main abre o seletor de pasta (`dialog.showOpenDialog`),
  analisa a pasta e devolve um `selectionId` (expira em 10 min). As operações seguintes usam
  `selectionId` ou o id do projeto. Novas operações devem seguir o mesmo modelo.
- **Git:** só `createGit()` (`git/git.ts`): `execFile('git', args, { cwd, timeout })`, env com
  `GIT_TERMINAL_PROMPT=0`, `LC_ALL=C`, `GIT_OPTIONAL_LOCKS=0`. Nunca `exec` com string. Erros viram
  `GitError` com mensagem pt-BR (sem repassar stderr cru).
- **Remotes:** `parseRemoteUrl` (função pura). `ssh-alias` (host sem ponto) e `enterprise` (outro
  domínio) exigem confirmação do usuário. Alias valida em github.com; Enterprise é salvo com
  `verified: false` (a conta conectada é do github.com). `origin` primeiro, `upstream` depois.
- **GitHub:** o serviço usa `ProjectsGitHub` (`isConnected`, `getRepository`, `accessSettingsUrl`)
  fornecido pelo `GitHubConnector`, que chama a API via `withAccessToken` privado. O token nunca
  sai do conector. 404 → sem acesso; 403 + `X-GitHub-SSO` → SSO (link validado
  `github.com/orgs/<org>/sso`); 403 "OAuth App access restrictions" → admin precisa aprovar
  (link `github.com/settings/connections/applications/<client_id>`).
- **Saúde:** `list()` é local (pasta existe? mesma raiz? remote ainda aponta para o repo?
  branch/sujeira); `revalidate()` também consulta o GitHub (até 3 em paralelo) e atualiza
  `defaultBranch/visibility/canPush/archived`. Falha de rede → `unverified`, nunca apaga dados.
- **Branch ao vivo:** `HeadWatcher` observa o diretório de `git rev-parse --absolute-git-dir`
  (cobre worktrees) com `fs.watch` + debounce 300 ms; fallback para polling. O main emite
  `projects:branch-changed { projectId, branch }`; o preload expõe `onBranchChanged() → unsubscribe`.
- **Remover** só tira do `orkio-config.json`; nunca toca em arquivos do usuário.
- **Config não secreta:** sempre via `ConfigStore` (nada de `fs.writeFile` direto). Mudou o
  formato? Suba `ORKIO_CONFIG_VERSION` e escreva a migração `v → v+1` com teste.

## Identidade visual

Leia `brand/BRAND.md` antes de mexer em UI.

- **Tema Orkio** (Astryx): `themes/orkio/` (fonte, editado só pelo editor de temas) gera a cópia
  do app em `src/themes/orkio/` e `src/astryx-themes.ts` (não edite à mão). Cores da marca, dark
  only, Inter na UI e JetBrains Mono em código. Mude com
  `pnpm exec astryx experimental theme editor set orkio <coisa> <valor>` e confira o PNG
  (`… editor show orkio --png`).
- Cores e medidas: só tokens do tema (`var(--color-*)`, `--spacing-*`, `--radius-*`). Nada de
  hex/px. Única exceção: `backgroundColor` do `BrowserWindow` no main (espelha o fundo do tema).
- Inter = UI; **Jost só para logo e títulos de destaque** (`brand.css`: `.orkio-display`,
  `.orkio-slogan`); mono para IDs e tokens (`Code`, ou `.orkio-mono-input` em campos).
- Fontes vêm de `@fontsource` (`styles/fonts.css` + o `orkio.fonts.css` do tema). Nunca CDN. O
  build não transforma fontes em `data:` URI (`assetsInlineLimit`).
- Logo: `<OrkioLogo>` (SVG da marca; abaixo de 48 px usa a versão simple). Wordmark em Jost 300,
  letter-spacing 0.25em (Jost 400 se ≤ 18 px). Não distorcer, girar nem aplicar gradiente/sombra.
- Laranja com parcimônia: ação principal (`Button variant="primary"`), símbolo, estados de agente.
  Texto sobre laranja é sempre preto (`--color-on-accent`), nunca branco.
- Ícones de interface: **Tabler** (`@tabler/icons-react`), sempre via `components/icons.tsx`
  (adaptador para o `Icon` da Astryx; inclui os logos `GitHubLogo` e `NotionLogo`). Use
  `<Icon icon={X} />` ou a prop `icon` dos componentes. Novo ícone? Exporte-o de `icons.tsx`.
- Ícones do app: não edite `build/` à mão; troque `brand/orkio-app-icon-1024.png` e rode `pnpm icons`.

## Estilo

- TypeScript strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`).
- Prettier: sem ponto e vírgula, aspas simples, 100 colunas.
- **UI com Astryx** (`@astryxdesign/core`). Leia as props com `pnpm exec astryx component <Nome>`
  antes de usar. Layout com `VStack`/`HStack`/`Grid`/`Card`, texto com `Text`/`Heading`, nada de
  `<div>`/`<span>` cru. Dados densos em `List`/`Item`. Status em `Token` (`Badge` só para contagens).
  Mensagens: `components/Alert.tsx` (Banner; erro = `role="alert"`, aviso = `role="status"`).
- CSS próprio só na camada `orkio-brand` (`styles/brand.css`, `OrkioLogo.css`), apenas para a
  marca e com tokens do tema. Nada de CSS de layout. Exceção: `features/welcome/welcome.css`
  (abertura laranja + tela "Vamos começar" em tela cheia, sem sidebar: posição fixa, grade de
  fundo e animações; respeita `prefers-reduced-motion`).
- Ganchos de teste: papéis/nomes acessíveis primeiro; `data-testid` quando não houver (ex.:
  `device-code`, `project-branch`, `empty-hero`). Nunca classes da Astryx (`astryx-*`, `x…`).
- CSP: nada de `<style>`/`<script>` inline em produção. `style-src` só é relaxado no dev server.
  A prop `style` do React (CSSOM) é permitida. Ver "Astryx e CSP" abaixo.
- Textos de UI em pt-BR.

## Sinais das tarefas (Etapa 2D)

- Convenção: o ID aparece no nome da branch ou no título/branch da PR. `extractTaskNumbers`
  (`shared/task-id-match.ts`): `<PREFIXO>-<n>`, sem diferenciar maiúsculas, sem letra/dígito
  colado dos dois lados (ORK-14 ≠ ORK-142; ORK-0142 não casa). Tarefas sem prefixo no ID não
  recebem sinais.
- Fontes: `git for-each-ref refs/heads` (`Git.localBranches`); GitHub REST
  `/branches` (até 10 páginas), `/pulls?state=open` (até 5) e `/pulls?state=closed&sort=updated`
  (para ao passar de 30 dias), com **ETag/If-None-Match por página** (cache em memória por
  repositório; 304 não gasta rate limit primário). Paginação pelo header `Link` (só api.github.com).
- **GraphQL é necessário** para `reviewDecision` e `reviewThreads.isResolved` (a REST não tem
  nenhum dos dois). Query em lote (aliases `pr<n>`), só para PRs ligadas a tarefas e só quando
  `updated_at` muda (abertas: no máximo a cada 5 min). Falha/permissão faltando → PR só com estado.
- O conector do GitHub expõe `getConditional` (só caminhos `/repos/` e `/repositories/`) e
  `graphql`; o token nunca sai dele.
- Falhas não quebram: sem GitHub/Enterprise/sem repo → só local com aviso; 404/SSO/restrição/
  rate limit/rede → mantém o último resultado remoto conhecido e explica (com link quando houver).
- UI: na lista de tarefas, branch (mono, local/remota) e chip da PR (#n abre no GitHub; estado,
  revisão, comentários, CI). Atualiza com "Atualizar" (força), a cada 60 s com a janela visível e
  em foco, e quando a branch atual muda. Allowlist: `github.com/<owner>/<repo>/pull/<n>`.
- `diffSignals` gera eventos (branch criada, PR aberta/mergeada, revisão mudou...) para a Etapa 3.

## Quadro (Etapa 3A)

- Etapas por projeto em `orkio-config.json` → `boards[projectId]`:
  `{ stages: [{ id, name, order, notionStatus: { id, name }, color }], orkioStageProperty,
blockedProperty, updatedAt }`. Template: Prioridades→"Prioridades", Em andamento/Revisando/
  Revisado→"Em andamento", Finalizada→"Finalizadas"; a sugestão casa por nome (sem acento/caixa)
  com as opções reais do status. Opção inexistente → erro e não salva; renomeada (mesmo id) → aviso.
- **SQLite via `node:sqlite`** (`main/db/database.ts`), arquivo `<userData>/orkio.db`: sem módulo
  nativo nem rebuild. Só essa camada conhece `node:sqlite`. Migrações em `MIGRATIONS` (nunca
  edite uma publicada; acrescente). Versão futura → quadro indisponível, nada é apagado.
  Tabelas: `task_state`, `task_events`, `pending_writes`. **Nada de conteúdo de páginas**.
- Reconciliação (`shared/board.ts` `reconcile`): pendente → fica; status compatível com a etapa
  salva → fica; senão "Etapa Orkio" compatível ou primeira etapa com o status (evento
  `source='notion'`); nenhuma etapa → "Sem etapa". Depois de confirmar uma escrita, 30 s de
  tolerância a leitura atrasada do Notion; "Atualizar" (force) zera essa tolerância.
- Escrita: `PATCH /v1/pages/{id}` `{ properties: { <id>: { status|select: { name } } } }` (status
  existente por nome; escrita **não cria** opção de status). Só se o status mudar; "Etapa Orkio" e
  checkbox de "Bloqueada" no mesmo PATCH. Precisa da capacidade **Update content** (sem ela: 403;
  reconectar não resolve). 404 em OAuth → "Reconectar com Notion".
- `NotionWriteQueue`: uma pendência por tarefa (a última vence; o rollback é o da primeira),
  calculada contra os últimos valores conhecidos do Notion (mover e voltar cancela). Transitório
  (rede/5xx/429/sem conexão) → backoff 1 s…5 min sem limite; 400/403/404 → rollback + evento.
  Retoma ao abrir o app. Resultado ao renderer por `board:sync-changed` (`onSyncChanged`).
- "Etapa Orkio": select existente (opções faltando só com confirmação) ou criar via
  `PATCH /v1/data_sources/{id}` (só com confirmação explícita). "Bloqueada": local; opcionalmente
  sincronizada com um checkbox existente (aí o Notion manda na reconciliação).
- UI: tela **Quadro** (projetos vinculados). Arrasto por ponteiro adaptado do template
  `kanban-board` (sem StyleX; `style` só no card arrastável/flutuante e no `flexShrink` da coluna)
  e "Mover para…" no menu do card e no painel (teclado). Painel lateral dentro da página (sem gaveta).

## Automações (Etapa 3B)

- **Motor puro** (`shared/automation.ts`): `toSnapshot` (só ids, estados, datas; nada de títulos,
  textos ou autores) → `deriveEvents(anterior, novo)` → `evaluate(eventos, regras, estado)`.
  Primeira observação = linha de base (não dispara). Parte desconhecida (GitHub indisponível,
  GraphQL falhou) não gera evento; `mergeSnapshot` mantém o último valor conhecido.
- Eventos e chaves (únicas em `task_events.event_key`): `branch:<local|remote>:<nome>`,
  `pr#N:opened|ready|merged`, `pr#N:closed:<closed_at>`, `pr#N:review_request:<id>`,
  `pr#N:review:<id>` (changes_requested/approved), `pr#N:threads:<ids novos>`. Os ids vêm do
  GraphQL da 2D estendido (`timelineItems` REVIEW_REQUESTED_EVENT, `reviews`, `reviewThreads.id`).
- Ordem: ciclo de vida sem horário (branch, aberta, pronta) → demais por horário do GitHub →
  merge/fechamento. Para cada evento, a **primeira regra habilitada que casar** age; condições
  usam a etapa já atualizada pelo evento anterior. Bloqueada (`notBlocked`), pausada (tarefa ou
  global) ou movida à mão depois do horário do evento → `automation` com `outcome: skipped` e
  motivo; o evento é consumido (não reaplica ao despausar).
- Regras em `boards[projectId].rules` (`defaultRules` ao criar o quadro e na migração v3→v4,
  etapas pelo nome; etapa ausente → regra desligada). Pausa global em `automation.paused`.
- Execução: `BoardService.applyAutomationMove` é o mesmo caminho do manual (`source:'automation'`,
  detalhe com `ruleId`, evento e `pr {number, owner, repo}`). Chave + estado + escrita pendente +
  snapshot numa transação: nunca repete, nunca perde (Notion fora → pendente).
- Agendador (`AutomationScheduler`): projetos com quadro e vínculo; ciclo ao abrir e a cada ~60 s
  (±10%); erro/rate limit → backoff 2^n × 60 s até 15 min; `for-each-ref` local a cada 5 s e
  `HeadWatcher` (via `onBranchChanged`) → ciclo imediato. "Atualizar" no quadro = `runNow` (force).
- Notificação de desktop (`Notification`) só em regras com `notify` (padrão: PR fechada sem
  merge). Clique → `board:open-task` abre a tarefa no quadro. Movimento automático →
  `board:changed` recarrega a tela.

## Fluxo do projeto (Etapa 3C)

- Tela `FlowPage` (botão "Fluxo do projeto" no quadro): rascunho local; nada vale até "Salvar
  fluxo". O main valida de novo (`validateFlow`, a mesma função) e grava `boards[id].stages/rules`
  (formato da config inalterado, v4).
- `validateFlow`: **erros** (bloqueiam) = etapa sem status válido, nome vazio/repetido, regra para
  etapa removida (destino ou origem), notificação sem mensagem, etapa removida com tarefas sem
  destino. **Avisos** (exigem "Entendi os avisos") = conflito (mesmo gatilho, origens que se
  sobrepõem, destinos diferentes: diz qual vence pela ordem), ciclo instantâneo (A→B e B→A pelo
  mesmo gatilho), regra inalcançável.
- Simular = `simulate` (motor `evaluate` da 3B sobre o rascunho, sem gravar nada).
- Remover etapa com tarefas: as tarefas vão para o destino escolhido pelo caminho do movimento
  manual (escrita no Notion só se o status mudar).
- Exportar/importar: `{ format: 'orkio-flow', version: 1 }`, etapas por chave e status por NOME
  (portável entre projetos); versão futura é recusada. Diálogos abertos pelo main.
- Histórico de configuração: `config_events` (SQLite v3) com quem (`os.userInfo().username`),
  quando e o quê (`diffFlow`). Também registra a criação do quadro.

## Claude Code (Etapa 4A)

- **CLI, não SDK:** `claude -p --output-format stream-json --verbose --input-format stream-json`
  via `spawn` sem shell, cwd = worktree. Usa o login do usuário (assinatura). O Orkio **não pede nem
  guarda** chave da Anthropic; `sanitizeEnv` tira `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`,
  `CLAUDE_CODE_OAUTH_TOKEN`, `ELECTRON_*`, `ORKIO_*`, `MAIN_VITE_*` do ambiente do processo.
  O PATH ganha as pastas usuais (`~/.local/bin`, `~/.claude/local`, Homebrew...), pois apps
  abertos pelo Finder não herdam o PATH do terminal.
- Detecção (`detect.ts`): `claude --version` (mínimo `CLAUDE_MIN_VERSION`) e `claude auth status`
  (JSON; só `loggedIn`/`authMethod` são lidos; e-mail nunca).
- **Worktree** (`worktree.service.ts`): `<userData>/worktrees/<projectId>/<ID>`; reutiliza worktree
  registrado → branch local da tarefa → branch remota → cria `<ID>/<slug>` a partir de
  `<remote>/<default>` (fetch antes). Branch já em checkout na pasta principal → erro claro.
  A pasta principal do usuário nunca é tocada. "Limpar ambiente" remove só o worktree (a branch
  fica); com mudanças pendentes exige confirmação (`force`).
- **Permissões em camadas:** `--permission-mode acceptEdits`, `--settings` (bloqueio de escrita fora
  do diretório + deny de push/`gh pr`/`gh api`) e `--permission-prompt-tool mcp__orkio__approve`.
  A ponte (`bridge/permission-mcp.ts`, roda no Node do Electron com `ELECTRON_RUN_AS_NODE`) fala com
  o main por socket local (0600, token aleatório no mcp-config 0600 apagado no fim).
  `policy.ts`: push (qualquer forma, inclusive `env X=1 git push`), `gh pr|api|release` e caminhos
  fora do worktree → bloqueio sem perguntar (evento `run_blocked`); shell → pergunta (uma vez /
  sempre neste projeto por prefixo em `permission_rules` / negar), com notificação; 10 min sem
  resposta → nega. `AskUserQuestion` → card de pergunta; respostas voltam em `updatedInput.answers`.
- **Execuções** (`run.service.ts`): no máximo 2 em paralelo, 1 por tarefa (fila). `agent_runs`
  (SQLite v4) + `<userData>/runs/<id>.jsonl` só com eventos normalizados (nunca o stream cru),
  mantendo 10 por tarefa. Todo texto passa por `redactSecrets` + valores lidos dos `.env*` do
  worktree (só em memória). Ao abrir o app, execuções "em andamento" viram `failed`; ao fechar,
  todas são canceladas (SIGINT → SIGTERM 5 s → SIGKILL 10 s).
- Briefing: blocos da página (até 3 níveis, 400 blocos) → markdown + campos + PR; editável antes
  de rodar e gravado em `.orkio/briefing.md` (com `.orkio/.gitignore` = `*`). Não vai ao Notion.
- Resumo ao terminar: `git diff --stat`/arquivos e commits desde a base e comandos de teste vistos.
  "Abrir no Cursor/VS Code" (`spawn` sem shell, `cursor`/`code` no PATH) e "Ver diff".
- Eventos ao renderer: `claude:run-event` (`onRunEvent` → unsubscribe). Histórico da tarefa ganha
  `run_started|finished|cancelled|failed|blocked`.

## Claude Code (Etapa 4B)

- **Catálogo** (`claude/catalog.ts`): `~/.claude/commands|skills`, `.claude/` do worktree (ou da
  pasta do projeto) e plugins de `~/.claude/plugins/installed_plugins.json` (`installPath` →
  `commands/*.md`, `skills/*/SKILL.md`). Lê **só** `name`/`description` do frontmatter (8 KB do
  começo); nunca o corpo, settings ou credenciais. Agrupado por origem, com busca e "Recarregar".
- **Rodar de novo**: `agent_runs.input_text` (SQLite v5) guarda o prompt/argumentos (redigidos);
  o briefing é montado de novo do Notion, nunca guardado.
- **Artefatos** (`claude/artifacts.service.ts`, tabela `task_artifacts`): documentos alterados
  desde a base (`isDocFile`: md/mdx/txt/adoc/rst, fora de `.orkio/`). Anexar exige o arquivo
  commitado e guarda caminho + commit. Publicar lê o arquivo **no commit** (`git show`), redige
  segredos, limite de 150 mil caracteres, sempre com confirmação na UI:
  - subpágina: `POST /v1/pages` `{ parent: { page_id }, properties.title, markdown,
markdown_version: 'v2' }`;
  - seção: `PATCH /v1/pages/{id}/markdown` `{ type: 'insert_content', insert_content: { content,
position: { type: 'end' } } }` (documentado como legado, ainda suportado).
    Ambos exigem a capacidade **Insert content** (403 → mensagem própria). Eventos
    `artifact_attached`/`artifact_published` no histórico.
- **Contexto do projeto** (`orkio-config` v5 → `claudeContexts[projectId]`): instruções (até
  8.000) + até 5 páginas do Notion (só id/nome; conteúdo lido na hora). No briefing, seção
  "Contexto do projeto" limitada a 30.000 caracteres (`buildProjectContext`): o que passar é cortado
  e vira aviso no formulário; página ilegível também. Tela "Contexto do Claude" no quadro.

## Fluxos de tarefa (Etapa 5A)

- **Nome:** "Fluxo do projeto" (3C) = etapas + automações; "Fluxos de tarefa" (5A) = sequências de
  passos que rodam numa tarefa (`shared/task-flow.ts`, tipos `Flow`/`Step`/`StageFlow`).
- **Config** (`orkio-config` v6): `flows[projectId] = { flows, bindings }`; a ligação etapa → fluxo
  (`{ stageId, flowId, enabled, mode: 'on_enter' | 'manual' }`) é editada no "Fluxo do projeto"
  ("Fluxo desta coluna") e gravada pelo mesmo "Salvar fluxo" (com histórico de configuração).
- **Passos:** `claude_command` (comando do catálogo, args com `{{briefing_path}}`, `{{task_id}}`,
  `{{notion_url}}`, `{{flow.<chave>}}`, tempo limite, extrator opcional), `gate` (mensagem, mostra
  diff/resumo, `onReject` = passo ou `stop`, expiração opcional), `orkio_action` (registro em
  código; hoje só `noop`) e `branch` (condição sobre resultado de passo, variável ou voltas;
  `all`/`any`). Extratores também são registrados em código (exemplo: `linhas_orkio`, lê
  `@orkio chave=valor` do resultado).
- **Motor puro:** `startFlow`/`afterStep`/`skipStep`/`retryStep`; saltos são resolvidos sem execução;
  falha/cancelamento **sempre pausam**; gate recusado vai para `onReject`; trava de 50 passos.
  `validateTaskFlow` (mesma no editor e no main): salto para passo inexistente, volta para trás sem
  condição de voltas (ou pelo "senão") = erro; comando fora do catálogo/variável desconhecida = aviso.
- **Execução** (`main/flows/flow-runner.ts`, SQLite v6 `flow_runs`/`flow_steps`):
  - Um fluxo por tarefa; cada comando é uma execução da 4A (`ClaudeService.startForFlow`, mesmo
    worktree/branch/limite de paralelismo); execução manual do Claude Code fica bloqueada com
    fluxo ativo. Briefing montado uma vez por fluxo, só em memória (`flow_json` guarda a cópia do
    fluxo; `state_json` só variáveis, visitas e resultados).
  - `on_enter`: `BoardService.onStageChanged` com a origem; dispara só com `manual`/`automation`
    (nunca `notion`, `rollback` ou `stage_removed`). "Rodar fluxo" no painel = fluxo ligado à
    etapa atual.
  - Reabrir o app: gate continua em gate; passo rodando (ou entre passos) vira `interrompido`
    (Retomar deste passo / Pular / Cancelar). O `dispose()` antes do `cancelAll` da 4A evita que o
    fechamento conte como falha.
  - Tarefa saiu da etapa → `awaiting_decision` (Cancelar / Deixar terminar); o passo atual termina,
    mas o fluxo só avança com a escolha.
  - Notificação de desktop em gate, pausa e saída da etapa; evento `task-flows:changed` à tela;
    histórico com `flow_started`, `step_*`, `gate_*`, `flow_paused`, `flow_finished`.
- **UI:** editor "Fluxos de tarefa" (do Fluxo do projeto), seção "Fluxo" no painel (linha do tempo,
  gate, pausas, decisão; o log ao vivo é o da seção Claude Code, que segue a execução nova) e token
  "Fluxo"/"Esperando você" no card (`active-flows.tsx`, contexto React).

## alva-flow (Etapa 5B)

- **Plugin:** alva-flow v1.0.25; comandos `/alva-flow:spec|plan|implement|review|fix|commit|pr`
  (não existem `/tests` nem `/security`). Estado no Backlog.md: `backlog/tasks/task-<N> - <título>.md`,
  frontmatter `id: TASK-<N>`/`title`/`status`, critérios entre `<!-- AC:BEGIN/END -->`, "Perguntas
  em aberto" na descrição. Usamos o `id` do frontmatter como está (`TASK-12`).
- **Pré-checagem** (`alva/precheck.ts`, tela "alva-flow" no quadro): plugin + versão (catálogo e
  `.claude-plugin/plugin.json`), `backlog/config.yml` + `backlog/tasks/`, MCP do Backlog
  (`claude mcp list` numa pasta neutra = escopo do usuário; só no projeto = aviso, porque o worktree
  é outra pasta e não é "confiável"), `gh auth status` (só o código de saída), `python3`, Makefile
  com `test`/`lint`, Docker Compose ≥ 2.24.4 rodando (se houver compose). Lê só nome/status e
  códigos de saída. Itens faltando bloqueiam só os fluxos com marcador `alva` (`canStart`).
- **Vínculo** (SQLite v7 `alva_links`, só ids): o 1º `/spec` recebe `alva.spec_arg` = "ORK-142 —
  título. Tarefa no Notion: <url>. Briefing completo em .orkio/briefing.md." (o `/pr` acha o link do
  Notion na task e não pergunta). Depois do passo, o extrator `alva` compara `backlog/tasks/` antes e
  depois no worktree: uma task nova → vínculo; várias → o fluxo pausa pedindo a escolha
  (`needs_choice`); nenhuma → passo falha com explicação. Com vínculo, `alva.task_id`/`alva.spec_arg`
  = ID.
- **Variáveis:** `alva.task_id`, `alva.status`, `alva.open_questions`, `alva.linked`,
  `alva.review_blocker` (`sim` se o `/review` deixou `Executed`), `alva.size` (Médio/Grande pela
  linha "**Tamanho:**" do resultado do `/spec`, heurística; Pequeno = status `Reviewed` depois do
  `/spec`, sinal confiável).
- **Generalizações na 5A** usadas pela integração: extratores assíncronos com "antes do passo",
  falha e escolha; variáveis iniciais por fluxo; chaves com namespace (`{{alva.task_id}}`);
  `{{task_title}}`; `includeBriefing: false` (o comando recebe só os argumentos, porque o texto vira
  `$ARGUMENTS`; o briefing fica em `.orkio/briefing.md`); salto para `$fim`; ação pendente
  (`pending`: vira espera aprovada à mão, recusar cancela); limite por marcador e projeto (o
  excedente espera `waiting_slot` e começa sozinho). `orkio-config` v7 só com campos opcionais.
- **Templates** (`shared/alva-templates.ts`, criados na tela alva-flow e editáveis): "Alva:
  planejar" (/spec → Pequeno termina → perguntas em aberto voltam ao /spec, até 3 → /plan → gate),
  "Alva: implementar e entregar" (sem vínculo: /spec e /plan → /implement (pula se Reviewed) →
  /review → blocker → /fix --apply, no máximo 2 → gate do diff → /commit → push pendente da 5C →
  /pr com 60 min), "Alva: comentários da PR" e "Alva: CI vermelho" (manual). Coluna opcional
  "Planejando" criada pelo mesmo caminho do "Salvar fluxo" com o status escolhido.
- **Execução:** cartão de perguntas com várias por vez, múltipla escolha e "Outro" (texto livre);
  com Docker no projeto, 1 fluxo Alva por vez (configurável até 4); hooks do projeto viram uma linha
  "Hook do projeto rodou" no log (formato do evento não confirmado, leitura tolerante); painel mostra
  "Backlog: TASK-12 · status · critérios" (lido do arquivo) e "Aguardando CI" durante o `/pr`.

## Entrega (Etapa 5C)

- **Regra de ouro:** só a branch da tarefa (a do worktree, com o ID) vai para o GitHub.
  `shared/delivery.ts` (`checkPushBranch`): branch padrão, `main/master/develop/production/staging/
trunk/gh-pages` e `release*/hotfix*` nunca; sem força, sem remoção.
- **Push pelo Orkio** (`orkio_action "push"`, `DeliveryService`): `Git.push` =
  `git push --porcelain -u <remote> refs/heads/<b>:refs/heads/<b>` via `execFile`, com
  `GIT_TERMINAL_PROMPT=0`, `ssh -o BatchMode=yes`, `GCM_INTERACTIVE=never` (credenciais do próprio
  usuário; pedido de senha → `GitError('credentials')` com mensagem pt-BR; recusa → `'rejected'`;
  nunca força). Recusa sem enviar: mudanças não commitadas, nada novo, branch errada/protegida.
- **Ações com confirmação** (`OrkioAction.confirm`): o passo vira gate com o que vai acontecer
  (`ActionConfirm`: destino, commits, `diff --stat`, revisores); aprovar executa; recusar encerra o
  fluxo como recusado; `{ problem }` falha o passo (o fluxo pausa). Persistido em `pendingConfirm`
  (só metadados do git/GitHub). Ações: `push` (gate só com "Exigir minha aprovação para push"),
  `verify_pushed` (`head.sha` da PR == HEAD → `pr.pushed`/`pr.exists`/`pr.number`) e
  `request_review` (quem revisou/foi pedido, ou você escolhe; POST pelo conector; `runNow` da 3B).
- **Modo entrega** (`claude_command.delivery`, só no passo marcado; nunca no "Rodar" manual):
  `RunService` recebe o alvo; o CLI ganha `DELIVERY_RUN_SETTINGS` (deny de força/delete/mirror/
  `gh pr merge|close`/`gh release`/`gh repo`); `delivery-policy.ts` decide:
  - `git push`: só remote do projeto e branch da tarefa (refspec, `HEAD`, `HEAD:x`, sem refspec com
    a branch atual lida antes de avaliar); bloqueia `-f`/`--force*`/`+x`/`:x`/`--delete`/`--all`/
    `--tags`/`--mirror`, opções globais além de `-C`, `push.default=matching` e troca de branch na
    mesma linha.
  - `gh pr create|view|edit|checks|comment|diff|list|status|ready`, `gh run view|list|watch`,
    `gh label list` (com `-R`/URL só do próprio repo; `--head` só a branch da tarefa).
  - `gh api`: REST só `repos/<owner>/<repo>/…` do projeto; escrita só em PR/comentários/revisores
    (nada de merge, refs, contents, `state=closed`, APPROVE); nunca DELETE; GraphQL com o mesmo repo
    e mutations só da allowlist (`resolveReviewThread`, `addPullRequestReviewThreadReply`,
    `addComment`…); consulta em arquivo é recusada.
  - Primeira vez de cada categoria (`push`, `github`) por execução: pergunta ("Permitir nesta
    execução"; "sempre neste projeto" não vale). Com "Exigir minha aprovação para push", todo push
    pergunta. O log marca "Liberado pelo modo entrega".
- **Aliases:** no começo de toda execução, `git config --get-regexp ^alias\.` e `gh alias list`
  (no worktree) são expandidos pela política (também fora do modo entrega); `git -c alias.*` é
  recusado. `shellSegments`/`shellWords` seguem as aspas do shell.
- **Sinais:** `PullRequestSummary.headSha` (REST) e logins de `reviews.author`/
  `requestedReviewer` (GraphQL, só em memória; o snapshot da 3B continua só com ids).
  `TaskSignalsService.prForBranch` (sem rede) dá o número da PR para o histórico.
- **Etapa:** automação que move a tarefa durante um passo de entrega (a PR aberta pelo `/pr`) não
  interrompe o fluxo: ele deixa de acompanhar a etapa e segue.
- **Histórico:** evento `delivery` (`action`: push, pr_create, pr_edit, pr_comment, pr_ready,
  thread_reply, thread_resolve, review_request; `by`: orkio/claude) com owner/repo/branch e PR;
  link para a PR ou `github.com/<o>/<r>/tree/<branch>` (allowlist).
- **Ajuste por projeto:** `orkio-config` v8 → `delivery[projectId].requirePushApproval` (padrão
  sim), na tela "Fluxos de tarefa", com histórico de configuração.
- **CI:** token do CI da PR no painel (sinais 2D) e "Rodar fluxo CI vermelho" (`startById`) quando
  os checks falham e o template existe.
- **Segurança:** nenhum token do Orkio no ambiente do Claude (o `gh` usa o `gh auth` do usuário);
  o único POST do conector do GitHub é `requested_reviewers` (caminho validado).

## Empacotamento e releases (Etapa 6B)

- **Config:** `electron-builder.ts` (TypeScript, achado pelo nome; `builderConfig(env)` é pura e
  testada em `test/electron-builder-config.test.ts`). Nomes com a arquitetura
  (`Orkio-<v>-mac-<arch>.dmg|zip`, `Orkio-<v>-win-<arch>-setup.exe`): o site
  (`site/lib/releases.ts`) e o auto-update (6C) dependem deles. Linux comentado.
- **Assinatura pelo ambiente:** mac assinado só com `CSC_LINK`/`CSC_NAME` (hardened runtime,
  `build/entitlements.mac.plist` só com `allow-jit`, notarização se houver `APPLE_*`); senão ad-hoc
  (`identity: '-'`) **sem** hardened runtime. Windows só com `WIN_SIGNING=azure` + `AZURE_SIGNING_*`.
  O workflow passa `MAIN_VITE_MAC_SIGNED=1` no build quando o mac é assinado.
- **Fuses:** `runAsNode` **ligado** (a ponte MCP roda o executável com `ELECTRON_RUN_AS_NODE=1`; não
  desligue), `onlyLoadAppFromAsar` e cookies criptografados ligados, `NODE_OPTIONS`/`--inspect`
  desligados. Integridade do asar ainda desligada (falta testar no mac/Windows).
- Sem dependências de runtime hoje; `npmRebuild: false`. Não exclua `node_modules` em `files` (o
  `electron-updater` da 6C é dependência de runtime).
- **Smoke** (`e2e-packaged/`, config própria): abre o binário de `dist/` com
  `--remote-debugging-port` e conecta por CDP (o `_electron` do Playwright precisa do `--inspect`,
  desligado pelo fuse), confere tela inicial/CSP, e roda `app.asar/out/main/permission-mcp.js` com
  `ELECTRON_RUN_AS_NODE` contra um socket simulado.
- **Versões:** `version` do `package.json` + tag `vX.Y.Z` (beta: `X.Y.Z-beta.N` → pre-release).
  `pnpm release` (`scripts/release.mjs`, lógica pura em `release-lib.mjs`) exige `main` limpa e
  itens em `## [Não lançado]`; move para `## [X.Y.Z] - AAAA-MM-DD` (formato lido pelo release e
  pela 6C). Não faz push.
- **Workflows:** `ci.yml` (PR/push na main, sem `site/**`; lint, typecheck, test, e2e Linux,
  `package-smoke` Linux; E2E no macOS só por dispatch). `package.yml` (dispatch = empacota sem
  publicar e sobe artefatos; `workflow_call` com `publish`). `release.yml` (tag): `release-check` →
  `ci.yml` → rascunho em `orkio-releases` (notas do CHANGELOG) → `package.yml` com
  `--publish always` → confere arquivos e publica. Segredos só no `env` do passo; sem `set -x`.
- Passo a passo (repo, token, Apple, Microsoft, custos): `docs/releases.md`.

## Testes

- Unitários (Vitest): `src/**/*.test.ts` ao lado do código; `test/` para testes de projeto
  (ex.: `test/csp-build.test.ts` faz um build real do renderer e falha se a CSP de produção
  ganhar `'unsafe-inline'`/`'unsafe-eval'`, scripts/estilos inline ou fontes em `data:`).
- E2E (Playwright + Electron): `e2e/`. `e2e/fixtures.ts` abre o build de `out/` com
  `--user-data-dir` temporário e, **via `app.evaluate` no teste**, substitui `fetch`
  (API simulada) e `shell.openExternal`. Nunca adicione hooks/variáveis de teste ao código
  do app para isso. No Linux sem keyring, o fixture liga a criptografia básica do Electron
  só no teste.
- Para novos conectores: adicione o modo fake correspondente no fixture e um spec em `e2e/`.
- Claude Code simulado (4A): `e2e/fake-claude/claude` (script Node) é copiado para uma pasta
  temporária e posto **primeiro no PATH** em todo E2E (o CLI real nunca roda). Login por
  `launchOrkio(..., { claude: { loggedIn, installed } })`. Cenário por palavras no prompt
  (`pedir-shell`, `perguntar`, `tentar-push`, `ler-env`, `demorar`); usa a ponte MCP real.
  O fixture põe uma `ANTHROPIC_API_KEY` falsa no ambiente para provar o filtro.
- 5B: `launchOrkio(..., { alva: { plugin, mcpBacklog, gh, blockers } })` instala o plugin
  simulado no HOME de teste, controla `claude mcp list` e um `gh` simulado no PATH. O Claude simulado
  imita `/alva-flow:*` (cria/muda `backlog/tasks/task-1 - …md`, perguntas em lote no `/spec`,
  blocker nos primeiros `blockers` reviews) e registra os argumentos em `.orkio/alva-args.log`.
- 5C: o `gh` simulado registra cada chamada em `<userData>-bin/gh-calls.log` (`ghCalls`); o
  Claude simulado imita o `/alva-flow:pr` (tenta merge e força, que devem ser bloqueados; cria a PR
  pelo gh; pergunta do CI) e o `--comments` (commit, push pedido, resolveReviewThread pelo gh api),
  registrando `allow:`/`deny:` em `.orkio/alva-args.log` e o ambiente em `.orkio/env.txt`. O GitHub
  simulado tem `FakePull.sha`, autores/revisores, POST `requested_reviewers` (registra em
  `notionState(app).reviewRequests` e muda `updated_at`) e colaboradores. O push vai para um
  `origin.git` local (git real).
- 5A: o simulado tem `demorar-uma-vez` (espera só na primeira vez, marcador em `.orkio/demorou`)
  e `falhar` (sai com erro). `e2e/task-flows.spec.ts` monta o fluxo pela tela e edita o
  `orkio-config.json` entre aberturas para trocar os argumentos do passo.
- 4B: o fixture usa um `HOME` temporário (com `~/.claude/commands/revisar.md`); o cenário
  `escrever-doc` gera `docs/exportar.md`; o Notion simulado registra publicações em
  `notionState(app).published` e responde à busca de páginas (`filter.value: 'page'`).
- Diálogos simulados: `queueFolderPicks` (abrir) e `queueSavePaths` ("Salvar como…").
- GitHub simulado (3B): `githubPrDetails[n].reviews`/`reviewRequests` e `FakePull.updatedAt` (o
  Orkio só relê detalhes quando `updated_at` muda). `notionInitialStatus` mantém o Notion
  simulado igual entre aberturas do app.
- Notion simulado com escrita (3A): `notionNetwork: 'down'` (sem internet), `notionWrites:
'reject'` (400); `setNotionStatus` muda o status "por fora"; `notionState` lê o estado.
- GitHub simulado (2D): `githubBranches`, `githubPulls`, `githubPrDetails`; listas com ETag
  (304 quando `If-None-Match` bate) e GraphQL por alias. `__calls` registra `ifNoneMatch`/`status`.
- Notion simulado: `notionTasks` (`ok`, `no_unique_id`, `renamed`, `status_deleted`) e ids fixos
  em `NOTION_FAKE` (`e2e/fixtures.ts`). Selector da Astryx no E2E: gatilho com papel `button`
  (sem valor) ou `combobox` (com valor), nome começando pelo rótulo; opções têm papel `option`.

## Decisões registradas

| Decisão                                                                                                     | Por quê                                                                                                                                                                                                                                                     |
| ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No Linux, `safeStorage` com backend `basic_text` (ou `unknown`) conta como **indisponível**                 | `basic_text` usa uma senha fixa no binário: equivale a texto puro. Sem GNOME Keyring/KWallet o app não salva o token e mostra erro.                                                                                                                         |
| `ConnectionStatus` tem `warning?` (em `connected`) e `hasStoredCredentials?` (em `error`)                   | `warning`: falha transitória (rede, 5xx, 429) ao revalidar não "desconecta" o usuário (ex.: abrir offline). `hasStoredCredentials`: diferencia "token salvo inválido" (oferece Tentar novamente/Desconectar) de "falha ao conectar" (mostra o formulário).  |
| CSP estrita em produção; `style-src 'unsafe-inline'` **só no dev server**                                   | O Vite injeta CSS via `<style>` em dev. O plugin `orkio:dev-only-relaxed-style-csp` tem `apply: 'serve'`; `test/csp-build.test.ts` e o E2E garantem que o build não muda.                                                                                   |
| `fetch` nativo em vez de SDKs (`@notionhq/client`)                                                          | Poucos endpoints; controle direto de timeout (`AbortController`), `Retry-After` e mensagens; fácil de mockar; sem dependência extra.                                                                                                                        |
| Main e preload saem em **CommonJS** (sem `"type": "module"`)                                                | Preload com `sandbox: true` não pode ser ESM. O preload só pode dar `require('electron')`: tudo o mais é empacotado nele.                                                                                                                                   |
| `postinstall: install-electron`                                                                             | O Electron 45 não baixa o binário na instalação, e o `electron-vite` precisa dele (`path.txt`). Sem isso `pnpm dev` falha num clone novo.                                                                                                                   |
| React e `@fontsource/*` em `devDependencies`                                                                | O Vite já os embute no bundle do renderer; assim o pacote do electron-builder não leva `node_modules` desnecessários.                                                                                                                                       |
| Não definir `productName` no `package.json`                                                                 | Mudaria a pasta `userData` (`orkio` → `Orkio`) e "desconectaria" quem já tem credenciais salvas. O nome do app empacotado fica no `electron-builder.ts`.                                                                                                    |
| Fontes nunca viram `data:` URI                                                                              | A CSP só permite `font-src 'self'` (`assetsInlineLimit` no `electron.vite.config.ts`).                                                                                                                                                                      |
| Notion via OAuth com intermediário (`broker/`, Cloudflare Worker)                                           | O Notion exige client secret na troca do código/renovação e a API REST não aceita PKCE. O secret fica só no Worker, que é stateless e não loga. O MCP do Notion aceita PKCE, mas trocaria a API REST pelas ferramentas MCP (decisão da Etapa 1.5).          |
| Redirect em loopback com porta fixa `47821`                                                                 | O Notion exige redirect URI exato e registrado. `127.0.0.1` (não `localhost`) evita ambiguidade IPv4/IPv6 (RFC 8252). Porta ocupada → mensagem clara.                                                                                                       |
| `startOAuth()` é uma chamada IPC que só resolve no fim                                                      | O OAuth do Notion não tem estado intermediário para mostrar (diferente do Device Flow do GitHub, que exibe um código). Evita um canal de eventos.                                                                                                           |
| GitHub via OAuth App + Device Flow, escopo `repo`, sem `broker/`                                            | Device Flow não exige client secret. `repo` é o único escopo de OAuth App que cobre privados, PRs e comentários (não há só-leitura). GitHub App teria permissões finas, mas tokens de 8 h cuja renovação exige secret (→ broker) e instalação por org/repo. |
| Device Flow com duas chamadas (`startDeviceFlow` + `waitDeviceFlow`) em vez de canal de eventos             | O único dado intermediário (código, URL, expiração) chega no início. Evita expor `ipcRenderer.on`/gerenciar inscrições no preload e não exige polling do renderer.                                                                                          |
| Permissão `clipboard-sanitized-write` liberada                                                              | Botão "Copiar" do código do GitHub. Leitura da área de transferência e demais permissões continuam negadas.                                                                                                                                                 |
| Projetos: seletor de pasta no main + `selectionId`                                                          | O renderer nunca escolhe caminhos arbitrários para o main operar (git, fs).                                                                                                                                                                                 |
| `ConfigStore` JSON (sem SQLite ainda) com backup de arquivo corrompido e modo só leitura para versão futura | Dados pequenos; escrita atômica e migrações bastam. Corrupção não derruba o app; downgrade não destrói dados de uma versão mais nova.                                                                                                                       |
| GitHub Enterprise salvo como "não verificado"                                                               | A conta conectada é do github.com; não há como validar acesso/push no GHE ainda.                                                                                                                                                                            |
| App abre na tela inicial (abertura + "Vamos começar", sem sidebar); "Começar" leva a **Projetos**           | Marca na abertura; a tela inicial vai virar o login com GitHub/Notion. O E2E clica em "Começar" no fixture (a abertura não bloqueia cliques: `pointer-events: none`).                                                                                       |
| Watcher no diretório do git (não no arquivo HEAD)                                                           | O git troca o HEAD via rename (HEAD.lock → HEAD), o que quebra watchers de arquivo.                                                                                                                                                                         |
| UI em Astryx com tema Orkio compilado                                                                       | Pedido do produto. Tema estático (`astryx theme build`) mantém a CSP estrita.                                                                                                                                                                               |
| CSS das camadas da Astryx como arquivo estático                                                             | `ensureSlideRules` só injeta `<style>` se não achar o id; o arquivo estático (gerado e testado contra a versão instalada) evita relaxar a CSP.                                                                                                              |
| Confirmações inline em vez de `AlertDialog`                                                                 | Diálogos usam camadas sobrepostas; inline é suficiente e mantém o risco de CSP baixo.                                                                                                                                                                       |
| Peças de UI dos cards em `connection-ui.tsx`                                                                | Notion e GitHub compartilham conectado/erro/token/desconectar; cada card só implementa o próprio fluxo de login.                                                                                                                                            |
| Mapeamento das Tarefas salvo por **id de propriedade**                                                      | O id é estável a renomeações: renomear vira só aviso (e atualizamos o nome); apagar/mudar tipo é detectado na revalidação.                                                                                                                                  |
| Tarefas do Notion só em memória (cache 60 s, até 500)                                                       | Nada de conteúdo do Notion no disco; o Notion continua a fonte da verdade. 60 s equilibra rate limit (~3 req/s) e frescor; "Atualizar" força.                                                                                                               |
| Config v2 com bloco `notion` inválido → "não configurado" com aviso                                         | Um mapeamento corrompido não pode derrubar a lista de projetos.                                                                                                                                                                                             |
| `InternationalizationProvider` pt-BR da Astryx                                                              | Textos internos dos componentes (Obrigatório, Limpar, busca) seguem a regra de UI em pt-BR.                                                                                                                                                                 |
| SQLite via `node:sqlite` (não `better-sqlite3`)                                                             | Embutido no Node do Electron 45 (Node 24): sem módulo nativo, rebuild nem mudança no empacotamento. API ainda "release candidate": isolada em `db/database.ts`.                                                                                             |
| Escritas pendentes no SQLite, calculadas contra o último valor conhecido do Notion                          | Sobrevivem a fechar o app; mover e voltar antes de sincronizar não gera escrita; rollback restaura o estado anterior à primeira mudança.                                                                                                                    |
| "Bloqueada" local, com checkbox do Notion opcional                                                          | Nem todo banco tem a propriedade; não criamos checkbox sem pedir. Com mapeamento, o Notion é a fonte da verdade.                                                                                                                                            |
| Coluna "Sem etapa"                                                                                          | Status do Notion que nenhuma etapa usa não pode sumir do quadro nem ser forçado numa etapa errada.                                                                                                                                                          |
| Automações: primeira observação é linha de base                                                             | Ligar o quadro (ou um projeto novo) não pode mover tudo pelo histórico antigo de PRs. Depois disso, eventos ocorridos com o app fechado disparam ao abrir (diff com o snapshot salvo).                                                                      |
| Evento ignorado (bloqueada/pausada/conflito) é consumido                                                    | Despausar não deve aplicar de uma vez movimentos antigos; o histórico mostra o que foi ignorado e por quê.                                                                                                                                                  |
| Movimento manual depois do horário do evento vence                                                          | O usuário decidiu depois do GitHub; a automação não desfaz uma escolha mais recente.                                                                                                                                                                        |
| Claude Code via CLI (`claude -p`), não Agent SDK                                                            | O SDK exige chave de API; o CLI usa a assinatura/login do usuário e carrega os plugins dele. O Orkio não guarda credenciais da Anthropic.                                                                                                                   |
| Permissões pelo `--permission-prompt-tool` (servidor MCP do Orkio + socket local)                           | Única forma de o CLI em `-p` perguntar ao app. Bloqueios (push, fora do worktree) ficam no main, não só nas regras do CLI.                                                                                                                                  |
| Log da execução normalizado e redigido                                                                      | Nunca gravamos o stream cru (traria conteúdo de arquivos lidos, inclusive `.env`).                                                                                                                                                                          |
| Fluxo de tarefa: falha sempre pausa; reabrir o app nunca segue sozinho                                      | Um agente não deve continuar depois de algo inesperado sem alguém ver; "Pular" é a forma explícita de seguir (e só então a condição enxerga a falha).                                                                                                       |
| Execução do fluxo guarda uma cópia do fluxo (`flow_json`)                                                   | Editar ou remover o fluxo no meio de uma execução não quebra a execução em curso.                                                                                                                                                                           |
| alva-flow: briefing fora dos argumentos dos comandos                                                        | O texto depois do comando vira `$ARGUMENTS`; o `/plan` receberia "TASK-12 + briefing" e trataria como demanda nova.                                                                                                                                         |
| MCP do Backlog no escopo do usuário                                                                         | Servidores do `.mcp.json` só conectam em pasta confiável; o worktree do Orkio é outra pasta.                                                                                                                                                                |
| Entrega: push só da branch da tarefa, nunca força; branch padrão sempre bloqueada                           | A automação nunca pode reescrever histórico nem publicar fora da tarefa; "Exigir aprovação" só decide se há gate, não o que é permitido.                                                                                                                    |
| Modo entrega por passo (não global), aprovação por execução                                                 | O `/pr` precisa de gh e push; liberar só no passo marcado limita o alcance e o log mostra cada comando liberado.                                                                                                                                            |
| Pedir review pelo conector (não pelo gh do Claude)                                                          | É uma ação do Orkio depois de um gate, com histórico e link; dispara a automação na hora.                                                                                                                                                                   |
| Polling local de 5 s além do HeadWatcher                                                                    | `git branch X` sem checkout não muda o HEAD; `for-each-ref` é local e barato.                                                                                                                                                                               |
| Releases num repo público separado (`orkio-releases`), token fine-grained só nele                           | O código é privado; o site e o auto-update leem releases públicos sem token. O token do CI não lê o código.                                                                                                                                                 |
| Release como rascunho criado antes da matriz, publicado num job final                                       | Os jobs do mac e do Windows sobem para o mesmo release sem duplicar; nada é publicado se um pacote ou smoke falhar.                                                                                                                                         |
| mac sem Developer ID = ad-hoc sem hardened runtime                                                          | Apple Silicon exige assinatura; hardened runtime com ad-hoc recusa o Electron Framework (validação de bibliotecas).                                                                                                                                         |
| Fuse `RunAsNode` ligado                                                                                     | A ponte MCP de permissões é um processo que o CLI do Claude abre com o executável do Orkio + `ELECTRON_RUN_AS_NODE`.                                                                                                                                        |
| CI de PR só no Linux (smoke do pacote incluso)                                                              | Em repo privado, minuto de macOS custa 10x; o mac roda no release, no teste manual e por dispatch.                                                                                                                                                          |

## Astryx e CSP (regra inegociável)

A UI usa Astryx com a **CSP de produção estrita** (`style-src 'self'`). Componentes que injetam
`<style>` em runtime quebram isso. O E2E falha com qualquer violação (`securitypolicyviolation`).

- **Tema** sempre pré-compilado (`__built: true`): o `<Theme>` não injeta nada.
- **Camadas (Layer: popovers, tooltips)** injetariam `astryx-layer-slide-rules`. Entregamos esse
  CSS como arquivo estático (`src/renderer/public/astryx-layer-slide-rules.css`, carregado no
  `index.html` com o mesmo id), gerado por `pnpm astryx:static-css`. Depois de atualizar
  `@astryxdesign/core`, rode o comando de novo; `test/astryx-static-css.test.ts` falha se divergir.
- **Evitar** (injetam `<style>` sem saída estática): `CodeBlock` (destaque), `Chat` (scroll
  anchoring), segmentos nativos do `DateInput`, e a gaveta mobile do `AppShell`
  (`mobileNav={false}`). Diálogos/gavetas: confirmar no E2E antes de usar.
- Dúvida se um componente injeta estilo? `grep -rl "createElement('style')" node_modules/@astryxdesign/core/dist`.
- `astryx doctor --built src/renderer` deve terminar sem falhas. Os avisos restantes são as
  exceções da marca (logo/ícones SVG, classes Jost/mono) e as fontes locais do `@fontsource`.

O bloco abaixo foi gerado por `astryx init --features agents` (não edite entre os marcadores; o
CLI o regenera). Onde ele conflitar com as regras acima (CSP, exceções da marca), valem as acima.

<!-- prettier-ignore-start -->
<!-- ASTRYX:START -->
Astryx v0.7.16 · 90+ components
CLI: run every command as `pnpm exec astryx <cmd>` (shown below as `astryx ...`).

SETUP (once, in app entry e.g. main.tsx) — without these, components render unstyled:
  import "@astryxdesign/core/reset.css";
  import "@astryxdesign/core/astryx.css";

WORKFLOW — start every page from a template, never from scratch:
1. `astryx build "<idea>"` — names the template to scaffold from and the parts it lacks.
2. `astryx template <name> <path>` — scaffold it; keep its frame, gap and padding; replace the content.
3. `astryx template <Block>` for parts it lacks; `astryx component <Name>` to read props before using one.
Changing an existing page? Keep it: skip step 2 and add blocks/components inside its sections.
Before you deliver a build, run `astryx doctor --built <dir>`; don't deliver it if it fails.

RULES:
- No <div> — components handle all layout and spacing.
- Read `astryx docs layout` before changing a template's frame.
- Dense data = rows (Table, List/Item), not Card-wrapped lists. Badge = counts only.
- Style with component props first, then tokens (var(--color-*|--spacing-*|--radius-*)). No raw hex/px. No StyleX/Tailwind compiler here — don't use xstyle/utility classes directly. Some templates use StyleX and need a compiler plugin; see `astryx docs styling-overview`.
- THEMES: palettes and custom colors go through the theme, never :root overrides. To make or change a theme (colors, fonts, corners, spacing, a look from a picture), prefer the experimental theme editor over hand-written theme files: `astryx experimental theme editor new <name> --like neutral`, then `editor set <name> <thing> <value>` or `editor how "<what you want>"`; wire it with `astryx theme add <name>`; after each change look at it with `astryx experimental theme editor show <name> --png` and open the PNGs it writes (changes nothing in the app); a theme change is not done until you have looked at the pictures. In code, extend an imported theme to customize it; `theme eject <slug>` only forks source. See `astryx docs theme`.
- SELF-CHECK: re-read the file; replace any raw <div>/<span>, imported .css/@apply, or hardcoded #hex/px with the component or a token.

`astryx help` lists every command. Key ones beyond the workflow:
  search "<query>"   find any component / hook / doc / template
  discover <words>   integrations you could add
  docs <topic>       getting-started, principles, tokens, theme … (`astryx docs` lists all)
  docs cli           commands and API reference
  docs authoring     build an integration package, and every field it holds
  upgrade --from <old version> --apply   run after a dependency bump
<!-- ASTRYX:END -->
<!-- prettier-ignore-end -->
