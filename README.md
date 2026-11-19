# Orkio

App desktop (Electron) de orquestração de desenvolvimento com IA. Conecta planejamento
(Notion), código (GitHub) e agentes (Claude Code).

> Estado atual: apenas a **conexão da conta do Notion** está implementada.

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

## Como criar o token do Notion

O Orkio aceita dois tipos de token. Os dois usam o mesmo header `Authorization: Bearer`.

**Personal Access Token (recomendado para uso pessoal)**

1. Abra <https://www.notion.so/developers/tokens> (Developer portal → _Personal access tokens_).
2. Clique em **New token**, dê um nome (ex.: “Orkio”) e escolha o workspace.
3. Copie o token (começa com `ntn_`).

**Token de integração interna**

1. Abra <https://www.notion.so/profile/integrations> e crie uma integração interna.
2. Copie o _Internal Integration Secret_.
3. Compartilhe com a integração as páginas que o Orkio poderá ler.

Depois, no Orkio, vá em **Integrações → Notion**, cole o token e clique em **Conectar**.
O token é validado em `GET https://api.notion.com/v1/users/me` antes de ser salvo.

Documentação oficial: <https://developers.notion.com/guides/get-started/personal-access-tokens>

## Segurança

- Todas as chamadas à API do Notion são feitas no **processo main**. O renderer não tem
  acesso a Node (`contextIsolation`, `sandbox`, sem `nodeIntegration`) e fala com o main só
  pela API mínima `window.orkio`.
- O token é criptografado com `safeStorage` do Electron (Keychain no macOS, DPAPI no
  Windows, libsecret/KWallet no Linux) e salvo em `<userData>/secrets/notion.bin` com
  permissão `0600`.
- Se não houver criptografia disponível, o token **não é salvo** e o app mostra um erro.
  No Linux, o backend `basic_text` (chave fixa) é tratado como indisponível.
- O token nunca volta para o renderer, não aparece em logs e o `.gitignore` bloqueia `*.bin`
  e `secrets/`.
- CSP restritiva no `index.html`; navegação e novas janelas bloqueadas; links externos só
  abrem para domínios do Notion (allowlist no main).

Para desconectar, use **Desconectar** no card. Isso apaga o arquivo do disco. O token
continua válido no Notion; revogue-o por lá se quiser invalidá-lo.
