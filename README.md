# Orkio

App desktop (Electron) de orquestração de desenvolvimento com IA. Conecta planejamento
(Notion), código (GitHub) e agentes (Claude Code).

> Estado atual: apenas a **conexão da conta do Notion** está implementada — via login com
> Notion (OAuth) ou, como alternativa discreta, um token colado.

## Requisitos

- Node.js 22.12+ (ou 20.19+)
- pnpm 10+
- Linux: um keyring ativo (GNOME Keyring/libsecret ou KWallet). Sem ele o Orkio
  **não salva** o token (ver [Segurança](#segurança)).

## Desenvolvimento

```bash
pnpm install     # também baixa o binário do Electron (postinstall)
pnpm dev         # abre o app com hot reload
```

Outros comandos:

| Comando          | O que faz                                         |
| ---------------- | ------------------------------------------------- |
| `pnpm test`      | Testes unitários (Vitest)                         |
| `pnpm typecheck` | TypeScript strict para main/preload e renderer    |
| `pnpm lint`      | ESLint                                            |
| `pnpm format`    | Prettier                                          |
| `pnpm build`     | Gera o build em `out/`                            |
| `pnpm start`     | Roda o build de produção (`out/`) localmente      |
| `pnpm icons`     | Regenera os ícones a partir de `brand/`           |
| `pnpm e2e`       | Testes ponta a ponta no app Electron (ver abaixo) |
| `pnpm dist`      | Empacota para o SO atual (electron-builder)       |
| `pnpm dist:dir`  | Empacota sem instalador (pasta em `dist/`)        |

## Testes ponta a ponta (E2E)

```bash
pnpm e2e
```

Faz o build de produção e roda o Playwright (`e2e/`) contra o app Electron real. Não é preciso
instalar navegadores do Playwright: o teste usa o Electron do projeto.

- A **API do Notion é simulada**: o teste substitui o `fetch` do processo main durante a
  execução (o código do app não tem nenhum modo de teste). Nenhum token real é usado.
- Cada execução usa um `userData` temporário (`--user-data-dir`) e não toca nos seus dados.
- Cobre: tela inicial, isolamento do renderer, CSP de produção, fontes/logo/botão primário,
  token inválido (nada salvo), conexão válida (arquivo criptografado, permissão 600, token fora
  do renderer), reabrir mantendo a conexão, aviso em 503, token revogado, desconectar com
  confirmação (arquivo apagado) e ausência do token nos logs.
- **Linux sem interface gráfica** (CI/servidor): rode com `xvfb-run -a pnpm e2e`.
- **Linux sem keyring**: o teste liga a criptografia básica do Electron só durante o teste.
  No macOS/Windows usa o Keychain/DPAPI de verdade (o macOS pode pedir acesso ao Keychain na
  primeira execução).

```bash
pnpm build
pnpm start
```

`pnpm build` gera `out/main`, `out/preload` e `out/renderer`.

Para empacotar (config em `electron-builder.yml`):

```bash
pnpm dist        # dmg no macOS, instalador NSIS no Windows, AppImage no Linux
pnpm dist:dir    # só a pasta do app, sem instalador
```

Sem assinatura de código nem auto-update por enquanto.

## Identidade visual

A fonte da verdade da marca é a pasta [`brand/`](brand/BRAND.md) (símbolos, ícone e tokens).

- **Tokens:** `src/renderer/src/styles/tokens.css` é o único arquivo de tokens do app
  (une `brand/tokens.css` com espaçamentos e tamanhos da UI).
- **Fontes:** empacotadas via `@fontsource` (Inter na UI, Jost na logo e em títulos grandes,
  JetBrains Mono em IDs e tokens). Nada vem de CDN.
- **Logo:** `<OrkioLogo variant="full|simple" withWordmark size />` em
  `src/renderer/src/components/OrkioLogo/`.
- **Ícones:** `pnpm icons` gera `build/icon.icns`, `build/icon.ico`, `build/icon.png` e
  `resources/icon.png` a partir de `brand/orkio-app-icon-1024.png`, usando
  [png2icons](https://github.com/idesis-gmbh/png2icons) (JavaScript puro, sem dependências
  nativas).

## Conectar o Notion (OAuth)

Para quem usa o Orkio é um clique: **Integrações → Conectar com Notion** abre o navegador, a
pessoa escolhe o workspace e as páginas, clica em **Permitir** e volta para o app já conectado.

### Como funciona

```
Orkio (main) ──abre navegador──▶ api.notion.com/v1/oauth/authorize?…&state=…
     ▲                                        │ usuário autoriza
     │  http://127.0.0.1:47821/oauth/notion/callback?code=…&state=…
     │  (servidor local, só durante o login; confere o state)
     ├──POST /notion/token { code } ──▶ intermediário (broker/, Cloudflare Worker)
     │                                        │ + client_secret (só ele conhece)
     │                                        ▼
     │                               api.notion.com/v1/oauth/token
     ◀──────── access_token + refresh_token ──┘   (o intermediário não guarda nada)
```

O Notion exige o **client secret** para trocar o código e renovar tokens, e a API REST não
aceita PKCE. Um app desktop não consegue esconder um segredo, então essa etapa passa pelo
intermediário em [`broker/`](broker/README.md). Os tokens ficam só no computador da pessoa,
criptografados. Quando o token de acesso expira, o Orkio renova sozinho pelo intermediário.

### Configuração (uma vez, por quem mantém o Orkio)

1. **Crie a conexão OAuth no Notion** (developers.notion.com → _New connection_):
   - Authentication method: **OAuth**
   - Installable in: **Any workspace** (ou só os workspaces da sua org)
   - Redirect URI: `http://127.0.0.1:47821/oauth/notion/callback`
   - Guarde o **OAuth client ID** (público) e o **client secret** (segredo — não cole em chat,
     issue ou commit).
2. **Publique o intermediário** seguindo [`broker/README.md`](broker/README.md). O client
   secret vai só para o cofre da Cloudflare (`wrangler secret put`).
3. **Configure o build do app**: copie `.env.example` para `.env` (dev) ou
   `.env.production` (build de release) e preencha:
   ```
   MAIN_VITE_NOTION_OAUTH_CLIENT_ID=<client ID>
   MAIN_VITE_NOTION_OAUTH_BROKER_URL=https://orkio-oauth-broker.<sua-conta>.workers.dev
   ```
   Nenhum desses valores é segredo. Sem eles, o app esconde o login com Notion e mostra só
   a opção de token.

A porta `47821` precisa estar livre no computador durante o login; se estiver ocupada, o
Orkio avisa. Para desconectar de vez, além de **Desconectar** no Orkio, a pessoa pode
remover o Orkio em **Notion → Configurações → Conexões**.

## Alternativa: usar um token do Notion

Para workspaces que permitem tokens, o card tem o link discreto **Usar token**. O Orkio
aceita dois tipos de token. Os dois usam o mesmo header `Authorization: Bearer`.

**Personal Access Token (recomendado para uso pessoal)**

1. Abra <https://www.notion.so/developers/tokens> (Developer portal → _Personal access tokens_).
2. Clique em **New token**, dê um nome (ex.: “Orkio”) e escolha o workspace.
3. Copie o token (começa com `ntn_`).

**Token de integração interna**

1. Abra <https://www.notion.so/profile/integrations> e crie uma integração interna.
2. Copie o _Internal Integration Secret_.
3. Compartilhe com a integração as páginas que o Orkio poderá ler.

Depois, no Orkio, vá em **Integrações → Notion → Usar token**, cole o token e clique em
**Conectar**.
O token é validado em `GET https://api.notion.com/v1/users/me` antes de ser salvo.

Documentação oficial: <https://developers.notion.com/guides/get-started/personal-access-tokens>

## Segurança

- Todas as chamadas à API do Notion são feitas no **processo main**. O renderer não tem
  acesso a Node (`contextIsolation`, `sandbox`, sem `nodeIntegration`) e fala com o main só
  pela API mínima `window.orkio`.
- Tokens (OAuth ou colados) são criptografados com `safeStorage` do Electron (Keychain no macOS, DPAPI no
  Windows, libsecret/KWallet no Linux) e salvo em `<userData>/secrets/notion.bin` com
  permissão `0600`.
- Se não houver criptografia disponível, o token **não é salvo** e o app mostra um erro.
  No Linux, o backend `basic_text` (chave fixa) é tratado como indisponível.
- O token nunca volta para o renderer, não aparece em logs e o `.gitignore` bloqueia `*.bin`
  e `secrets/`.
- CSP restritiva no `index.html`; navegação e novas janelas bloqueadas; links externos só
  abrem para domínios do Notion (allowlist no main).
- OAuth: o client secret existe só no intermediário; o app valida o `state`, aceita o redirect
  só em `127.0.0.1` (e confere o header `Host`) e fecha o servidor local ao terminar.

Para desconectar, use **Desconectar** no card. Isso apaga o arquivo do disco. O token
continua válido no Notion; revogue-o por lá se quiser invalidá-lo.
