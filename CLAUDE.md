# CLAUDE.md — convenções do Orkio

App Electron (electron-vite + React + TypeScript strict). Orquestra Notion, GitHub e
Claude Code. Hoje existem os conectores do Notion (OAuth + token) e do GitHub (Device Flow + PAT).

## Comandos

```bash
pnpm install      # postinstall baixa o binário do Electron
pnpm dev          # app em modo dev
pnpm test         # Vitest (src/**/*.test.ts e test/**/*.test.ts, inclui build real p/ checar a CSP)
pnpm e2e          # build (--mode e2e) + Playwright no app Electron (Notion simulado). Linux headless: xvfb-run -a pnpm e2e
pnpm typecheck    # tsc nos dois projetos (node e web)
pnpm lint         # ESLint
pnpm build        # build em out/
pnpm icons        # regenera ícones a partir de brand/orkio-app-icon-1024.png
pnpm dist         # empacota (electron-builder.yml)
```

Antes de dar uma tarefa por concluída: `pnpm typecheck && pnpm lint && pnpm test`.
Mudou UI, IPC, preload, segurança ou build? Rode também `pnpm e2e`.

## Estrutura

```
src/
  shared/ipc-contract.ts   # canais IPC, ConnectionStatus, credenciais, OrkioApi. Sem Node/DOM.
  main/                    # processo main (Node). Único lugar com rede, disco e segredos.
    index.ts               # janela, segurança, wiring de dependências e IPC
    connectors/types.ts    # interface Connector
    connectors/<id>/       # <id>.client.ts (HTTP) + <id>.oauth.ts + <id>.connector.ts
    oauth/                 # fluxos genéricos: loopback.ts (redirect, RFC 8252), device-flow.ts (RFC 8628)
    net/parse.ts           # helpers puros de parsing (isRecord, Retry-After, ...)
    ipc/                   # handlers finos: validam origem e payload, delegam ao conector
    storage/secure-store.ts
  preload/index.ts         # contextBridge → window.orkio (API mínima e tipada)
  renderer/src/            # React. Sem acesso a Node; só usa window.orkio.
    features/<feature>/    # componentes + hooks por funcionalidade
      integrations/connection-ui.tsx  # peças comuns dos cards (conectado, erro, token, desconectar)
    components/OrkioLogo/  # logo (símbolo full/simple + wordmark)
    styles/tokens.css      # ÚNICO arquivo de tokens (cores, fontes, raios, espaçamento)
    styles/fonts.css       # fontes locais via @fontsource
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
- Futuras chamadas à API devem usar `withAccessToken` do conector (renova em 401).
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

## Identidade visual

Leia `brand/BRAND.md` antes de mexer em UI.

- Cores só via tokens de `styles/tokens.css`. Nada de hex/rgb fora dele. Única exceção:
  `backgroundColor` do `BrowserWindow` no main (espelha `--bg`).
- Inter = UI; Jost (`--font-brand`) só para logo e títulos grandes; mono para IDs e tokens.
- Fontes vêm de `@fontsource` (importadas em `styles/fonts.css`). Nunca use CDN. O build
  não transforma fontes em `data:` URI (`assetsInlineLimit` no `electron.vite.config.ts`).
- Logo: use `<OrkioLogo>`. Abaixo de 48 px ele usa a versão simple automaticamente.
  Wordmark "ORKIO" em Jost 300, letter-spacing 0.25em (Jost 400 se ≤ 18 px).
  Não distorcer, girar nem aplicar gradiente/sombra.
- Laranja com parcimônia: ação principal, símbolo, estados de agente.
- Texto sobre laranja é sempre `--on-accent` (preto). Nunca branco.
- Ícones: não edite `build/` à mão; troque `brand/orkio-app-icon-1024.png` e rode `pnpm icons`.

## Estilo

- TypeScript strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`).
- Prettier: sem ponto e vírgula, aspas simples, 100 colunas.
- UI: dark mode, CSS puro com os tokens de `styles/tokens.css`; sem bibliotecas de UI.
  Botão primário: fundo `--accent` com texto `--on-accent` (preto). Mono (`--font-mono`)
  para IDs e tokens.
- CSP: nada de `<style>`/`<script>` inline nem atributo `style` no HTML em produção.
  `style-src` só é relaxado no dev server (`electron.vite.config.ts`). A prop `style` do React
  (aplicada via CSSOM) é permitida para variáveis CSS dinâmicas, como no `OrkioLogo`.
- Textos de UI em pt-BR.

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

## Decisões registradas

| Decisão                                                                                         | Por quê                                                                                                                                                                                                                                                     |
| ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No Linux, `safeStorage` com backend `basic_text` (ou `unknown`) conta como **indisponível**     | `basic_text` usa uma senha fixa no binário: equivale a texto puro. Sem GNOME Keyring/KWallet o app não salva o token e mostra erro.                                                                                                                         |
| `ConnectionStatus` tem `warning?` (em `connected`) e `hasStoredCredentials?` (em `error`)       | `warning`: falha transitória (rede, 5xx, 429) ao revalidar não "desconecta" o usuário (ex.: abrir offline). `hasStoredCredentials`: diferencia "token salvo inválido" (oferece Tentar novamente/Desconectar) de "falha ao conectar" (mostra o formulário).  |
| CSP estrita em produção; `style-src 'unsafe-inline'` **só no dev server**                       | O Vite injeta CSS via `<style>` em dev. O plugin `orkio:dev-only-relaxed-style-csp` tem `apply: 'serve'`; `test/csp-build.test.ts` e o E2E garantem que o build não muda.                                                                                   |
| `fetch` nativo em vez de SDKs (`@notionhq/client`)                                              | Poucos endpoints; controle direto de timeout (`AbortController`), `Retry-After` e mensagens; fácil de mockar; sem dependência extra.                                                                                                                        |
| Main e preload saem em **CommonJS** (sem `"type": "module"`)                                    | Preload com `sandbox: true` não pode ser ESM. O preload só pode dar `require('electron')`: tudo o mais é empacotado nele.                                                                                                                                   |
| `postinstall: install-electron`                                                                 | O Electron 45 não baixa o binário na instalação, e o `electron-vite` precisa dele (`path.txt`). Sem isso `pnpm dev` falha num clone novo.                                                                                                                   |
| React e `@fontsource/*` em `devDependencies`                                                    | O Vite já os embute no bundle do renderer; assim o pacote do electron-builder não leva `node_modules` desnecessários.                                                                                                                                       |
| Não definir `productName` no `package.json`                                                     | Mudaria a pasta `userData` (`orkio` → `Orkio`) e "desconectaria" quem já tem credenciais salvas. O nome do app empacotado fica no `electron-builder.yml`.                                                                                                   |
| Fontes nunca viram `data:` URI                                                                  | A CSP só permite `font-src 'self'` (`assetsInlineLimit` no `electron.vite.config.ts`).                                                                                                                                                                      |
| Notion via OAuth com intermediário (`broker/`, Cloudflare Worker)                               | O Notion exige client secret na troca do código/renovação e a API REST não aceita PKCE. O secret fica só no Worker, que é stateless e não loga. O MCP do Notion aceita PKCE, mas trocaria a API REST pelas ferramentas MCP (decisão da Etapa 1.5).          |
| Redirect em loopback com porta fixa `47821`                                                     | O Notion exige redirect URI exato e registrado. `127.0.0.1` (não `localhost`) evita ambiguidade IPv4/IPv6 (RFC 8252). Porta ocupada → mensagem clara.                                                                                                       |
| `startOAuth()` é uma chamada IPC que só resolve no fim                                          | O OAuth do Notion não tem estado intermediário para mostrar (diferente do Device Flow do GitHub, que exibe um código). Evita um canal de eventos.                                                                                                           |
| GitHub via OAuth App + Device Flow, escopo `repo`, sem `broker/`                                | Device Flow não exige client secret. `repo` é o único escopo de OAuth App que cobre privados, PRs e comentários (não há só-leitura). GitHub App teria permissões finas, mas tokens de 8 h cuja renovação exige secret (→ broker) e instalação por org/repo. |
| Device Flow com duas chamadas (`startDeviceFlow` + `waitDeviceFlow`) em vez de canal de eventos | O único dado intermediário (código, URL, expiração) chega no início. Evita expor `ipcRenderer.on`/gerenciar inscrições no preload e não exige polling do renderer.                                                                                          |
| Permissão `clipboard-sanitized-write` liberada                                                  | Botão "Copiar" do código do GitHub. Leitura da área de transferência e demais permissões continuam negadas.                                                                                                                                                 |
| Peças de UI dos cards em `connection-ui.tsx`                                                    | Notion e GitHub compartilham conectado/erro/token/desconectar; cada card só implementa o próprio fluxo de login.                                                                                                                                            |

## Astryx (migração planejada — ainda NÃO iniciada)

O bloco abaixo foi gerado por `astryx init --features agents` (não edite entre os marcadores;
o CLI o regenera). A migração da UI para `@astryxdesign/core` é uma etapa própria, depois da 2B.
**Até ela acontecer, valem as regras de "Identidade visual" e "Estilo" acima** (CSS com tokens).
Restrição já conhecida: a CSP de produção bloqueia `<style>` injetado em runtime — o tema Orkio
deve ser compilado com `astryx theme build` (CSS estático, `__built: true`), e componentes que
injetam `<style>` (camadas deslizantes, CodeBlock) precisam de decisão antes de serem usados.

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
