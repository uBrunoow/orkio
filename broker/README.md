# Intermediário OAuth do Notion (Cloudflare Worker)

O Notion exige o **client secret** para trocar o código de autorização e renovar tokens, e a
API REST não aceita PKCE. Como o Orkio é um app desktop (qualquer segredo embutido pode ser
extraído), essas duas chamadas passam por este Worker, o único que conhece o secret.

- **Sem estado:** não guarda tokens, códigos nem logs de requisição.
- **Rotas:** `POST /notion/token` (`{ code, redirect_uri }`), `POST /notion/refresh`
  (`{ refresh_token }`) e `GET /health`.
- Só aceita os redirect URIs de `ALLOWED_REDIRECT_URIS` e devolve apenas os campos conhecidos
  da resposta do Notion.
- Testes: `broker/src/index.test.ts` (rodam no `pnpm test` da raiz).

## Publicar

Pré-requisito: conta na Cloudflare (o plano gratuito basta) e a conexão OAuth criada no
Notion (ver README da raiz).

```bash
cd broker
pnpm dlx wrangler login
```

1. Em `wrangler.toml`, preencha `NOTION_CLIENT_ID` com o OAuth client ID (não é segredo) e
   confira `ALLOWED_REDIRECT_URIS` (precisa ser idêntico ao cadastrado no Notion).
2. Cadastre o secret no cofre da Cloudflare. O comando pede o valor no terminal; ele não fica
   em arquivo nem no histórico:
   ```bash
   pnpm dlx wrangler secret put NOTION_CLIENT_SECRET
   ```
3. Publique:
   ```bash
   pnpm dlx wrangler deploy
   ```
4. Teste: `curl https://orkio-oauth-broker.<sua-conta>.workers.dev/health` deve devolver
   `{"ok":true}`.
5. Use essa URL em `MAIN_VITE_NOTION_OAUTH_BROKER_URL` no `.env` do app.

Para trocar o secret (ex.: vazou), gere um novo no Notion e rode o passo 2 de novo; as conexões
já feitas continuam valendo.

## Proteções recomendadas na Cloudflare (opcional)

- Uma regra de _Rate limiting_ para `/notion/*` (ex.: 30 requisições/minuto por IP).
- Desligar logs de requisição detalhados (Workers Logs) se não forem necessários.
