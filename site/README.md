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

| Variável                | Exemplo                                        | Segredo? |
| ----------------------- | ---------------------------------------------- | -------- |
| `NOTION_CLIENT_ID`      | id da conexão OAuth do Notion                  | não      |
| `NOTION_CLIENT_SECRET`  | secret da conexão OAuth                        | **sim**  |
| `ALLOWED_REDIRECT_URIS` | `http://127.0.0.1:47821/oauth/notion/callback` | não      |
| `RELEASES_REPO`         | `uBrunoow/orkio-releases` (repo público da 6B) | não      |

`NOTION_TOKEN_URL` existe só para o E2E local (`e2e/site-oauth.spec.ts`): é ignorada na Vercel e
aceita apenas `http://127.0.0.1`.

### Teste com o app

Com o site rodando local, o app em dev usa `MAIN_VITE_NOTION_OAUTH_BROKER_URL=http://127.0.0.1:3000`.
O E2E `@site` (`pnpm e2e --grep @site`, depois de `pnpm --dir site build`) sobe o `next start`, um
Notion simulado em HTTP local e faz o login e a renovação pelo app.
