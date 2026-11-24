# Site do Orkio

Landing page, páginas legais (/privacidade, /termos) e o **intermediário OAuth do Notion**
(substitui o antigo `broker/` da Cloudflare, com o mesmo contrato).

Next.js (App Router) + TypeScript, com package e lockfile próprios: o `pnpm install` do app
(raiz) não instala nada daqui.

```bash
pnpm --dir site install
pnpm --dir site dev        # http://127.0.0.1:3000
pnpm --dir site test       # Vitest (intermediário, limitador, download)
pnpm --dir site typecheck
pnpm --dir site lint
pnpm --dir site build && pnpm --dir site start
```

## Intermediário OAuth do Notion

O Notion exige o **client secret** para trocar o código e renovar tokens, e a API REST não aceita
PKCE. O app desktop não guarda segredos, então essas duas chamadas passam por aqui.

| Rota                   | Corpo                    | Resposta                                |
| ---------------------- | ------------------------ | --------------------------------------- |
| `POST /notion/token`   | `{ code, redirect_uri }` | campos conhecidos da resposta do Notion |
| `POST /notion/refresh` | `{ refresh_token }`      | campos conhecidos da resposta do Notion |
| `GET /health`          | —                        | `{ "ok": true }`                        |

- **Sem estado:** não guarda tokens, códigos nem logs. Nenhum `console.*` (ESLint `no-console` e um
  teste conferem). Os logs de runtime da Vercel registram método, caminho e status, nunca o corpo
  nem os headers da requisição; nada sensível vai em query string.
- Só aceita os redirect URIs de `ALLOWED_REDIRECT_URIS`; corpo de até 8 KB (lido em stream);
  `application/json` obrigatório; 429 do Notion repassa o `Retry-After`; Notion fora → 502.
- Runtime Node, sempre dinâmico, `Cache-Control: no-store`.
- **Abuso:** um limitador em memória por IP (20/min) é só a defesa mínima (vale por instância). A
  proteção real é a regra de _Rate Limiting_ do Firewall da Vercel (abaixo).

Variáveis (só no painel da Vercel; nunca em arquivo):

| Variável                | Exemplo                                         | Segredo? |
| ----------------------- | ----------------------------------------------- | -------- |
| `NOTION_CLIENT_ID`      | id da conexão OAuth do Notion                   | não      |
| `NOTION_CLIENT_SECRET`  | secret da conexão OAuth                         | **sim**  |
| `ALLOWED_REDIRECT_URIS` | `http://localhost:47821/oauth/notion/callback`  | não      |
| `RELEASES_REPO`         | `uBrunoow/orkio` (repo público com os releases) | não      |

`NOTION_TOKEN_URL` existe só para o E2E local (`e2e/site-oauth.spec.ts`): é ignorada na Vercel e
aceita apenas `http://127.0.0.1`.

### Teste com o app

Com o site rodando local, o app em dev usa `MAIN_VITE_SITE_URL=http://127.0.0.1:3000`.
O E2E `@site` (`pnpm e2e --grep @site`, depois de `pnpm --dir site build`) sobe o `next start`, um
Notion simulado em HTTP local e faz o login e a renovação pelo app.

## Revisão como `orkio[bot]` (GitHub App)

`POST /github/review` `{ owner, repo, number, userToken, review: { event, body, comments } }` →
`{ url }` (`lib/github-app.ts`). Valida o pedido inteiro antes de falar com o GitHub (evento só
`COMMENT` ou `REQUEST_CHANGES`; APPROVE → 400), confere com o token do usuário se ele tem push no
repositório e lê o login dele (`GET /user`), assina o JWT do App (RS256, `node:crypto`), pede um
token de instalação restrito ao repositório e a `pull_requests: write` e **posta a revisão aqui
mesmo**, com o corpo montado só com os campos permitidos e a linha "Publicado pelo Orkio a pedido de
@login" no fim. Prazo total de 15 s (o app espera 25 s). O token do App nunca sai do site: `pull_requests: write` também permite
APPROVE, e devolvê-lo deixaria quem tem push aprovar a própria PR como `orkio[bot]`.

Erros só por código: `not_configured` (503), `bad_request` (400/413/415; 422 do GitHub vira
`reason: "rejected"`), `forbidden` (403), `not_installed` (412, com `installUrl`), `upstream`
(502), `rate_limited` (429). Mesmas regras do intermediário: sem estado, sem logs, limitador por IP,
`no-store`, timeouts que cobrem a leitura do corpo.

Variáveis: `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY` (**Sensitive**; aceita `\n` literais),
`GITHUB_APP_SLUG`. `GITHUB_API_URL` é só para o E2E local (ignorada na Vercel; só
`http://127.0.0.1`). Passo a passo para criar e instalar o App e testar com curl (token pelo
stdin): `docs/github-app.md`.

## Landing e páginas legais

- Conteúdo em `i18n/pt-BR.ts` (o inglês entra depois com o mesmo formato); o que o site pode
  afirmar está em `PRODUCT.md`, e o visual em `DESIGN.md`.
- **Download:** `RELEASES_REPO` (repositório público com os releases da 6B) é lido em
  `GET /repos/{repo}/releases/latest` no servidor, com revalidação a cada 15 min (ISR). Os arquivos
  são classificados pelo nome (`*-arm64.dmg`, `*-x64.dmg`, `*.exe`/`*.msi`). O navegador sugere o
  arquivo do sistema (Client Hints para a arquitetura; no Safari, Apple Silicon com o Intel ao
  lado). Sem release, o botão leva à página de releases; sem `RELEASES_REPO`, mostra "em breve".
- `/privacidade` e `/termos` usam `CONTACT_EMAIL`; sem ele aparece o marcador `[contato a definir]`.
- Sem cookies, rastreadores, fontes ou scripts de terceiros. Fontes locais (`app/fonts/`, OFL).

## Configurar na Vercel (passo a passo)

1. **Projeto:** _Add New → Project_ → importe o repositório do GitHub.
   - **Root Directory:** `site` (deixe _Include files outside the root directory_ desligado).
   - Framework: Next.js (detectado). Install: `pnpm install --frozen-lockfile`. Build: `pnpm build`.
   - Node.js: 22.x (_Settings → Build and Deployment_).
2. **Deploy só quando `site/**`mudar:** _Settings → Git → Ignored Build Step_ → _Custom_:`git diff --quiet HEAD^ HEAD -- .`(roda dentro de`site/`; sem mudanças → pula o deploy).
   Production Branch: `main`.
3. **Variáveis** (_Settings → Environment Variables_, ambiente **Production**; em Preview só se
   for testar o login lá):
   - `NOTION_CLIENT_ID` = OAuth client ID da conexão pública do Notion
   - `NOTION_CLIENT_SECRET` = client secret (marque **Sensitive**)
   - `ALLOWED_REDIRECT_URIS` = `http://localhost:47821/oauth/notion/callback`
   - `RELEASES_REPO` = `uBrunoow/orkio` (repositório público com os releases, 6B)
   - `CONTACT_EMAIL` = e-mail das páginas legais
   - `SITE_URL` = `https://<seu domínio>` (links absolutos do Open Graph)
   - **Nunca** defina `NOTION_TOKEN_URL` na Vercel (é só para o E2E local e é ignorada lá).
4. **Domínio:** _Settings → Domains_ → adicione o domínio e siga os registros DNS indicados. Use o
   domínio final em `MAIN_VITE_SITE_URL` no build de release do app.
5. **Firewall** (_Firewall → Configure → New Rule_):
   - Nome: `Intermediário OAuth`; _If_ **Request Path** _starts with_ `/notion/`;
   - _Then_ **Rate Limit**: 20 requisições / 60 s por **IP**, ação **Deny (429)**.
   - Se o seu plano não mostrar _Rate Limit_, o limitador em memória do site continua valendo (é
     só a defesa mínima). Ligue também o **Attack Challenge Mode** em caso de abuso.
6. **Logs:** os runtime logs mostram rota, status e IP, nunca corpo/headers. Não adicione _Log
   Drains_ com captura de corpo.
7. **Notion:** na conexão OAuth pública, preencha a URL do site, a política de privacidade
   (`https://<domínio>/privacidade`) e os termos (`https://<domínio>/termos`). O redirect URI
   continua `http://localhost:47821/oauth/notion/callback`.
8. **Teste:** `curl https://<domínio>/health` → `{"ok":true}`; depois o login real pelo app.
