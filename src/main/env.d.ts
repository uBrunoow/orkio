/// <reference types="electron-vite/node" />

/** Config de build do processo main (arquivos .env, prefixo MAIN_VITE_). Nada aqui é segredo. */
interface ImportMetaEnv {
  /** OAuth client ID da conexão do Notion (público). */
  readonly MAIN_VITE_NOTION_OAUTH_CLIENT_ID?: string
  /** URL https do intermediário OAuth (broker/), que guarda o client secret. */
  readonly MAIN_VITE_NOTION_OAUTH_BROKER_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
