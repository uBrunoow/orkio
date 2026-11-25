/**
 * Fase 4: o que a configuração acrescenta a uma execução do Claude Code, resolvido na hora de
 * rodar (só no main):
 * - servidores MCP do Orkio ligados para aquele agente (ou "todas as execuções"), com os segredos
 *   liberados para cada servidor nas variáveis/cabeçalhos DELE (vão no mcp-config 0600, apagado no
 *   fim), nunca no ambiente do Claude;
 * - segredos liberados para o agente, como variáveis de ambiente do processo do Claude Code;
 * - skills desligadas no projeto (`Skill(nome)` no deny do `--settings`).
 * Os valores voltam em `secretValues` só para o RunService esconder do log; as notas têm só nomes.
 */
import { mcpAppliesTo, mcpSecretNames, type McpBinding, type McpServer } from '../../shared/mcp'
import { secretNameProblem } from '../../shared/vault'
import type { ResolvedSecrets, VaultService } from '../vault/vault.service'
import { BRIDGE_SERVER } from '../claude/bridge/protocol'

export interface RunExtras {
  /** Entradas a mais no `mcpServers` do mcp-config (nome → definição). */
  mcpServers: Record<string, Record<string, unknown>>
  /** Variáveis a mais no ambiente do processo do Claude Code (segredos do agente). */
  env: Record<string, string>
  /** Regras a mais no deny do `--settings` (skills desligadas). */
  deny: string[]
  /** Valores para esconder no log (nunca gravados). */
  secretValues: string[]
  /** Linhas para o log da execução (só nomes). */
  notes: string[]
}

export const NO_EXTRAS: RunExtras = {
  mcpServers: {},
  env: {},
  deny: [],
  secretValues: [],
  notes: []
}

export interface RunExtrasDeps {
  servers(): McpServer[]
  skillsDisabled(projectId: string): string[]
  vault: Pick<VaultService, 'valuesFor'>
}

function bindingValue(b: McpBinding, values: Record<string, string>): string {
  return b.value.kind === 'text' ? b.value.text : `${b.value.prefix}${values[b.value.secret] ?? ''}`
}

function bindingsRecord(
  list: McpBinding[],
  values: Record<string, string>
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const b of list) out[b.name] = bindingValue(b, values)
  return out
}

function unresolved(r: ResolvedSecrets): string[] {
  return [...r.missing, ...r.denied]
}

export async function resolveRunExtras(
  deps: RunExtrasDeps,
  run: { projectId: string; agentKey: string | null }
): Promise<RunExtras> {
  const out: RunExtras = { mcpServers: {}, env: {}, deny: [], secretValues: [], notes: [] }
  const loaded: string[] = []
  for (const server of deps.servers()) {
    if (!mcpAppliesTo(server, run.agentKey) || server.id === BRIDGE_SERVER) continue
    const resolved = await deps.vault.valuesFor(
      { kind: 'mcp', id: server.id },
      mcpSecretNames(server)
    )
    const bad = unresolved(resolved)
    if (bad.length > 0) {
      out.notes.push(
        `Servidor MCP ${server.name} não carregou: o segredo ${bad.join(', ')} falta ou não está liberado para ele.`
      )
      continue
    }
    out.secretValues.push(...Object.values(resolved.values))
    out.mcpServers[server.id] =
      server.transport === 'stdio'
        ? {
            type: 'stdio',
            command: server.command,
            args: server.args,
            env: bindingsRecord(server.env, resolved.values)
          }
        : {
            type: 'http',
            url: server.url,
            headers: bindingsRecord(server.headers, resolved.values)
          }
    loaded.push(server.name)
  }
  if (loaded.length > 0)
    out.notes.unshift(`Servidores MCP do Orkio nesta execução: ${loaded.join(', ')}.`)

  if (run.agentKey) {
    const agent = await deps.vault.valuesFor({ kind: 'agent', key: run.agentKey })
    const names: string[] = []
    for (const [name, value] of Object.entries(agent.values)) {
      // De novo aqui: nome reservado (PATH, NODE_OPTIONS, ANTHROPIC_*...) nunca vira variável.
      if (secretNameProblem(name)) continue
      out.env[name] = value
      out.secretValues.push(value)
      names.push(name)
    }
    if (names.length > 0) out.notes.push(`Segredos no ambiente do agente: ${names.join(', ')}.`)
  }

  const skills = deps.skillsDisabled(run.projectId)
  if (skills.length > 0) {
    out.deny.push(...skills.map((s) => `Skill(${s})`))
    out.notes.push(`Skills desligadas neste projeto: ${skills.join(', ')}.`)
  }
  out.secretValues = [...new Set(out.secretValues.filter((v) => v.length > 0))]
  return out
}
