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
- **UI:** design system Astryx com o tema Orkio, CSP estrita, textos da Astryx em pt-BR.
- Ainda não existem: escrita no Notion, kanban, PRs, automações, Claude Code.

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
pnpm dist         # empacota (electron-builder.yml)
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
    config/orkio-config.ts   # formato do orkio-config.json (schema v2: projects + notion)
    git/git.ts             # git local via execFile (nunca exec/shell)
    projects/              # remote-url.ts (parser puro), projects.service.ts, head-watcher.ts
    notion/                # notion-workspace.service.ts (bancos, mapeamento, vínculo, tarefas)
    signals/               # github-signals.source.ts (ETag, GraphQL) + task-signals.service.ts
  preload/index.ts         # contextBridge → window.orkio (API mínima e tipada)
  renderer/src/            # React. Sem acesso a Node; só usa window.orkio.
    features/<feature>/    # componentes + hooks por funcionalidade
      integrations/connection-ui.tsx  # peças comuns dos cards (conectado, erro, token, desconectar)
      projects/            # tela Projetos (useProjects, AddProjectPanel, ActionLink)
      notion-workspace/    # card "Bancos do Notion" (assistente) e seção Notion de cada projeto
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
  marca e com tokens do tema. Nada de CSS de layout.
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
| Não definir `productName` no `package.json`                                                                 | Mudaria a pasta `userData` (`orkio` → `Orkio`) e "desconectaria" quem já tem credenciais salvas. O nome do app empacotado fica no `electron-builder.yml`.                                                                                                   |
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
| App abre em **Projetos**                                                                                    | Com GitHub conectado, é a tela de trabalho; a dica leva a Integrações quando falta conexão.                                                                                                                                                                 |
| Watcher no diretório do git (não no arquivo HEAD)                                                           | O git troca o HEAD via rename (HEAD.lock → HEAD), o que quebra watchers de arquivo.                                                                                                                                                                         |
| UI em Astryx com tema Orkio compilado                                                                       | Pedido do produto. Tema estático (`astryx theme build`) mantém a CSP estrita.                                                                                                                                                                               |
| CSS das camadas da Astryx como arquivo estático                                                             | `ensureSlideRules` só injeta `<style>` se não achar o id; o arquivo estático (gerado e testado contra a versão instalada) evita relaxar a CSP.                                                                                                              |
| Confirmações inline em vez de `AlertDialog`                                                                 | Diálogos usam camadas sobrepostas; inline é suficiente e mantém o risco de CSP baixo.                                                                                                                                                                       |
| Peças de UI dos cards em `connection-ui.tsx`                                                                | Notion e GitHub compartilham conectado/erro/token/desconectar; cada card só implementa o próprio fluxo de login.                                                                                                                                            |
| Mapeamento das Tarefas salvo por **id de propriedade**                                                      | O id é estável a renomeações: renomear vira só aviso (e atualizamos o nome); apagar/mudar tipo é detectado na revalidação.                                                                                                                                  |
| Tarefas do Notion só em memória (cache 60 s, até 500)                                                       | Nada de conteúdo do Notion no disco; o Notion continua a fonte da verdade. 60 s equilibra rate limit (~3 req/s) e frescor; "Atualizar" força.                                                                                                               |
| Config v2 com bloco `notion` inválido → "não configurado" com aviso                                         | Um mapeamento corrompido não pode derrubar a lista de projetos.                                                                                                                                                                                             |
| `InternationalizationProvider` pt-BR da Astryx                                                              | Textos internos dos componentes (Obrigatório, Limpar, busca) seguem a regra de UI em pt-BR.                                                                                                                                                                 |

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
