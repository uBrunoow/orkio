# Releases do Orkio (Etapa 6B)

Os instaladores são gerados pelo GitHub Actions a cada tag `vX.Y.Z` e publicados nos releases do
próprio repositório, [`uBrunoow/orkio`](https://github.com/uBrunoow/orkio/releases), que é
**público**: o site lê o último release de lá (`RELEASES_REPO`) e o auto-update (6C) também, sem
token. (Antes o código era privado e os binários iam para um repositório separado; um release de
repositório privado exigiria um token embutido no app, que daria acesso ao código.)

| Sistema | Arquivos                                                                       |
| ------- | ------------------------------------------------------------------------------ |
| macOS   | `Orkio-X.Y.Z-mac-arm64.dmg`, `Orkio-X.Y.Z-mac-x64.dmg` (+ `.zip` de cada um)   |
| Windows | `Orkio-X.Y.Z-win-x64-setup.exe` (instala no perfil do usuário, sem admin)      |
| Updates | `latest-mac.yml`, `latest.yml` (beta: `beta-mac.yml`, `beta.yml`), `.blockmap` |

## Configuração inicial (uma vez)

### 1. Repositório público e permissão do Actions

1. O repositório `uBrunoow/orkio` precisa ser **Public** (Settings → General → Danger Zone →
   Change visibility).
2. Settings → Actions → General → **Workflow permissions**: pode ficar em _Read repository contents_.
   O `release.yml` pede `contents: write` só nos jobs que publicam (`draft`, `package`, `finalize`)
   e usa o `GITHUB_TOKEN` do próprio workflow. Não há token pessoal para criar nem renovar.

### 2. Variáveis de build

Em Settings → Secrets and variables → Actions → aba **Variables** (não são segredos: vão dentro do
binário):

| Variable                            | Valor                                    |
| ----------------------------------- | ---------------------------------------- |
| `MAIN_VITE_GITHUB_CLIENT_ID`        | Client ID do OAuth App do GitHub         |
| `MAIN_VITE_NOTION_OAUTH_CLIENT_ID`  | OAuth client ID da conexão do Notion     |
| `MAIN_VITE_NOTION_OAUTH_BROKER_URL` | URL do site (intermediário OAuth), https |

Sem elas o release falha (o teste manual só avisa). Também são aceitas como _secrets_ com o mesmo nome.

### 3. Site

Na Vercel, `RELEASES_REPO=uBrunoow/orkio`. O site ignora pre-releases (beta).

## Lançar ao mergear (todo merge na main)

O caminho do dia a dia: **todo merge na `main` lança uma versão**. O rótulo da PR só muda o tipo.

1. Escreva as mudanças visíveis em `## [Não lançado]` do `CHANGELOG.md` (dentro da própria PR). Se
   ficar vazio, o título da PR vira o item da versão (em "### Mudado").
2. Tipo da versão pelo rótulo da PR: **sem rótulo = `patch`**; `release:minor`, `release:major` ou
   `release:beta` escolhem outro; **`release:none`** não lança (PR só de CI, testes, refatoração).
   O check **Release (rótulo da PR)** mostra na hora a versão que vai sair (ex.: "Ao mergear, sai a
   versão v0.2.2") e falha se houver rótulos em conflito.
   Mudanças só em `site/`, `docs/`, `broker/` ou no `README.md` não disparam o workflow.
3. Mergeie. O workflow **Release ao mergear** (`release-on-merge.yml`), na `main`:
   1. acha a PR do commit e lê o rótulo e o título (num push direto, a 1ª linha do commit);
   2. roda `node scripts/release.mjs <tipo>`: sobe o `package.json`, move "Não lançado" para
      `## [X.Y.Z] - AAAA-MM-DD`, faz o commit `chore(release): vX.Y.Z` e cria a tag;
   3. empurra o commit e a tag para a `main` (`git push --atomic`);
   4. dispara o **Release** (`release.yml`) com `--ref vX.Y.Z`. Tags empurradas com o `GITHUB_TOKEN`
      não disparam workflows (regra do GitHub, contra laços), por isso o disparo é explícito.
4. O **Release** segue o mesmo caminho de sempre (abaixo): CI, rascunho, pacotes no macOS e no
   Windows, smoke tests e publicação. Se algo falhar, o rascunho fica lá e nada é publicado.

Cuidados:

- O commit de versão vai direto para a `main`. Com proteção de branch (recomendada: PR + CI
  obrigatórios), libere o bot do GitHub Actions como exceção no ruleset ("Bypass list") para o
  `release-on-merge.yml` conseguir empurrar; sem isso o push é recusado e nenhuma versão sai.
- Secret de assinatura vazio não quebra o pacote: o passo "Empacotar" remove as variáveis vazias
  (`CSC_LINK=""` fazia o electron-builder procurar um certificado na pasta do projeto e falhar no mac).
- Duas PRs mergeadas em seguida lançam duas versões, uma de cada vez (`concurrency`).
- Duas PRs mergeadas quase juntas não derrubam a versão: o workflow usa a `main` de agora e, se o
  push for recusado porque ela andou, refaz o commit de versão em cima da nova (até 3 tentativas,
  `scripts/release-bump-push.sh`). A versão pode levar junto o que entrou na `main` nesse intervalo.
- Se mesmo assim o workflow falhar, rode-o de novo (ele pega a `main` atual) ou lance à mão.
- Não use um token pessoal para empurrar a tag: ele dispararia o `release.yml` duas vezes.

## Lançar à mão

1. Durante o desenvolvimento, escreva as mudanças visíveis em `## [Não lançado]` no `CHANGELOG.md`.
2. Na `main` atualizada e limpa:
   ```bash
   pnpm release patch      # 0.1.0 → 0.1.1   (também: minor, major)
   pnpm release beta       # 0.1.0 → 0.1.1-beta.1; de novo → 0.1.1-beta.2
   pnpm release minor --beta   # 0.1.0 → 0.2.0-beta.1
   ```
   O script atualiza `package.json`, move "Não lançado" para `## [X.Y.Z] - AAAA-MM-DD`, faz o commit
   `chore(release): vX.Y.Z` e cria a tag anotada. **Não faz push.**
3. `git push --follow-tags`. O workflow **Release** (`release.yml`):
   1. confere tag = versão do `package.json` e a seção no CHANGELOG;
   2. roda o CI inteiro (lint, typecheck, test, e2e, smoke do pacote Linux);
   3. cria o **rascunho** do release com as notas do CHANGELOG;
   4. empacota no macOS, no Windows e no Linux (`electron-builder --publish always`) e roda o smoke
      test do app empacotado em cada um (no Linux, com `xvfb-run`);
   5. confere que todos os arquivos (dmg/zip/exe/AppImage/deb e os `.yml` do canal) estão lá e
      publica. No Linux, só o AppImage se atualiza sozinho; o .deb é atualizado baixando o novo.
      Tag `-beta.N` → **pre-release** (canal beta, não vira "Latest").

Se algum passo falhar, o rascunho fica lá sem ser publicado (rascunho só aparece para quem tem
acesso de escrita ao repositório). Corrija, e rode de
novo o workflow pela página da execução (Re-run failed jobs) ou lance uma versão nova.

## Testar um pacote sem publicar

Actions → **Package** → _Run workflow_ (branch à escolha). Empacota mac e Windows com
`--publish never`, roda o smoke test e sobe os arquivos como **artefatos** da execução
(`orkio-macOS`, `orkio-Windows`, 7 dias). Baixe na página da execução.

Localmente: `pnpm dist` (instalador do SO atual) ou `pnpm dist:dir` + `pnpm smoke:packaged`
(Linux sem tela: `xvfb-run -a pnpm smoke:packaged`).

## Assinatura

O workflow detecta o que existe e segue sem assinar quando faltam os segredos, com `::warning::`
no log (aparece no resumo da execução).

### macOS sem Developer ID (hoje)

Build com assinatura **ad-hoc** e sem hardened runtime/notarização. Funciona, mas:

- Na primeira abertura o macOS bloqueia ("A Apple não pôde verificar…"). No macOS 15+ o clique
  direito → Abrir não resolve mais: abra uma vez, depois **Ajustes do Sistema → Privacidade e
  Segurança → "Abrir Mesmo Assim"** (pede a senha). Alternativa no Terminal:
  `xattr -dr com.apple.quarantine /Applications/Orkio.app`.
- O auto-update do mac (Squirrel.Mac) recusa apps sem Developer ID.

### macOS com Developer ID (passo a passo)

1. **Apple Developer Program** (US$ 99/ano) em developer.apple.com/programs, como pessoa física.
2. **Certificado:** Xcode → Settings → Accounts → Manage Certificates → **+ → Developer ID
   Application** (ou developer.apple.com → Certificates, com um CSR do Acesso às Chaves).
3. **Exportar:** Acesso às Chaves → _Meus Certificados_ → "Developer ID Application: …" (com a
   chave privada) → Exportar → `.p12` com uma senha forte.
4. **Base64:** `base64 -i DeveloperID.p12 | pbcopy`.
5. **Secrets** no repositório `orkio`:
   - `CSC_LINK` = o base64 do `.p12`
   - `CSC_KEY_PASSWORD` = a senha do `.p12`
6. **Notarização**, uma das duas formas:
   - **API key do App Store Connect** (recomendada): appstoreconnect.apple.com → Users and Access →
     Integrations → App Store Connect API → _Team Keys_ → gere uma chave com acesso **Developer**.
     Secrets: `APPLE_API_KEY` = conteúdo do `.p8` (o arquivo inteiro, com BEGIN/END),
     `APPLE_API_KEY_ID` = Key ID, `APPLE_API_ISSUER` = Issuer ID.
   - **Apple ID:** account.apple.com → Login e Segurança → **Senhas de app** → gere uma.
     Secrets: `APPLE_ID` (e-mail), `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` (10 caracteres,
     em developer.apple.com → Membership).
7. Pronto: o próximo release sai assinado (hardened runtime + `build/entitlements.mac.plist`, só
   `allow-jit`) e notarizado. O workflow passa `MAIN_VITE_MAC_SIGNED=1` para o app. A primeira
   notarização pode demorar.

Local: com o certificado no Keychain, `CSC_NAME="Seu Nome (TEAMID)" pnpm dist` assina; sem
`CSC_LINK`/`CSC_NAME` o build local é ad-hoc.

### Windows (sem assinatura por enquanto)

O SmartScreen mostra "O Windows protegeu o computador" → **Mais informações → Executar assim
mesmo**. A reputação melhora com assinatura.

Caminho pronto, desligado: **Microsoft Artifact Signing** (ex-Trusted Signing), cerca de US$ 9,99/mês.
Hoje a validação de pessoa física só existe para EUA/Canadá; no Brasil, normalmente é preciso uma
empresa com histórico verificável, ou então um certificado OV de uma autoridade (com chave em
HSM/nuvem, cerca de US$ 200 a 400/ano, que exigiria outro ajuste no `electron-builder.ts`). Para
ligar o Artifact Signing:

1. Crie a conta e o perfil de certificado no Azure e um _App registration_ com o papel
   _Artifact Signing Certificate Profile Signer_.
2. Secrets: `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`.
3. Variables: `AZURE_SIGNING_ENDPOINT` (ex.: `https://eus.codesigning.azure.net`),
   `AZURE_SIGNING_ACCOUNT`, `AZURE_SIGNING_PROFILE`, `WIN_PUBLISHER_NAME` (igual ao CN do
   certificado) e por último `WIN_SIGNING=azure`.

## Referência: secrets e variables

| Nome                                                          | Tipo      | Obrigatório               |
| ------------------------------------------------------------- | --------- | ------------------------- |
| `MAIN_VITE_GITHUB_CLIENT_ID`                                  | variable  | Sim, no release           |
| `MAIN_VITE_NOTION_OAUTH_CLIENT_ID`                            | variable  | Sim, no release           |
| `MAIN_VITE_NOTION_OAUTH_BROKER_URL`                           | variable  | Sim, no release           |
| `CSC_LINK`, `CSC_KEY_PASSWORD`                                | secrets   | Opcional (assinatura mac) |
| `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`       | secrets   | Opcional (notarização)    |
| ou `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | secrets   | Opcional (notarização)    |
| `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`   | secrets   | Opcional (Windows)        |
| `WIN_SIGNING`, `WIN_PUBLISHER_NAME`, `AZURE_SIGNING_*`        | variables | Opcional (Windows)        |

## Detalhes técnicos

- Config do empacotador em `electron-builder.ts` (TypeScript; o modo de assinatura sai do ambiente,
  testado em `test/electron-builder-config.test.ts`).
- Nada nativo: o app não tem dependências de runtime além do que o Vite embute, e o SQLite é o
  `node:sqlite` do Electron (`npmRebuild: false`).
- **Fuses do Electron:** `RunAsNode` ligado (a ponte MCP de permissões do Claude Code roda o próprio
  executável com `ELECTRON_RUN_AS_NODE=1`); `NODE_OPTIONS` e `--inspect` desligados; cookies
  criptografados; só carrega o `app.asar`. A validação de integridade do asar ainda está desligada
  (falta testar no mac/Windows empacotados).
- A ponte (`out/main/permission-mcp.js`) roda de dentro do `app.asar` (o Node do Electron lê asar);
  não precisa de `asarUnpack`.
- **Smoke test** (`e2e-packaged/`): abre o app empacotado como um usuário (sem `_electron` do
  Playwright, que dependeria do `--inspect`), conecta pelo CDP, confere a tela inicial e a CSP, e
  roda a ponte MCP do asar com um socket simulado (initialize → tools/list → tools/call). Roda no
  Linux em todo PR e no mac arm64 e no Windows ao empacotar. O mac x64 não é testado (os runners são
  arm64).
- **Custo do Actions:** o CI de PR é só Linux; macOS só no release e no teste manual. O CI não
  roda no push da `main` (o release já roda o mesmo CI antes de empacotar). A decisão veio de quando o repositório era privado (minuto de macOS
  conta 10x); em repositório público os runners padrão são gratuitos.
