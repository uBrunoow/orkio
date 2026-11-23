# Desenvolvimento

Como rodar, testar e empacotar o Orkio. As convenções completas (arquitetura, IPC, segurança,
Astryx e CSP) estão no [`CLAUDE.md`](../CLAUDE.md). Volte ao [README](../README.md).

## Requisitos

- Node.js 22.12+ (ou 20.19+)
- pnpm 10+
- Linux: um keyring ativo (GNOME Keyring/libsecret ou KWallet). Sem ele o Orkio
  **não salva** o token (ver [Segurança](configuracao.md#segurança)).

## Rodar em modo dev

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

## Build e empacotamento

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

A interface usa **[shadcn/ui](https://ui.shadcn.com)** (componentes Radix copiados para
`src/renderer/src/components/ui/`) e **Tailwind CSS v4**, com o **tema Orkio** em
`src/renderer/src/styles/globals.css` (escuro, laranja da marca com texto preto, Inter na UI,
JetBrains Mono em IDs e código). A referência visual é o mockup
(`docs/superpowers/specs/2026-11-23-orkio-ui-mockup.html`); a marca continua em
[`brand/`](../brand/BRAND.md).

- **Novo componente:** `pnpm dlx shadcn@latest add <nome>` (o CLI grava em `@/components/ui`;
  mova para `src/renderer/src/components/ui/` e troque os ícones `lucide-react` pelos do Tabler).
- **CSP estrita:** o Tailwind gera um `.css` estático. Partes do Radix injetam `<style>` (Select,
  ScrollArea e o modo modal de Dialog/DropdownMenu): o Orkio usa um Select próprio, rolagem nativa
  e diálogos/menus não modais. Detalhes no `CLAUDE.md`.
- **Fontes:** locais via `@fontsource` (Inter, Jost no logo e em títulos de destaque, JetBrains Mono).
- **Ícones:** [Tabler Icons](https://tabler.io/icons) (`@tabler/icons-react`), inclusive os logos do GitHub e do Notion.
- **Logo:** `<OrkioLogo variant="full|simple" withWordmark size />`.
- **Ícones do app:** `pnpm icons` gera `build/icon.icns`, `build/icon.ico`, `build/icon.png` e
  `resources/icon.png` a partir de `brand/orkio-app-icon-1024.png` (png2icons).
