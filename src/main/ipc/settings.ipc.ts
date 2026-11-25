/**
 * Fase 4: Segredos, servidores MCP, skills e preferências. Os argumentos já chegam validados pela
 * declaração (`shared/ipc/api.ts`); os serviços validam de novo. Erros esperados (`DomainError`)
 * viram `Result` de falha no registro; o valor de um segredo nunca volta por aqui.
 */
import type { ORKIO_API } from '../../shared/ipc/api'
import type { RememberedRule } from '../../shared/preferences'
import type { Result } from '../../shared/result'
import type { Impl } from './register'
import type { VaultService } from '../vault/vault.service'
import type { McpService } from '../mcp/mcp.service'
import type { SkillsService } from '../settings/skills.service'
import type { PreferencesService } from '../settings/preferences.service'
import type { StorageUsage } from '../../shared/preferences'
import type { RunService } from '../claude/run.service'

const ok = <T>(value: T): Result<T> => ({ ok: true, value })

export function vaultHandlers(vault: VaultService): Impl<typeof ORKIO_API.vault> {
  return {
    get: () => vault.view(),
    save: async (input) => ok(await vault.save(input)),
    remove: async (name) => ok(await vault.remove(name)),
    setUses: async (name, uses) => ok(await vault.setUses(name, uses))
  }
}

export function mcpHandlers(mcp: McpService): Impl<typeof ORKIO_API.mcp> {
  return {
    get: async () => ok(await mcp.view()),
    addFromCatalog: async (catalogId, secrets) => ok(await mcp.addFromCatalog(catalogId, secrets)),
    copyFromClaude: async (ref) => ok(await mcp.copyFromClaude(ref)),
    save: async (server) => ok(await mcp.save(server)),
    remove: async (id) => ok(await mcp.remove(id))
  }
}

export function skillsHandlers(skills: SkillsService): Impl<typeof ORKIO_API.skills> {
  return {
    get: async (projectId) => ok(await skills.view(projectId)),
    setDisabled: async (projectId, names) => ok(await skills.setDisabled(projectId, names))
  }
}

export function prefsHandlers(deps: {
  prefs: PreferencesService
  /** Execuções (banco local); `null` sem o banco. */
  runs: () => Pick<RunService, 'rememberedRules' | 'revokeRule'> | null
  projectName: (projectId: string) => string | null
  storage: () => Promise<StorageUsage>
}): Impl<typeof ORKIO_API.prefs> {
  const rules = (): Result<RememberedRule[]> => {
    const runs = deps.runs()
    if (!runs) {
      return {
        ok: false,
        error: { code: 'db_unavailable', message: 'O banco local não está disponível.' }
      }
    }
    return ok(
      runs.rememberedRules().map((r) => ({
        ...r,
        projectName: deps.projectName(r.projectId) ?? 'Projeto removido'
      }))
    )
  }
  return {
    get: () => deps.prefs.get(),
    save: async (patch) => ok(await deps.prefs.save(patch)),
    rememberedRules: () => rules(),
    revokeRule: (projectId, rule) => {
      deps.runs()?.revokeRule(projectId, rule.tool, rule.pattern)
      return rules()
    },
    storage: async () => ok(await deps.storage())
  }
}
