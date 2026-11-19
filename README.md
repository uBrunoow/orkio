# Orkio

App desktop (Electron) de orquestração de desenvolvimento com IA. Conecta planejamento
(Notion), código (GitHub) e agentes (Claude Code).

> Estado atual: só as **conexões de conta** estão implementadas:
>
> - **Notion** — login com Notion (OAuth) ou, como alternativa, um token colado;
> - **GitHub** — login com GitHub (OAuth Device Flow) ou, como alternativa, um fine-grained PAT.

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

- **Notion, intermediário OAuth e GitHub são simulados**: o teste substitui o `fetch` e o
  `shell.openExternal` do processo main durante a execução (o código do app não tem nenhum modo
  de teste). Nenhum token real é usado. O build usa `--mode e2e` (`.env.e2e`, valores falsos).
- Cada execução usa um `userData` temporário (`--user-data-dir`) e não toca nos seus dados.
- Cobre: tela inicial, isolamento do renderer, CSP de produção, fontes/logo/botão primário,
  token inválido (nada salvo), conexão válida (arquivo criptografado, permissão 600, token fora
  do renderer), reabrir mantendo a conexão, aviso em 503, token revogado, desconectar com
  confirmação (arquivo apagado) e ausência do token nos logs — para o Notion (token e OAuth) e
  para o GitHub (Device Flow com código/copiar/abrir/cancelar/expirar/recusar, PAT, rate limit).
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

## Identidade visual e UI

A interface usa o design system **[Astryx](https://github.com/meta/astryx)** (`@astryxdesign/core`)
com o **tema Orkio** (dark, laranja da marca com texto preto, Inter na UI, JetBrains Mono em
código). A fonte da verdade da marca continua em [`brand/`](brand/BRAND.md).

- **Tema:** `themes/orkio/` (editado com `pnpm exec astryx experimental theme editor …`) gera a
  cópia em `src/themes/orkio/` e `src/astryx-themes.ts`. O tema é CSS estático (pré-compilado).
- **CSP estrita:** a Astryx injetaria alguns estilos em runtime; o Orkio entrega esse CSS como
  arquivo estático (`pnpm astryx:static-css`, rode após atualizar a Astryx) e não usa componentes
  que dependem de injeção. Detalhes no `CLAUDE.md`.
- **Fontes:** locais via `@fontsource` (Inter, Jost no logo e em títulos de destaque, JetBrains Mono).
- **Ícones:** [Tabler Icons](https://tabler.io/icons) (`@tabler/icons-react`), inclusive os logos do GitHub e do Notion.
- **Logo:** `<OrkioLogo variant="full|simple" withWordmark size />`.
- **Ícones do app:** `pnpm icons` gera `build/icon.icns`, `build/icon.ico`, `build/icon.png` e
  `resources/icon.png` a partir de `brand/orkio-app-icon-1024.png` (png2icons).

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

## Projetos

Um **projeto** é uma pasta local (clone) ligada a um repositório do GitHub. Em **Projetos →
Adicionar projeto**:

1. Escolha a pasta (pode ser uma subpasta: o Orkio usa a raiz do repositório e avisa).
2. O Orkio lê os remotes com o `git` instalado (precisa estar no PATH). Em forks, escolha entre
   `origin` e `upstream`. Remotes por alias do `~/.ssh/config` (ex.: `git@github-trabalho:org/repo`)
   ou GitHub Enterprise pedem confirmação; Enterprise fica como "não verificado".
3. O Orkio confirma no GitHub (com a conta conectada) a branch padrão, a visibilidade e a
   permissão de push. Repositórios arquivados ou sem push são salvos com aviso.

A lista mostra `owner/repo`, a **branch atual** (atualiza sozinha ao trocar de branch no
terminal), alterações não commitadas e o status. Se a pasta for movida ou apagada, o projeto
fica como "Pasta não encontrada" e pode ser **reapontado** para a nova pasta (do mesmo
repositório). **Remover** só tira o projeto do Orkio; nenhum arquivo é apagado.

Organizações com **SSO (SAML)** ou **restrição de OAuth Apps** respondem 403: o Orkio explica e
oferece o link para autorizar (SSO) ou pedir a aprovação de um admin.

Os projetos ficam em `<userData>/orkio-config.json` (sem segredos). Se o arquivo estiver
corrompido, o Orkio guarda uma cópia (`orkio-config.corrupt-<data>.json`) e começa vazio, com aviso.

## Bancos do Notion e tarefas

Em **Integrações → Bancos do Notion** (com o Notion conectado), um assistente em 3 passos:

1. **Projetos:** escolha o banco (data source) com uma página por projeto.
2. **Tarefas:** escolha o banco de tarefas. Ele precisa de uma **relação** com o banco de Projetos.
3. **Mapeamento:** o Orkio sugere quais propriedades usar (pelo nome e pelo tipo). Obrigatórias:
   Título, Status (status ou seleção), **ID** (tipo “ID”/`unique_id`, ex.: `ORK-142`) e Projeto
   (a relação). Opcionais: Prioridade e Responsável.

Sem uma propriedade do tipo ID, o Orkio não salva e explica como criá-la no Notion (+ nova
propriedade → **ID**). Com login via Notion (OAuth), só aparecem os bancos escolhidos na
autorização; se faltar algum, use **Reconectar com Notion** e marque as páginas desses bancos.

Ao abrir o app, o Orkio confere o mapeamento: propriedade **renomeada** gera um aviso (e o nome é
atualizado); propriedade **apagada** ou com outro tipo bloqueia as tarefas até você revisar o
mapeamento.

Em **Projetos**, cada projeto pode ser **vinculado** a um projeto do Notion (um para um; o Orkio
sugere pelo nome). Com o vínculo, **Ver tarefas** lista as tarefas ligadas a ele: ID, título,
status (com a cor do Notion) e prioridade, com **Atualizar** e um botão para abrir no Notion.
É só leitura: o Orkio não altera nada no Notion. As tarefas ficam só em memória (cache de 60 s);
o arquivo de configuração guarda apenas ids e nomes dos bancos, das propriedades e do vínculo.

## Branches e PRs das tarefas

Na lista de tarefas de um projeto, cada tarefa mostra a **branch** (local, remota ou as duas) e a
**PR** ligada a ela pelo ID, por exemplo `ORK-142/sync-notion`, `feat/ORK-142-sync` ou uma PR com
"ORK-142" no título. O casamento respeita a palavra inteira: `ORK-14` não se confunde com
`ORK-142`. O chip da PR mostra número (clique para abrir no GitHub), estado (rascunho, aberta,
mergeada, fechada), revisão (aprovada, alterações pedidas), comentários de revisão não
resolvidos e CI. É só leitura.

A lista se atualiza sozinha a cada minuto enquanto o Orkio está em primeiro plano (o GitHub
responde "nada mudou" na maioria das vezes, sem gastar o limite de requisições) e ao clicar em
**Atualizar**. Sem GitHub conectado, aparecem só as branches locais, com um aviso.

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
