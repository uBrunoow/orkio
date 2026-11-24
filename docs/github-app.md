# GitHub App do Orkio (revisão publicada como `orkio[bot]`)

O agente revisor do Orkio pode publicar a revisão na PR com a identidade do Orkio (`orkio[bot]`),
não a sua. Assim um "Request changes" aparece como revisão de verdade na PR e a automação
"Alterações pedidas → Revisado" funciona.

Como funciona:

1. O app monta a revisão (`COMMENT` ou `REQUEST_CHANGES`; **APPROVE nunca**), redige segredos,
   confere os comentários de linha contra o diff da PR e a manda ao site do Orkio
   (`POST /github/review`) junto com o seu token OAuth do GitHub. O token só vai para a origem do
   site do Orkio (fixada no build), por HTTPS; nunca vai à tela, a disco ou a log.
2. O site valida tudo de novo (evento, owner/repo/número, tamanhos) **antes** de falar com o GitHub
   e confere com o seu token se você tem **push** no repositório. Sem push → recusa. Também lê o
   seu login (`GET /user`) e acrescenta ao fim da revisão a linha "_Publicado pelo Orkio a pedido
   de @seu-login._": a revisão sai como `orkio[bot]`, mas fica claro quem pediu.
3. O site assina um JWT do App (chave privada só na Vercel), acha a instalação do App no
   repositório, pede um token de 1 h **restrito a esse repositório** e a `pull_requests: write` e
   **ele mesmo** posta a revisão. Devolve só o link da revisão.

No app, quem publica é o passo "Publicar revisão na PR (orkio[bot])" do fluxo "Alva: revisão
publicada" (ligado por padrão à coluna Revisando): ele mostra a revisão num gate (tipo, resumo,
comentários e os que estão fora do diff) e só publica depois de você aprovar. Sem o App instalado
no repositório, o passo para com o link de instalação e nada é publicado.

**Por que o token do App não sai do site:** `pull_requests: write` também permite APPROVE. Se o
site devolvesse o token, qualquer pessoa com push num repositório com o App instalado poderia
aprovar a própria PR como `orkio[bot]`, e essa aprovação contaria na proteção de branch. Com o
site postando, o evento é validado lá (só `COMMENT`/`REQUEST_CHANGES`) e o corpo enviado ao GitHub
é montado lá, só com os campos permitidos.

## 1. Criar o App

Em <https://github.com/settings/apps/new> (ou, para uma organização,
_Organization settings → Developer settings → GitHub Apps → New GitHub App_):

- **GitHub App name:** `Orkio` (se o nome estiver ocupado, `Orkio Review`). O nome vira o login
  do bot (`orkio[bot]`) e o slug (`github.com/apps/<slug>`).
- **Homepage URL:** o endereço do site (ex.: `https://<domínio do site>`).
- **Callback URL / Setup URL:** deixe em branco. "Request user authorization (OAuth) during
  installation": desligado.
- **Webhook:** **desmarque _Active_** (o Orkio não usa webhooks).
- **Permissions → Repository permissions:**
  - **Pull requests:** _Read and write_
  - **Metadata:** _Read-only_ (obrigatória, já vem marcada)
  - Todo o resto: _No access_.
- **Where can this GitHub App be installed?** _Only on this account_ basta para uso próprio;
  _Any account_ se outras contas/organizações forem usar o Orkio.
- _Create GitHub App_.

Na página do App, anote:

- **App ID** (número no topo, em _About_);
- o **slug** (o final de _Public link_: `https://github.com/apps/<slug>`).

Na barra lateral do App: **Credentials** → **Key pairs** → **New key**: o navegador baixa um
`.pem` (a chave privada; o GitHub guarda só a parte pública). Guarde-o só até colocar na Vercel e
depois apague a cópia local. Perdeu? Gere outra do mesmo jeito. O _client secret_ (OAuth) não é
usado pelo Orkio.

## 2. Variáveis na Vercel

No projeto do site (_Settings → Environment Variables_, ambiente **Production**):

| Variável                 | Valor                                               | Segredo? |
| ------------------------ | --------------------------------------------------- | -------- |
| `GITHUB_APP_ID`          | o App ID (só dígitos)                               | não      |
| `GITHUB_APP_PRIVATE_KEY` | o conteúdo inteiro do `.pem` (marque **Sensitive**) | **sim**  |
| `GITHUB_APP_SLUG`        | o slug do App (monta o link "Instalar o App")       | não      |

- A chave pode ser colada com as quebras de linha reais ou numa linha só com `\n` literais; as
  duas formas são aceitas.
- **Nunca** defina `GITHUB_API_URL` na Vercel: ela existe só para o E2E local e é ignorada lá
  (só vale fora da Vercel e em `http://127.0.0.1`).
- Faça um novo deploy para as variáveis valerem.
- Firewall: estenda a regra de _Rate Limit_ do intermediário (ver `site/README.md`) para o caminho
  `/github/` (20 requisições / 60 s por IP). O site também tem um limitador em memória por IP.

O app usa a origem de `MAIN_VITE_SITE_URL` e, só sem ela, a do intermediário do Notion
(`MAIN_VITE_NOTION_OAUTH_BROKER_URL`; o intermediário ainda pode ser o Worker da Cloudflare, que não
tem a rota: nesse caso defina `MAIN_VITE_SITE_URL`). Sem nenhuma das duas, o app mostra "O GitHub
App do Orkio ainda não está configurado no site."

## 3. Instalar o App no repositório

Em `https://github.com/apps/<slug>/installations/new`: escolha a conta/organização e
**Only select repositories** → os repositórios onde o Orkio vai publicar revisões. Em
organizações, um owner pode precisar aprovar a instalação.

Se o App ganhar permissões novas depois, cada instalação precisa aceitá-las
(_Settings → Applications → Installed GitHub Apps → Orkio → Review request_).

## 4. Conferir

1. Sem token (deve responder 400, e não 503):

   ```bash
   curl -s -X POST https://<domínio>/github/review \
     -H 'content-type: application/json' -d '{"owner":"x","repo":"y"}'
   # {"error":"bad_request"}   ← 503 {"error":"not_configured"} = variáveis ausentes/erradas
   ```

2. Uma revisão de teste (`COMMENT`) numa PR sua. O token vai pelo stdin (`-d @-`), nunca na linha
   de comando (não fica no histórico do shell nem na lista de processos):

   ```bash
   gh auth token | jq -Rc '{owner:"<owner>", repo:"<repo>", number:<nº da PR>, userToken:.,
     review:{event:"COMMENT", body:"Teste do Orkio", comments:[]}}' \
     | curl -s -X POST https://<domínio>/github/review \
         -H 'content-type: application/json' -d @-
   ```

   - `{ "url": "https://github.com/…/pull/<n>#pullrequestreview-…" }` → tudo certo (a revisão
     aparece na PR como `orkio[bot]`);
   - `412 {"error":"not_installed","installUrl":…}` → instale o App no repositório (passo 3);
   - `403 {"error":"forbidden"}` → sua conta não tem push no repositório;
   - `400 {"error":"bad_request","reason":"rejected"}` → o GitHub recusou (linha fora do diff…);
   - `503 {"error":"not_configured"}` → `GITHUB_APP_ID`/`GITHUB_APP_PRIVATE_KEY` ausentes, inválidos
     ou de Apps diferentes;
   - `502 {"error":"upstream"}` → GitHub fora do ar ou limite de requisições; tente de novo.

3. No Orkio: rode o fluxo de revisão numa PR de teste; a revisão aparece na PR como `orkio[bot]`.

## Erros que o app mostra

| Situação                   | Mensagem                                                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Site sem o App configurado | "O GitHub App do Orkio ainda não está configurado no site."                                                        |
| App não instalado no repo  | "O GitHub App do Orkio não está instalado neste repositório…" (com o link de instalação)                           |
| Sem push no repositório    | "Sua conta não tem permissão de push neste repositório."                                                           |
| GitHub recusou a revisão   | "O GitHub recusou a revisão: confira as linhas dos comentários."                                                   |
| Site demorou (> 25 s)      | "O site do Orkio demorou para responder. Confira a PR antes de tentar de novo: a revisão pode ter sido publicada." |
| GitHub/site instável       | "O GitHub ou o site do Orkio está instável agora…"                                                                 |

## Segurança

- A chave privada e o token de instalação ficam **só** no site. O app nunca os vê.
- O site não confia em quem chama: valida o pedido inteiro antes de qualquer chamada ao GitHub
  (APPROVE é recusado), só posta para quem prova push no repositório com o próprio token do
  GitHub (o papel do usuário no repositório), e o token emitido é restrito (um repositório, só
  PRs, 1 h) e usado ali mesmo.
- Nada é guardado nem logado no site (sem `console.*`; ESLint e teste conferem). Respostas do
  GitHub nunca são repassadas, só códigos de erro e o link da revisão.
- Fora de escopo: webhooks, APPROVE, revisões em repositórios onde você não tem push.
