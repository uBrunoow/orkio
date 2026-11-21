/// <reference types="electron-vite/node" />

/** Config de build do processo main (arquivos .env, prefixo MAIN_VITE_). Nada aqui é segredo. */
interface ImportMetaEnv {
  /** OAuth client ID da conexão do Notion (público). */
  readonly MAIN_VITE_NOTION_OAUTH_CLIENT_ID?: string
  /** URL https do intermediário OAuth (broker/), que guarda o client secret. */
  readonly MAIN_VITE_NOTION_OAUTH_BROKER_URL?: string
  /** Client ID da OAuth App do GitHub com Device Flow habilitado (público). */
  readonly MAIN_VITE_GITHUB_CLIENT_ID?: string
  /** Endereço https do site (Configurações > Sobre). Sem ele, usa a origem do intermediário. */
  readonly MAIN_VITE_SITE_URL?: string
  /** '1' quando o build do macOS foi assinado com Developer ID (o CI da 6B define). */
  readonly MAIN_VITE_MAC_SIGNED?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

/** Conteúdo de arquivo de texto embutido no build (ex.: CHANGELOG.md para o "O que há de novo"). */
declare module '*?raw' {
  const content: string
  export default content
}
