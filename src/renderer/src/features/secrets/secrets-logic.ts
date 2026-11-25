/**
 * Regras puras da tela Segredos: nome sugerido enquanto digita, rótulos de "quem usa" e os
 * atalhos do estado vazio (vindos do catálogo de MCP). Sem DOM.
 */
import { stripAccents } from '../../../../shared/text'
import { sameUse, type SecretUse } from '../../../../shared/vault'
import { MCP_CATALOG, mcpSecretNames, type McpServer } from '../../../../shared/mcp'

export const SAVED_MESSAGE = 'Guardado. O Orkio não mostra o valor de novo.'

/** `github token` → `GITHUB_TOKEN` (enquanto digita: não corta o `_` do fim). */
export function toSecretName(text: string): string {
  return stripAccents(text)
    .toUpperCase()
    .replace(/[\s.-]+/g, '_')
    .replace(/[^A-Z0-9_]/g, '')
    .slice(0, 48)
}

/** Nome final: sem `_` nas pontas nem repetido. */
export function finalSecretName(text: string): string {
  return toSecretName(text).replace(/_+/g, '_').replace(/^_+|_+$/g, '')
}

export function secretUseKey(use: SecretUse): string {
  return use.kind === 'agent' ? `agent:${use.key}` : `mcp:${use.id}`
}

/** Liga/desliga um uso na lista (sem repetir). */
export function toggleUse(list: readonly SecretUse[], use: SecretUse, on: boolean): SecretUse[] {
  const without = list.filter((u) => !sameUse(u, use))
  return on ? [...without, use] : without
}

export function hasUse(list: readonly SecretUse[], use: SecretUse): boolean {
  return list.some((u) => sameUse(u, use))
}

/** Nome para o chip: o do agente/servidor quando conhecido, senão a chave/o id. */
export function secretUseLabel(
  use: SecretUse,
  agentNames: ReadonlyMap<string, string>,
  servers: readonly Pick<McpServer, 'id' | 'name'>[]
): string {
  if (use.kind === 'agent') return agentNames.get(use.key) ?? use.key.replace(/^[a-z]+:/, '')
  return servers.find((s) => s.id === use.id)?.name ?? use.id
}

/** Servidores do Orkio que referenciam o segredo (aviso ao apagar). */
export function serversUsingSecret<T extends McpServer>(servers: readonly T[], name: string): T[] {
  return servers.filter((s) => mcpSecretNames(s).includes(name))
}

export interface SecretShortcut {
  label: string
  name: string
  note: string
}

/** Atalhos do estado vazio: o nome sugerido pelo catálogo de MCP. */
export const SECRET_SHORTCUTS: readonly SecretShortcut[] = [
  { catalogId: 'github', label: 'Token do GitHub para o MCP' },
  { catalogId: 'notion', label: 'Token do Notion para o MCP' }
].flatMap(({ catalogId, label }) => {
  const entry = MCP_CATALOG.find((e) => e.id === catalogId)
  const secret = entry?.secrets[0]
  return entry && secret
    ? [{ label, name: secret.suggested, note: `Para o servidor MCP ${entry.name}` }]
    : []
})
