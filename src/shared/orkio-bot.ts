/** orkio[bot]: o GitHub App que publica as revisões, instalado (ou não) em cada repositório. */

export type OrkioBotRepoState =
  | { state: 'installed' }
  | { state: 'not_installed'; installUrl: string | null }
  /** A conta conectada não enxerga o repositório. */
  | { state: 'no_access' }
  /** Não deu para saber (site sem endereço/configuração, rede, rate limit). */
  | { state: 'unknown'; message: string }

export interface OrkioBotRepo {
  owner: string
  repo: string
  /** Nomes dos projetos do Orkio com este repositório. */
  projects: string[]
  status: OrkioBotRepoState
}

export interface OrkioBotStatus {
  /** Sem GitHub conectado não há como consultar (a consulta usa a conta do usuário). */
  github: 'connected' | 'disconnected'
  repos: OrkioBotRepo[]
  /** ISO; `null` sem consulta. */
  checkedAt: string | null
}
