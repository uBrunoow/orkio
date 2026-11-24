import type { IpcMain } from 'electron'
import {
  parseAgentKey,
  type AgentBadge,
  type AgentProfile,
  type AgentsState,
  type ProjectAgents
} from '../../shared/agent'
import { IPC_CHANNELS } from '../../shared/ipc-contract'
import { AgentError, type AgentsService } from '../agents/agents.service'
import { errorName } from './payload'
import { isId } from './projects.ipc'
import type { SenderGuard } from './trusted-sender'
import type { Result } from '../../shared/result'

const INVALID: Result<never> = {
  ok: false,
  error: { code: 'invalid', message: 'Pedido inválido. Atualize a tela e tente de novo.' }
}
const GENERIC: Result<never> = {
  ok: false,
  error: { code: 'unexpected', message: 'Algo deu errado com os agentes. Tente novamente.' }
}

/** Perfil vindo do editor: só a forma (tipos); as regras são do `validateAgent` no serviço. */
export function toProfile(value: unknown): AgentProfile | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const v = value as Record<string, unknown>
  const limits = v['limits']
  if (typeof limits !== 'object' || limits === null) return null
  const l = limits as Record<string, unknown>
  const str = (x: unknown, max: number): x is string => typeof x === 'string' && x.length <= max
  if (
    !str(v['id'], 40) ||
    !str(v['name'], 200) ||
    !str(v['role'], 20) ||
    !str(v['color'], 20) ||
    !str(v['model'], 61) ||
    !(v['effort'] === undefined || v['effort'] === null || str(v['effort'], 10)) ||
    !(v['flow'] === null || str(v['flow'], 100)) ||
    !Array.isArray(v['commands']) ||
    v['commands'].length > 50 ||
    !v['commands'].every((c) => str(c, 100)) ||
    typeof v['delivery'] !== 'boolean' ||
    typeof v['archived'] !== 'boolean' ||
    !str(v['instructions'], 20_000) ||
    typeof l['parallel'] !== 'number' ||
    typeof l['stepsPerDay'] !== 'number' ||
    !(l['costPerDayUsd'] === null || typeof l['costPerDayUsd'] === 'number')
  ) {
    return null
  }
  return {
    id: v['id'],
    name: v['name'],
    role: v['role'] as AgentProfile['role'],
    color: v['color'] as AgentProfile['color'],
    model: v['model'] as AgentProfile['model'],
    effort: v['effort'] === undefined ? null : (v['effort'] as AgentProfile['effort']),
    flow: v['flow'] as string | null,
    commands: v['commands'] as string[],
    delivery: v['delivery'],
    archived: v['archived'],
    instructions: v['instructions'],
    limits: {
      parallel: l['parallel'],
      stepsPerDay: l['stepsPerDay'],
      costPerDayUsd: l['costPerDayUsd'] as number | null
    }
  }
}

function toRules(value: unknown): ProjectAgents['assignOnEnter'] | null {
  if (!Array.isArray(value) || value.length > 50) return null
  const out: ProjectAgents['assignOnEnter'] = []
  for (const r of value) {
    if (typeof r !== 'object' || r === null) return null
    const { stageId, agentKey } = r as Record<string, unknown>
    if (!isId(stageId) || !parseAgentKey(agentKey)) return null
    out.push({ stageId, agentKey: agentKey as string })
  }
  return out
}

export function registerAgentsIpc(
  ipc: Pick<IpcMain, 'handle'>,
  service: AgentsService,
  isTrustedSender: SenderGuard,
  ready: Promise<void> = Promise.resolve()
): void {
  const ch = IPC_CHANNELS.agents
  function guarded<T>(channel: string, fallback: T, run: (...args: unknown[]) => Promise<T>): void {
    ipc.handle(channel, async (event, ...args: unknown[]) => {
      if (!isTrustedSender(event)) throw new Error('Origem de IPC não autorizada')
      try {
        await ready
        return await run(...args)
      } catch (error) {
        if (error instanceof AgentError) {
          return { ok: false, error: { code: error.code, message: error.message } } as T
        }
        console.error(`[orkio] falha inesperada em ${channel}: ${errorName(error)}`)
        return fallback
      }
    })
  }
  const ok = <T>(value: T): Result<T> => ({ ok: true, value })

  guarded<Result<AgentsState>>(ch.list, GENERIC, async (projectId) =>
    isId(projectId) ? ok(await service.list(projectId)) : INVALID
  )
  guarded<Result<AgentsState>>(ch.save, GENERIC, async (input) => {
    if (typeof input !== 'object' || input === null) return INVALID
    const v = input as Record<string, unknown>
    const profile = toProfile(v['profile'])
    if (
      !isId(v['projectId']) ||
      (v['scope'] !== 'repo' && v['scope'] !== 'local') ||
      typeof v['isNew'] !== 'boolean' ||
      !profile
    ) {
      return INVALID
    }
    await service.save({
      projectId: v['projectId'],
      scope: v['scope'],
      profile,
      isNew: v['isNew']
    })
    return ok(await service.list(v['projectId']))
  })
  guarded<Result<AgentsState>>(ch.approve, GENERIC, async (projectId, key, hash) => {
    if (
      !isId(projectId) ||
      !parseAgentKey(key) ||
      typeof hash !== 'string' ||
      !/^[a-f0-9]{64}$/.test(hash)
    ) {
      return INVALID
    }
    await service.approve(projectId, key as string, hash)
    return ok(await service.list(projectId))
  })
  guarded<Result<null>>(ch.assign, GENERIC, async (projectId, taskId, key) => {
    if (!isId(projectId) || !isId(taskId) || !(key === null || parseAgentKey(key))) return INVALID
    await service.assign(projectId, taskId, key as string | null)
    return ok(null)
  })
  guarded<Result<AgentsState>>(ch.setRules, GENERIC, async (projectId, rules) => {
    const parsed = toRules(rules)
    if (!isId(projectId) || !parsed) return INVALID
    return ok(await service.setRules(projectId, parsed))
  })
  guarded<Record<string, AgentBadge>>(ch.badges, {}, async (projectId) =>
    isId(projectId) ? service.badges(projectId) : {}
  )
}
