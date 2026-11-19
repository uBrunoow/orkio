# CLAUDE.md — convenções do Orkio

App Electron (electron-vite + React + TypeScript strict). Orquestra Notion, GitHub e
Claude Code. Hoje só existe o conector do Notion.

## Comandos

```bash
pnpm install      # postinstall baixa o binário do Electron
pnpm dev          # app em modo dev
pnpm test         # Vitest (src/**/*.test.ts)
pnpm typecheck    # tsc nos dois projetos (node e web)
pnpm lint         # ESLint
pnpm build        # build em out/
pnpm icons        # regenera ícones a partir de brand/orkio-app-icon-1024.png
pnpm dist         # empacota (electron-builder.yml)
```

Antes de dar uma tarefa por concluída: `pnpm typecheck && pnpm lint && pnpm test`.

## Estrutura

```
src/
  shared/ipc-contract.ts   # canais IPC, ConnectionStatus, credenciais, OrkioApi. Sem Node/DOM.
  main/                    # processo main (Node). Único lugar com rede, disco e segredos.
    index.ts               # janela, segurança, wiring de dependências e IPC
    connectors/types.ts    # interface Connector
    connectors/<id>/       # <id>.client.ts (HTTP) + <id>.connector.ts (estado/persistência)
    ipc/                   # handlers finos: validam origem e payload, delegam ao conector
    storage/secure-store.ts
  preload/index.ts         # contextBridge → window.orkio (API mínima e tipada)
  renderer/src/            # React. Sem acesso a Node; só usa window.orkio.
    features/<feature>/    # componentes + hooks por funcionalidade
    components/OrkioLogo/  # logo (símbolo full/simple + wordmark)
    styles/tokens.css      # ÚNICO arquivo de tokens (cores, fontes, raios, espaçamento)
    styles/fonts.css       # fontes locais via @fontsource
brand/                     # fonte da verdade da marca (BRAND.md, SVGs, ícone 1024, tokens)
build/                     # ícones do empacotador (gerados por pnpm icons)
resources/icon.png         # ícone da janela em runtime
```

TS: `tsconfig.node.json` (main, preload, shared) e `tsconfig.web.json` (renderer, shared).

## Segurança dos tokens (regra inegociável)

- Chamadas a APIs externas **só no main**. Nunca use `fetch` para serviços externos no renderer.
- Segredos só via `SecureStore` (`safeStorage`). Se a criptografia não estiver disponível,
  **não salve**: lance `EncryptionUnavailableError` e mostre erro. Nunca há fallback para
  texto puro (no Linux, `basic_text` conta como indisponível).
- O token **nunca** volta para o renderer: conectores devolvem só `ConnectionStatus`.
- Nunca logue tokens, headers, corpos de resposta nem `error.message`/`stack` de erros
  desconhecidos. No main, logue no máximo o nome do erro. (`no-console` está ativo no ESLint.)
- Mensagens ao usuário em pt-BR, curtas e acionáveis. Nunca exiba a exceção crua.
- Testes devem provar que o token não vaza (em mensagens de erro, status e logs).
- Não commite `.env`, `*.bin`, `secrets/`.

## Padrão de conectores

Todo serviço externo implementa `Connector` (`src/main/connectors/types.ts`):
`connect(credentials)`, `disconnect()`, `getStatus()` (local, sem rede) e
`testConnection()` (revalida na API).

- `ConnectorCredentials` é uma união discriminada por `kind` (hoje só `'token'`).
  OAuth entra como nova variante, sem mudar a interface.
- Separe **client** (HTTP puro, timeout, retry, mapeamento de erros para mensagens) de
  **connector** (validação de entrada, persistência, regras de status).
- Erros esperados viram `{ state: 'error', message }`, sem lançar exceção. Falhas
  transitórias (rede, 5xx, 429) em conexão já salva viram `connected` com `warning`.
- Injete dependências (`fetch`, `sleep`, `store`, `now`) para testar sem rede.
- Para adicionar um conector: `ConnectorId` e canais em `shared/ipc-contract.ts`,
  `connectors/<id>/`, `ipc/<id>.ipc.ts`, exposição no preload e feature no renderer.

## IPC

- Canais definidos em `IPC_CHANNELS` (`shared/ipc-contract.ts`). Use `ipcMain.handle`/`invoke`.
- Todo handler checa a origem com `createSenderGuard` e valida o payload (`unknown`).
- O preload expõe funções específicas, nunca `ipcRenderer` cru.
- Links externos: `window.orkio.openExternal`, com allowlist em `ipc/shell.ipc.ts`.

## Notion

- Versão da API centralizada em `NOTION_VERSION` (`notion.client.ts`), hoje `2026-03-11`.
- Usamos `fetch` nativo (não o SDK). Timeout de 10 s; 429 respeita `Retry-After` (uma
  nova tentativa se a espera for de até 5 s).

## Identidade visual

Leia `brand/BRAND.md` antes de mexer em UI.

- Cores só via tokens de `styles/tokens.css`. Nada de hex/rgb fora dele. Única exceção:
  `backgroundColor` do `BrowserWindow` no main (espelha `--bg`).
- Inter = UI; Jost (`--font-brand`) só para logo e títulos grandes; mono para IDs e tokens.
- Fontes vêm de `@fontsource` (importadas em `styles/fonts.css`). Nunca use CDN. O build
  não transforma fontes em `data:` URI (`assetsInlineLimit` no `electron.vite.config.ts`).
- Logo: use `<OrkioLogo>`. Abaixo de 48 px ele usa a versão simple automaticamente.
  Wordmark "ORKIO" em Jost 300, letter-spacing 0.25em (Jost 400 se ≤ 18 px).
  Não distorcer, girar nem aplicar gradiente/sombra.
- Laranja com parcimônia: ação principal, símbolo, estados de agente.
- Texto sobre laranja é sempre `--on-accent` (preto). Nunca branco.
- Ícones: não edite `build/` à mão; troque `brand/orkio-app-icon-1024.png` e rode `pnpm icons`.

## Estilo

- TypeScript strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`).
- Prettier: sem ponto e vírgula, aspas simples, 100 colunas.
- UI: dark mode, CSS puro com os tokens de `styles/tokens.css`; sem bibliotecas de UI.
  Botão primário: fundo `--accent` com texto `--on-accent` (preto). Mono (`--font-mono`)
  para IDs e tokens.
- CSP: nada de `<style>`/`<script>` inline nem atributo `style` no HTML em produção.
  `style-src` só é relaxado no dev server (`electron.vite.config.ts`). A prop `style` do React
  (aplicada via CSSOM) é permitida para variáveis CSS dinâmicas, como no `OrkioLogo`.
- Textos de UI em pt-BR.
