# Configuração das integrações

Guia para quem mantém o Orkio (criar as apps OAuth e configurar o build) e para quem usa (tokens
como alternativa). Volte ao [README](../README.md).

## Conectar o Notion (OAuth)

Para quem usa o Orkio é um clique: **Integrações → Conectar com Notion** abre o navegador, a
pessoa escolhe o workspace e as páginas, clica em **Permitir** e volta para o app já conectado.

### Como funciona

```
Orkio (main) ──abre navegador──▶ api.notion.com/v1/oauth/authorize?…&state=…
     ▲                                        │ usuário autoriza
     │  http://localhost:47821/oauth/notion/callback?code=…&state=…
     │  (servidor local, só durante o login; confere o state)
     ├──POST /notion/token { code } ──▶ intermediário (site/, rotas do site na Vercel)
     │                                        │ + client_secret (só ele conhece)
     │                                        ▼
     │                               api.notion.com/v1/oauth/token
     ◀──────── access_token + refresh_token ──┘   (o intermediário não guarda nada)
```

O Notion exige o **client secret** para trocar o código e renovar tokens, e a API REST não
aceita PKCE. Um app desktop não consegue esconder um segredo, então essa etapa passa pelo
intermediário: as rotas `/notion/token` e `/notion/refresh` do site do Orkio
([`site/`](../site/README.md), na Vercel). O antigo Worker em [`broker/`](../broker/README.md) fica
até o login real ser confirmado pelo site. Os tokens ficam só no computador da pessoa,
criptografados. Quando o token de acesso expira, o Orkio renova sozinho pelo intermediário.

### Configuração (uma vez, por quem mantém o Orkio)

1. **Crie a conexão OAuth no Notion** (developers.notion.com → _New connection_):
   - Authentication method: **OAuth**
   - Installable in: **Any workspace** (ou só os workspaces da sua org)
   - Redirect URI: `http://localhost:47821/oauth/notion/callback` (o Notion recusa IP, então é
     `localhost`; o servidor local do app escuta só em loopback)
   - Guarde o **OAuth client ID** (público) e o **client secret** (segredo — não cole em chat,
     issue ou commit).
2. **Publique o site** (intermediário incluso) seguindo [`site/README.md`](../site/README.md). O
   client secret vai só para as variáveis de ambiente da Vercel (`NOTION_CLIENT_SECRET`).
3. **Configure o build do app**: copie `.env.example` para `.env` (dev) ou
   `.env.production` (build de release) e preencha:
   ```
   MAIN_VITE_NOTION_OAUTH_CLIENT_ID=<client ID>
   MAIN_VITE_SITE_URL=https://<domínio do site>
   ```
   Em dev, com o site rodando local (`pnpm --dir site dev`), use `http://127.0.0.1:3000`.
   Nenhum desses valores é segredo. Sem eles, o app esconde o login com Notion e mostra só
   a opção de token. `MAIN_VITE_SITE_URL` é a **origem do site** (o intermediário fica em
   `/notion/*`), sem caminho; não é o Redirect URI (`http://localhost:47821/...`). Se apontar para
   a porta `47821`, o app trata como config errada e esconde o login com Notion.

### Problemas comuns no login com Notion

| Mensagem no card                                              | Causa e correção                                                                                                                                                                                      |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Não foi possível falar com o intermediário de login local…"  | Build de dev com o intermediário em loopback e o site parado. Rode `pnpm --dir site dev` ou use a URL do site publicado.                                                                              |
| "Não foi possível falar com o serviço de login do Orkio (…)." | Sem rede até o site, domínio errado no build ou site fora do ar. Abra `https://<domínio>/` no navegador.                                                                                              |
| "…recusou o endereço de retorno deste app…"                   | `ALLOWED_REDIRECT_URIS` na Vercel não tem `http://localhost:47821/oauth/notion/callback`. Corrija em Settings → Environment Variables e faça **Redeploy** (variável nova só vale no deploy seguinte). |
| "O login com Notion está mal configurado…"                    | `NOTION_CLIENT_ID`/`NOTION_CLIENT_SECRET` da Vercel não batem com a conexão do Notion, ou o Redirect URI não está cadastrado nela.                                                                    |

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

## Conectar o GitHub (Device Flow)

Para quem usa: **Integrações → Conectar com GitHub** mostra um código (ex.: `WDJB-MJHT`).
A pessoa clica em **Copiar** e **Abrir GitHub**, cola o código em github.com/login/device e
clica em **Authorize**. O Orkio conecta sozinho, sem precisar voltar e clicar em nada.

O Device Flow **não usa client secret** nem redirect, então o GitHub **não** passa pelo
intermediário (`broker/`): o app fala direto com o GitHub e guarda o token cifrado.

**Escopo pedido: `repo`.** Para OAuth Apps é o único escopo que dá acesso a repositórios
privados, PRs e comentários e, depois, permite abrir PRs. O GitHub não oferece uma versão
só-leitura dele (`public_repo` não cobre privados).

### Criar a OAuth App (uma vez, por quem mantém o Orkio)

1. GitHub → **Settings → Developer settings → OAuth Apps → New OAuth App** (para a org:
   _Organization settings → Developer settings → OAuth Apps_).
2. Preencha:
   - **Application name:** `Orkio`
   - **Homepage URL:** a página do projeto (ex.: o repositório)
   - **Authorization callback URL:** obrigatório no formulário, mas **não é usado** pelo Device
     Flow. Pode usar `http://127.0.0.1/`.
   - Marque **Enable Device Flow**.
3. Copie o **Client ID** (público). **Não gere client secret** — o Orkio não usa.
4. No `.env` do app: `MAIN_VITE_GITHUB_CLIENT_ID=<Client ID>`. Sem ele, o card mostra só a
   opção de token.

**Organizações com restrições:** se a org usa _OAuth App access restrictions_ ou SAML SSO, um
admin precisa aprovar a OAuth App do Orkio (e, com SSO, cada pessoa autoriza o token para a
org). Sem isso a conexão funciona, mas os repositórios da org não aparecem nas próximas etapas.

### Alternativa: fine-grained personal access token

**Usar token** no card do GitHub aceita um
[fine-grained PAT](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens#creating-a-fine-grained-personal-access-token)
(GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens):
escolha os repositórios e dê, no mínimo, **Contents**, **Pull requests** e **Metadata**
(leitura; escrita em Contents/Pull requests para abrir PRs nas próximas etapas). O token é
validado em `GET https://api.github.com/user` antes de ser salvo.

## Segurança

- Todas as chamadas ao Notion e ao GitHub são feitas no **processo main**. O renderer não tem
  acesso a Node (`contextIsolation`, `sandbox`, sem `nodeIntegration`) e fala com o main só
  pela API mínima `window.orkio`.
- Tokens (OAuth ou colados) são criptografados com `safeStorage` do Electron (Keychain no macOS, DPAPI no
  Windows, libsecret/KWallet no Linux) e salvos em `<userData>/secrets/notion.bin` e
  `github.bin` com permissão `0600`.
- Se não houver criptografia disponível, o token **não é salvo** e o app mostra um erro.
  No Linux, o backend `basic_text` (chave fixa) é tratado como indisponível.
- O token nunca volta para o renderer, não aparece em logs e o `.gitignore` bloqueia `*.bin`
  e `secrets/`.
- CSP restritiva no `index.html`; navegação e novas janelas bloqueadas; links externos só
  abrem para a allowlist do main (domínios do Notion, `docs.github.com` e só
  `github.com/login/device`).
- Projetos: o seletor de pasta roda no main e o renderer nunca envia caminhos; o git roda via
  `execFile` (sem shell), com timeout.
- Permissões do navegador negadas, exceto escrever na área de transferência (botão
  **Copiar** do código do GitHub).
- GitHub Device Flow: sem client secret; o polling roda no main e a UI só recebe o código, a
  URL e a expiração.
- OAuth: o client secret existe só no intermediário; o app valida o `state`, aceita o redirect
  só em `127.0.0.1` (e confere o header `Host`) e fecha o servidor local ao terminar.

Para desconectar, use **Desconectar** no card. Isso apaga o arquivo do disco. O token
continua válido no serviço; para revogar, remova o Orkio em **Notion → Configurações →
Conexões** ou em **GitHub → Settings → Applications → Authorized OAuth Apps** (ou apague o PAT).
