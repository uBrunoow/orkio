import type { IpcMainInvokeEvent } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { ORKIO_API } from '../../shared/ipc/api'
import type { DeviceFlowConnector, OAuthConnector } from '../connectors/types'
import { AgentError } from '../agents/agents.service'
import type { AgentMemoryStore } from '../agents/agent-memory.store'
import type { AgentsService } from '../agents/agents.service'
import { DeliveryError } from '../delivery/delivery.service'
import { FlowError, type FlowRunner } from '../flows/flow-runner'
import type { FlowsService } from '../flows/flows.service'
import type { OpenPrDeps } from '../flows/open-pr'
import type { OrchestratorService } from '../orchestrator/orchestrator.service'
import { defaultAgent } from '../../shared/agent'
import type { ConnectionStatus } from '../../shared/connection'
import { agentsHandlers } from './agents.ipc'
import { boardHandlers } from './board.ipc'
import { claudeHandlers } from './claude.ipc'
import { createEmitter } from './emit'
import { flowHandlers } from './flow.ipc'
import { githubHandlers } from './github.ipc'
import { notionHandlers } from './notion.ipc'
import { notionWorkspaceHandlers } from './notion-workspace.ipc'
import { projectsHandlers } from './projects.ipc'
import { registerGroup, registerHandlers, type Handlers, type RegisterOptions } from './register'
import { isAllowedExternalUrl, openExternalHandler, siteUrlRules } from './shell.ipc'
import { serversHandlers } from './servers.ipc'
import { signalsHandlers } from './signals.ipc'
import { taskFlowsHandlers } from './task-flows.ipc'
import { createSenderGuard, isTrustedRendererUrl } from './trusted-sender'
import { updatesHandlers, type UpdatesIpcService } from './updates.ipc'

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>

interface FakeIpc {
  trusted: boolean
  channels: () => string[]
  handle: (channel: string, handler: Handler) => void
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
}

function fakeIpc(): FakeIpc {
  const handlers = new Map<string, Handler>()
  const state: FakeIpc = {
    trusted: true,
    channels: () => [...handlers.keys()],
    handle: (channel, handler) => {
      handlers.set(channel, handler)
    },
    invoke: async (channel, ...args) => {
      const handler = handlers.get(channel)
      if (!handler) throw new Error(`sem handler para ${channel}`)
      const url = state.trusted ? 'file:///app/out/renderer/index.html' : 'https://evil.example/'
      return handler({ senderFrame: { url } } as unknown as IpcMainInvokeEvent, ...args)
    }
  }
  return state
}

const guard = createSenderGuard({ rendererFileUrl: 'file:///app/out/renderer/index.html' })
const options = (ready: Promise<void> = Promise.resolve()): RegisterOptions => ({
  isTrustedSender: guard,
  ready
})
const TASK = '11111111-1111-4111-8111-000000000001'
const invalid = { ok: false, error: { code: 'invalid' } }

function fakeConnector(overrides: Partial<OAuthConnector> = {}): OAuthConnector {
  return {
    id: 'notion',
    getAuthOptions: vi.fn(() => ({ oauth: true })),
    startOAuth: vi.fn(async (): Promise<ConnectionStatus> => ({ state: 'disconnected' })),
    cancelOAuth: vi.fn(),
    connect: vi.fn(async (): Promise<ConnectionStatus> => ({ state: 'disconnected' })),
    disconnect: vi.fn(async () => {}),
    getStatus: vi.fn(async (): Promise<ConnectionStatus> => ({ state: 'disconnected' })),
    testConnection: vi.fn(async (): Promise<ConnectionStatus> => ({ state: 'disconnected' })),
    ...overrides
  }
}

function notionIpc(
  connector: OAuthConnector,
  onOAuthFinished = vi.fn(),
  onChanged = vi.fn()
): FakeIpc {
  const ipc = fakeIpc()
  registerGroup(
    ipc,
    options(),
    ORKIO_API.notion,
    notionHandlers(connector, onOAuthFinished, onChanged)
  )
  return ipc
}

describe('isTrustedRendererUrl', () => {
  const origins = {
    devServerUrl: 'http://localhost:5173/',
    rendererFileUrl: 'file:///app/out/renderer/index.html'
  }
  it('aceita o dev server e o index.html empacotado', () => {
    expect(isTrustedRendererUrl('http://localhost:5173/', origins)).toBe(true)
    expect(isTrustedRendererUrl('file:///app/out/renderer/index.html', origins)).toBe(true)
  })
  it('recusa outras origens e outros arquivos', () => {
    expect(isTrustedRendererUrl('http://localhost:5174/', origins)).toBe(false)
    expect(isTrustedRendererUrl('https://evil.example/', origins)).toBe(false)
    expect(isTrustedRendererUrl('file:///tmp/evil.html', origins)).toBe(false)
    expect(isTrustedRendererUrl('lixo', origins)).toBe(false)
    expect(
      isTrustedRendererUrl('http://localhost:5173/', { rendererFileUrl: origins.rendererFileUrl })
    ).toBe(false)
  })
})

describe('registro único (registerHandlers)', () => {
  it('registra todos os canais declarados e recusa origem não confiável em qualquer um', async () => {
    const ipc = fakeIpc()
    const fn = (): (() => Promise<never>) => async () => {
      throw new Error('não deveria rodar')
    }
    // Um handler qualquer por método: o teste é do registro, não dos serviços.
    const stub = (spec: object): Record<string, unknown> =>
      Object.fromEntries(
        Object.entries(spec)
          .filter(([, v]) => (v as { kind?: string }).kind !== 'event')
          .map(([k, v]) => [k, (v as { kind?: string }).kind === 'call' ? fn() : stub(v)])
      )
    registerHandlers(ipc, options(), stub(ORKIO_API) as unknown as Handlers)
    const declared = Object.values(ORKIO_API).flatMap((g) =>
      (g as { kind?: string }).kind === 'call'
        ? [(g as { channel: string }).channel]
        : Object.values(g)
            .filter((m) => (m as { kind?: string }).kind === 'call')
            .map((m) => (m as { channel: string }).channel)
    )
    expect(ipc.channels().sort()).toEqual(declared.sort())

    ipc.trusted = false
    for (const channel of ipc.channels()) {
      await expect(ipc.invoke(channel)).rejects.toThrow('Origem de IPC não autorizada')
    }
  })

  it('falta de handler fora do banco é erro na hora de registrar', () => {
    const ipc = fakeIpc()
    expect(() =>
      registerGroup(ipc, options(), ORKIO_API.notion, {
        ...notionHandlers(fakeConnector(), vi.fn(), vi.fn()),
        getStatus: undefined as never
      })
    ).toThrow('IPC sem handler: notion:get-status')
    expect(() => registerGroup(ipc, options(), ORKIO_API.projects, null)).toThrow('IPC sem handler')
  })

  it('banco indisponível: todo canal do banco responde o fallback dele (nada de erro cru)', async () => {
    const ipc = fakeIpc()
    for (const group of [
      ORKIO_API.board,
      ORKIO_API.flow,
      ORKIO_API.automation,
      ORKIO_API.alva,
      ORKIO_API.agents,
      ORKIO_API.taskFlows,
      ORKIO_API.claude,
      ORKIO_API.overview
    ]) {
      registerGroup(ipc, options(), group, null)
    }
    const unavailable = { ok: false, error: { code: 'db_unavailable' } }
    expect(await ipc.invoke(ORKIO_API.board.get.channel, 'p1')).toMatchObject(unavailable)
    expect(await ipc.invoke(ORKIO_API.taskFlows.start.channel, 'p1', TASK)).toMatchObject(
      unavailable
    )
    expect(await ipc.invoke(ORKIO_API.claude.state.channel, 'p1', TASK)).toMatchObject(unavailable)
    expect(await ipc.invoke(ORKIO_API.agents.list.channel, 'p1')).toMatchObject(unavailable)
    expect(await ipc.invoke(ORKIO_API.agents.badges.channel, 'p1')).toEqual({})
    expect(await ipc.invoke(ORKIO_API.taskFlows.runs.channel, TASK)).toEqual([])
    expect(await ipc.invoke(ORKIO_API.claude.readLog.channel, 'r1')).toEqual([])
    expect(await ipc.invoke(ORKIO_API.claude.status.channel)).toMatchObject({ installed: false })
    expect(await ipc.invoke(ORKIO_API.automation.status.channel, 'p1')).toMatchObject({
      error: 'Não foi possível consultar as automações.'
    })
    const r = (await ipc.invoke(ORKIO_API.overview.get.channel)) as {
      error: { message: string }
    }
    expect(r.error.message).toMatch(/banco local/)
  })

  it('espera a config carregar antes de rodar canais que precisam dela', async () => {
    const ipc = fakeIpc()
    const service = fakeProjects()
    let release!: () => void
    const ready = new Promise<void>((r) => (release = r))
    registerGroup(ipc, options(ready), ORKIO_API.projects, projectsHandlers(service))
    const pending = ipc.invoke(ORKIO_API.projects.list.channel)
    await Promise.resolve()
    expect(service.list).not.toHaveBeenCalled()
    release()
    await pending
    expect(service.list).toHaveBeenCalled()
  })

  it('evento: um envio a todas as janelas, com os efeitos declarados', () => {
    const send = vi.fn()
    const effects = { overview: vi.fn(), keepAwake: vi.fn() }
    const emit = createEmitter({
      windows: () => [
        { isDestroyed: () => false, webContents: { send } },
        { isDestroyed: () => true, webContents: { send } }
      ],
      effects
    })
    emit('agentsChanged', { projectId: 'p1' })
    expect(send).toHaveBeenCalledWith('agents:changed', { projectId: 'p1' })
    expect(effects.overview).not.toHaveBeenCalled()
    emit('boardSync', {
      projectId: 'p1',
      taskId: TASK,
      state: 'synced',
      stageId: null,
      blocked: false
    })
    expect(effects.overview).toHaveBeenCalledTimes(1)
    expect(effects.keepAwake).not.toHaveBeenCalled()
    const message = { runId: 'r', projectId: 'p1', taskId: TASK }
    emit('runEvent', { ...message, event: { kind: 'text', text: 'oi' } } as never)
    expect(effects.keepAwake).not.toHaveBeenCalled()
    emit('runEvent', { ...message, event: { kind: 'status', status: 'running' } } as never)
    expect(effects.keepAwake).toHaveBeenCalledTimes(1)
    expect(effects.overview).toHaveBeenCalledTimes(2)
    expect(send).toHaveBeenCalledTimes(4)
  })
})

describe('notion', () => {
  it('encaminha connect com payload validado', async () => {
    const connector = fakeConnector()
    const ipc = notionIpc(connector)
    await ipc.invoke(ORKIO_API.notion.connect.channel, { kind: 'token', token: 'ntn_x', extra: 1 })
    expect(connector.connect).toHaveBeenCalledWith({ kind: 'token', token: 'ntn_x' })
  })

  it('conectar, desconectar e conferir avisam as janelas; ler o status não', async () => {
    const onChanged = vi.fn()
    const ipc = notionIpc(fakeConnector(), vi.fn(), onChanged)
    await ipc.invoke(ORKIO_API.notion.getStatus.channel)
    expect(onChanged).not.toHaveBeenCalled()
    await ipc.invoke(ORKIO_API.notion.connect.channel, { kind: 'token', token: 'ntn_x' })
    await ipc.invoke(ORKIO_API.notion.testConnection.channel)
    await ipc.invoke(ORKIO_API.notion.disconnect.channel)
    expect(onChanged).toHaveBeenCalledTimes(3)
  })

  it('payload inválido não chega ao conector', async () => {
    const connector = fakeConnector()
    const ipc = notionIpc(connector)
    for (const payload of [undefined, 'ntn_x', { token: 1 }, { kind: 'oauth', token: 'x' }]) {
      expect(await ipc.invoke(ORKIO_API.notion.connect.channel, payload)).toMatchObject({
        state: 'error'
      })
    }
    expect(connector.connect).not.toHaveBeenCalled()
  })

  it('recusa chamadas de origem não confiável', async () => {
    const connector = fakeConnector()
    const ipc = notionIpc(connector)
    ipc.trusted = false
    for (const spec of [
      ORKIO_API.notion.getStatus,
      ORKIO_API.notion.getAuthOptions,
      ORKIO_API.notion.startOAuth,
      ORKIO_API.notion.cancelOAuth
    ]) {
      await expect(ipc.invoke(spec.channel)).rejects.toThrow('não autorizada')
    }
    expect(connector.getStatus).not.toHaveBeenCalled()
    expect(connector.startOAuth).not.toHaveBeenCalled()
    expect(connector.cancelOAuth).not.toHaveBeenCalled()
  })

  it('disconnect devolve desconectado', async () => {
    const connector = fakeConnector()
    const ipc = notionIpc(connector)
    expect(await ipc.invoke(ORKIO_API.notion.disconnect.channel)).toEqual({
      state: 'disconnected'
    })
    expect(connector.disconnect).toHaveBeenCalled()
  })

  it('exceção inesperada vira erro genérico e o log não traz a mensagem original', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const ipc = notionIpc(
      fakeConnector({
        getStatus: async () => {
          throw new Error('segredo ntn_LEAK')
        }
      })
    )
    const result = await ipc.invoke(ORKIO_API.notion.getStatus.channel)
    expect(result).toMatchObject({ state: 'error' })
    expect(JSON.stringify(result)).not.toContain('ntn_LEAK')
    expect(JSON.stringify(spy.mock.calls)).not.toContain('ntn_LEAK')
    spy.mockRestore()
  })

  it('OAuth: opções, início (foca a janela no fim) e cancelamento', async () => {
    const connector = fakeConnector({
      startOAuth: vi.fn(async (): Promise<ConnectionStatus> => ({
        state: 'connected',
        account: { userName: 'Ada' },
        connectedAt: '2026-11-19T12:00:00.000Z'
      }))
    })
    const onOAuthFinished = vi.fn()
    const ipc = notionIpc(connector, onOAuthFinished)
    expect(await ipc.invoke(ORKIO_API.notion.getAuthOptions.channel)).toEqual({ oauth: true })
    expect(await ipc.invoke(ORKIO_API.notion.startOAuth.channel)).toMatchObject({
      state: 'connected'
    })
    expect(onOAuthFinished).toHaveBeenCalledTimes(1)
    await ipc.invoke(ORKIO_API.notion.cancelOAuth.channel)
    expect(connector.cancelOAuth).toHaveBeenCalled()
  })

  it('getAuthOptions/cancelOAuth com exceção: resposta segura, não o erro cru (antes sem try/catch)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const ipc = notionIpc(
      fakeConnector({
        getAuthOptions: () => {
          throw new Error('ntn_LEAK')
        },
        cancelOAuth: () => {
          throw new Error('ntn_LEAK')
        }
      })
    )
    expect(await ipc.invoke(ORKIO_API.notion.getAuthOptions.channel)).toEqual({ oauth: false })
    expect(await ipc.invoke(ORKIO_API.notion.cancelOAuth.channel)).toBeUndefined()
    expect(JSON.stringify(spy.mock.calls)).not.toContain('ntn_LEAK')
    spy.mockRestore()
  })
})

function fakeGitHub(overrides: Partial<DeviceFlowConnector> = {}): DeviceFlowConnector {
  return {
    id: 'github',
    getAuthOptions: vi.fn(() => ({ oauth: true })),
    startDeviceFlow: vi.fn(async () => ({
      ok: true as const,
      flow: {
        userCode: 'WDJB-MJHT',
        verificationUri: 'https://github.com/login/device',
        expiresAt: '2026-11-19T12:15:00.000Z'
      }
    })),
    waitDeviceFlow: vi.fn(async (): Promise<ConnectionStatus> => ({ state: 'disconnected' })),
    cancelDeviceFlow: vi.fn(),
    connect: vi.fn(async (): Promise<ConnectionStatus> => ({ state: 'disconnected' })),
    disconnect: vi.fn(async () => {}),
    getStatus: vi.fn(async (): Promise<ConnectionStatus> => ({ state: 'disconnected' })),
    testConnection: vi.fn(async (): Promise<ConnectionStatus> => ({ state: 'disconnected' })),
    ...overrides
  }
}

function githubIpc(
  connector: DeviceFlowConnector,
  onDeviceFlowFinished = vi.fn(),
  orkioBot = vi.fn(async () => ({ github: 'connected' as const, repos: [], checkedAt: null }))
): FakeIpc {
  const ipc = fakeIpc()
  registerGroup(
    ipc,
    options(),
    ORKIO_API.github,
    githubHandlers(connector, { onDeviceFlowFinished, orkioBot, onChanged: vi.fn() })
  )
  return ipc
}

describe('github', () => {
  const ch = ORKIO_API.github
  it('Device Flow: start devolve só código/URL/expiração; wait resolve e foca a janela', async () => {
    const connector = fakeGitHub()
    const onDeviceFlowFinished = vi.fn()
    const ipc = githubIpc(connector, onDeviceFlowFinished)
    expect(await ipc.invoke(ch.getAuthOptions.channel)).toEqual({ oauth: true })
    expect(await ipc.invoke(ch.startDeviceFlow.channel)).toEqual({
      ok: true,
      flow: {
        userCode: 'WDJB-MJHT',
        verificationUri: 'https://github.com/login/device',
        expiresAt: '2026-11-19T12:15:00.000Z'
      }
    })
    await ipc.invoke(ch.waitDeviceFlow.channel)
    expect(onDeviceFlowFinished).toHaveBeenCalledTimes(1)
    await ipc.invoke(ch.cancelDeviceFlow.channel)
    expect(connector.cancelDeviceFlow).toHaveBeenCalled()
  })

  it('connect valida o payload; orkioBot normaliza force', async () => {
    const connector = fakeGitHub()
    const orkioBot = vi.fn(async () => ({
      github: 'connected' as const,
      repos: [],
      checkedAt: null
    }))
    const ipc = githubIpc(connector, vi.fn(), orkioBot)
    expect(await ipc.invoke(ch.connect.channel, { token: 1 })).toMatchObject({ state: 'error' })
    await ipc.invoke(ch.connect.channel, { kind: 'token', token: 'ghp_x', extra: 1 })
    expect(connector.connect).toHaveBeenCalledWith({ kind: 'token', token: 'ghp_x' })
    await ipc.invoke(ch.orkioBot.channel, { force: 'sim' })
    await ipc.invoke(ch.orkioBot.channel, { force: true })
    expect(orkioBot.mock.calls).toEqual([[false], [true]])
  })

  it('exceção inesperada vira erro genérico, sem a mensagem original no log', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const ipc = githubIpc(
      fakeGitHub({
        startDeviceFlow: async () => {
          throw new Error('gho_LEAK')
        }
      })
    )
    const result = await ipc.invoke(ch.startDeviceFlow.channel)
    expect(result).toMatchObject({ ok: false, status: { state: 'error' } })
    expect(JSON.stringify([result, spy.mock.calls])).not.toContain('gho_LEAK')
    spy.mockRestore()
  })
})

function fakeProjects() {
  return {
    list: vi.fn(async () => ({ projects: [] })),
    revalidate: vi.fn(async () => ({ projects: [] })),
    pickFolder: vi.fn(async () => ({ ok: false as const, cancelled: true as const })),
    create: vi.fn(async () => ({ ok: false as const, cancelled: true as const })),
    relocate: vi.fn(async () => ({ ok: false as const, cancelled: true as const })),
    remove: vi.fn(async () => ({ ok: true })),
    setArchived: vi.fn(async () => ({ ok: true })),
    setAccess: vi.fn(async () => ({ ok: false as const, cancelled: true as const }))
  }
}

describe('projects', () => {
  const ch = ORKIO_API.projects
  function setup() {
    const ipc = fakeIpc()
    const service = fakeProjects()
    registerGroup(ipc, options(), ch, projectsHandlers(service))
    return { ipc, service }
  }

  it('create só aceita selectionId/remoteName/hostConfirmed/name — nunca caminhos', async () => {
    const { ipc, service } = setup()
    for (const payload of [
      undefined,
      { localPath: '/etc' },
      { selectionId: '../../etc', remoteName: 'origin', hostConfirmed: false },
      { selectionId: 'abc', remoteName: 'origin', hostConfirmed: 'sim' },
      { selectionId: 'abc', remoteName: '', hostConfirmed: false }
    ]) {
      expect(await ipc.invoke(ch.create.channel, payload)).toMatchObject({ ok: false })
    }
    expect(service.create).not.toHaveBeenCalled()
    await ipc.invoke(ch.create.channel, {
      selectionId: 'id-1',
      remoteName: 'origin',
      hostConfirmed: false,
      localPath: '/etc'
    })
    expect(service.create).toHaveBeenCalledWith({
      selectionId: 'id-1',
      remoteName: 'origin',
      hostConfirmed: false
    })
  })

  it('relocate/remove exigem id válido', async () => {
    const { ipc, service } = setup()
    expect(await ipc.invoke(ch.relocate.channel, '/home/user')).toMatchObject({
      ok: false,
      error: { message: 'Projeto inválido.' }
    })
    expect(await ipc.invoke(ch.remove.channel, { id: 1 })).toEqual({ ok: false })
    expect(service.relocate).not.toHaveBeenCalled()
    expect(service.remove).not.toHaveBeenCalled()
    await ipc.invoke(ch.remove.channel, 'id-1')
    expect(service.remove).toHaveBeenCalledWith('id-1')
  })
})

describe('shell.openExternal', () => {
  it('allowlist do repo público de releases (6C): só DMG e página de versão', () => {
    const base = 'https://github.com/uBrunoow/orkio/releases'
    expect(isAllowedExternalUrl(`${base}/download/v1.2.0/Orkio-1.2.0-mac-arm64.dmg`)).toBe(true)
    expect(isAllowedExternalUrl(`${base}/tag/v1.2.0-beta.1`)).toBe(true)
    expect(isAllowedExternalUrl(`${base}/download/v1.2.0/Orkio-1.2.0-win-x64-setup.exe`)).toBe(
      false
    )
    expect(isAllowedExternalUrl('https://github.com/uBrunoow/outro-repo/releases/tag/v1.2.0')).toBe(
      false
    )
    expect(isAllowedExternalUrl('https://github.com/uBrunoow/orkio/settings')).toBe(false)
  })

  it('instalação do GitHub App do Orkio: só a página de instalação do App', () => {
    expect(isAllowedExternalUrl('https://github.com/apps/orkio/installations/new')).toBe(true)
    expect(isAllowedExternalUrl('https://github.com/apps/orkio-dev/installations/new')).toBe(true)
    expect(isAllowedExternalUrl('https://github.com/apps/orkio')).toBe(false)
    expect(isAllowedExternalUrl('https://github.com/apps/orkio/installations/new/x')).toBe(false)
    expect(isAllowedExternalUrl('https://github.com/apps/Orkio/installations/new')).toBe(false)
    expect(isAllowedExternalUrl('https://github.com/settings/apps/orkio')).toBe(false)
  })

  it('site do Orkio só com https e sem porta (Configurações > Sobre)', () => {
    const rules = siteUrlRules('https://orkio.example')
    expect(isAllowedExternalUrl('https://orkio.example/privacidade', rules)).toBe(true)
    expect(isAllowedExternalUrl('https://orkio.example/privacidade')).toBe(false)
    expect(siteUrlRules('http://127.0.0.1:3000')).toEqual([])
    expect(siteUrlRules(null)).toEqual([])
  })

  it('allowlist: só https nos domínios do Notion', () => {
    expect(isAllowedExternalUrl('https://developers.notion.com/guides/x')).toBe(true)
    expect(isAllowedExternalUrl('https://www.notion.so/profile/integrations')).toBe(true)
    expect(isAllowedExternalUrl('https://app.notion.com/p/344a411ece3b805bab4ce80f6553a9e4')).toBe(
      true
    )
    expect(isAllowedExternalUrl('https://www.notion.com/acme/Tarefa-abc')).toBe(true)
    expect(isAllowedExternalUrl('https://app.notion.com.evil.com/p/x')).toBe(false)
    expect(isAllowedExternalUrl('http://developers.notion.com/')).toBe(false)
    expect(isAllowedExternalUrl('https://notion.so.evil.com/')).toBe(false)
    expect(isAllowedExternalUrl('https://evil.com/?u=https://notion.so')).toBe(false)
    expect(isAllowedExternalUrl('https://user@notion.so/')).toBe(false)
    expect(isAllowedExternalUrl('file:///etc/passwd')).toBe(false)
    expect(isAllowedExternalUrl(42)).toBe(false)
  })

  it('allowlist do GitHub: só a página do Device Flow e docs.github.com', () => {
    expect(isAllowedExternalUrl('https://github.com/login/device')).toBe(true)
    expect(isAllowedExternalUrl('https://github.com/login/device/select_account')).toBe(true)
    expect(isAllowedExternalUrl('https://docs.github.com/en/authentication')).toBe(true)
    expect(isAllowedExternalUrl('https://github.com/settings/tokens')).toBe(false)
    expect(isAllowedExternalUrl('https://github.com/login/devicex')).toBe(false)
    expect(isAllowedExternalUrl('https://github.com/')).toBe(false)
    expect(isAllowedExternalUrl('https://gist.github.com/login/device')).toBe(false)
  })

  it('allowlist: acesso de organizações e SSO do GitHub', () => {
    expect(
      isAllowedExternalUrl('https://github.com/settings/connections/applications/Iv1.abc')
    ).toBe(true)
    expect(isAllowedExternalUrl('https://github.com/settings/personal-access-tokens')).toBe(true)
    expect(isAllowedExternalUrl('https://github.com/orgs/acme/sso?authorization_request=ABC')).toBe(
      true
    )
    expect(isAllowedExternalUrl('https://github.com/orgs/acme/settings')).toBe(false)
    expect(isAllowedExternalUrl('https://github.com/orgs/acme/sso/extra')).toBe(false)
    expect(isAllowedExternalUrl('https://github.com/settings/keys')).toBe(false)
  })

  it('abre só URLs permitidas', async () => {
    const ipc = fakeIpc()
    const open = vi.fn(async () => {})
    registerGroup(
      ipc,
      options(),
      { openExternal: ORKIO_API.openExternal },
      { openExternal: openExternalHandler(open, []) }
    )
    const ch = ORKIO_API.openExternal.channel

    expect(await ipc.invoke(ch, 'https://evil.com')).toBe(false)
    expect(await ipc.invoke(ch, { url: 'https://notion.so/x' })).toBe(false)
    expect(open).not.toHaveBeenCalled()
    expect(await ipc.invoke(ch, 'https://notion.so/x')).toBe(true)
    expect(open).toHaveBeenCalledWith('https://notion.so/x')
  })
})

describe('notionWorkspace', () => {
  const DS_A = '11111111-1111-1111-1111-111111111111'
  const DS_B = '2222222222222222222222222222222a'
  const ok = <T>(value: T) => ({ ok: true as const, value })
  const ch = ORKIO_API.notionWorkspace

  function setup() {
    const ipc = fakeIpc()
    const status = { config: null, health: 'ok' as const, messages: [], connection: null }
    const service = {
      getStatus: vi.fn(async () => status),
      revalidate: vi.fn(async () => status),
      listDataSources: vi.fn(async () =>
        ok({ dataSources: [], truncated: false, connection: null })
      ),
      getTasksSchema: vi.fn(async () => ok({} as never)),
      saveConfig: vi.fn(async () => ok({} as never)),
      listProjectChoices: vi.fn(async () => ok({ choices: [], truncated: false })),
      link: vi.fn(async () => ok({ id: DS_A, name: 'X' })),
      unlink: vi.fn(async () => ok(null)),
      listTasks: vi.fn(async () => {
        throw new Error('ntn_SECRET')
      }),
      searchTasks: vi.fn(async () => ok({ tasks: [] }))
    }
    registerGroup(ipc, options(), ch, notionWorkspaceHandlers(service))
    return { ipc, service }
  }

  it('valida ids e o formato do mapeamento antes de chamar o serviço', async () => {
    const { ipc, service } = setup()
    await ipc.invoke(ch.getTasksSchema.channel, DS_B, DS_A)
    expect(service.getTasksSchema).toHaveBeenCalledWith(DS_B, DS_A)

    expect(await ipc.invoke(ch.getTasksSchema.channel, '../etc', DS_A)).toMatchObject(invalid)
    expect(await ipc.invoke(ch.link.channel, 'proj-1', 'https://notion.so/x')).toMatchObject(
      invalid
    )
    expect(
      await ipc.invoke(ch.save.channel, {
        projectsDataSourceId: DS_A,
        tasksDataSourceId: DS_B,
        mapping: { title: 'title', hacked: 'x' }
      })
    ).toMatchObject(invalid)
    expect(service.saveConfig).not.toHaveBeenCalled()

    const input = {
      projectsDataSourceId: DS_A,
      tasksDataSourceId: DS_B,
      mapping: { title: 'title', status: 'st', uniqueId: 'uid', project: 'rel', priority: null }
    }
    await ipc.invoke(ch.save.channel, input)
    expect(service.saveConfig).toHaveBeenCalledWith(input)

    await ipc.invoke(ch.link.channel, 'proj-1', DS_A)
    expect(service.link).toHaveBeenCalledWith('proj-1', DS_A)
    await ipc.invoke(ch.listDataSources.channel, '')
    expect(service.listDataSources).toHaveBeenCalledWith(undefined)

    await ipc.invoke(ch.searchTasks.channel, 'ORK-142')
    expect(service.searchTasks).toHaveBeenCalledWith('ORK-142')
    expect(await ipc.invoke(ch.searchTasks.channel, { q: 1 })).toMatchObject(invalid)
    expect(await ipc.invoke(ch.searchTasks.channel, 'x'.repeat(201))).toMatchObject(invalid)
    expect(service.searchTasks).toHaveBeenCalledTimes(1)
  })

  it('erro inesperado vira mensagem genérica; force é normalizado', async () => {
    const { ipc, service } = setup()
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = await ipc.invoke(ch.listTasks.channel, 'proj-1', { force: 'yes' })
    expect(service.listTasks).toHaveBeenCalledWith('proj-1', { force: false })
    expect(JSON.stringify(result)).not.toContain('SECRET')
    expect(result).toMatchObject({ ok: false, error: { code: 'unexpected' } })
    expect(errors.mock.calls.flat().join(' ')).not.toContain('SECRET')
    errors.mockRestore()
  })
})

describe('signals', () => {
  const ch = ORKIO_API.signals
  it('valida ids, normaliza force e não vaza erro', async () => {
    const ipc = fakeIpc()
    const service = {
      get: vi.fn(async () => {
        throw new Error('gho_SECRET')
      })
    }
    const reviews = {
      get: vi
        .fn()
        .mockResolvedValueOnce({ ok: false, code: 'no_pr', message: 'Sem PR.' })
        .mockRejectedValueOnce(new Error('gho_SECRET'))
    }
    registerGroup(ipc, options(), ch, signalsHandlers(service as never, reviews as never))
    expect(await ipc.invoke(ch.get.channel, '../x')).toMatchObject(invalid)
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = await ipc.invoke(ch.get.channel, 'proj-1', { force: 1 })
    expect(service.get).toHaveBeenCalledWith('proj-1', { force: false })
    expect(JSON.stringify(result)).not.toContain('SECRET')

    expect(await ipc.invoke(ch.reviewThreads.channel, '../x', TASK)).toMatchObject(invalid)
    expect(await ipc.invoke(ch.reviewThreads.channel, 'proj-1', { id: 1 })).toMatchObject(invalid)
    expect(reviews.get).not.toHaveBeenCalled()
    expect(await ipc.invoke(ch.reviewThreads.channel, 'proj-1', TASK, { force: 1 })).toEqual({
      ok: false,
      error: { code: 'no_pr', message: 'Sem PR.' }
    })
    expect(reviews.get).toHaveBeenCalledWith('proj-1', TASK, false)
    const failed = await ipc.invoke(ch.reviewThreads.channel, 'proj-1', TASK, { force: true })
    expect(reviews.get).toHaveBeenLastCalledWith('proj-1', TASK, true)
    expect(JSON.stringify(failed)).not.toContain('SECRET')
    expect(errors.mock.calls.flat().join(' ')).not.toContain('SECRET')
    errors.mockRestore()
  })
})

describe('allowlist: PRs do GitHub', () => {
  it('aceita só /<owner>/<repo>/pull/<n>', () => {
    expect(isAllowedExternalUrl('https://github.com/acme/app.js/pull/12')).toBe(true)
    expect(isAllowedExternalUrl('https://github.com/acme/app/pull/12/files')).toBe(false)
    expect(isAllowedExternalUrl('https://github.com/acme/app/issues/12')).toBe(false)
    expect(isAllowedExternalUrl('https://gist.github.com/acme/app/pull/12')).toBe(false)
  })

  it('owner com "_" (conta gerenciada) e link da revisão com âncora', () => {
    expect(isAllowedExternalUrl('https://github.com/ana_acme/app/pull/12')).toBe(true)
    expect(isAllowedExternalUrl('https://github.com/acme/app/pull/12#pullrequestreview-99')).toBe(
      true
    )
    expect(isAllowedExternalUrl('https://github.com/ana.acme/app/pull/12')).toBe(false)
    expect(isAllowedExternalUrl('https://github.com:8443/acme/app/pull/12')).toBe(false)
  })

  it('Abrir PR: aceita só a comparação do GitHub (base...branch) de um repositório', () => {
    expect(
      isAllowedExternalUrl('https://github.com/acme/app/compare/main...feat/ORK-7-x?expand=1')
    ).toBe(true)
    expect(isAllowedExternalUrl('https://github.com/acme/app/compare/feat%2Fx')).toBe(true)
    expect(isAllowedExternalUrl('https://github.com/acme/app/compare/')).toBe(false)
    expect(isAllowedExternalUrl('https://github.com/acme/app/compare/a/../../settings')).toBe(false)
    expect(isAllowedExternalUrl('https://evil.com/acme/app/compare/main...x')).toBe(false)
  })

  it('5C: aceita a branch da tarefa em /<owner>/<repo>/tree/<branch>', () => {
    expect(isAllowedExternalUrl('https://github.com/acme/app/tree/ORK-7/exportar-csv')).toBe(true)
    expect(isAllowedExternalUrl('https://github.com/acme/app/tree/')).toBe(false)
    expect(isAllowedExternalUrl('https://github.com/acme/app/tree/x/../../settings')).toBe(false)
    expect(isAllowedExternalUrl('https://github.com/acme/app/blob/main/x')).toBe(false)
  })

  it('branch e "Criar a PR" aceitam o mesmo owner que a PR (conta gerenciada, com `_`)', () => {
    expect(isAllowedExternalUrl('https://github.com/ana_acme/app/pull/12')).toBe(true)
    expect(isAllowedExternalUrl('https://github.com/ana_acme/app/tree/feat/x')).toBe(true)
    expect(isAllowedExternalUrl('https://github.com/ana_acme/app/compare/main...feat/x')).toBe(true)
  })
})

describe('board e flow', () => {
  it('valida ids, etapas e o formato do salvar', async () => {
    const ipc = fakeIpc()
    const ok = async () => ({ ok: true as const, value: null as never })
    const service = {
      get: vi.fn(ok),
      save: vi.fn(ok),
      move: vi.fn(ok),
      setBlocked: vi.fn(ok),
      history: vi.fn(ok),
      retryNow: vi.fn(),
      setAutomationPaused: vi.fn(ok)
    }
    const ch = ORKIO_API.board
    registerGroup(ipc, options(), ch, boardHandlers(service))

    expect(await ipc.invoke(ch.move.channel, 'p1', 'não-é-id', 'stage-1')).toMatchObject(invalid)
    expect(await ipc.invoke(ch.move.channel, 'p1', TASK, '../x')).toMatchObject(invalid)
    await ipc.invoke(ch.move.channel, 'p1', TASK, 'stage_1')
    expect(service.move).toHaveBeenCalledWith('p1', TASK, 'stage_1')

    expect(await ipc.invoke(ch.setBlocked.channel, 'p1', TASK, 'sim')).toMatchObject(invalid)
    const input = {
      stages: [{ id: null, name: 'Prioridades', notionStatusId: 'o1' }],
      orkioStage: { mode: 'existing', propertyId: 'sel' },
      addMissingOptions: false,
      blockedPropertyId: null
    }
    await ipc.invoke(ch.save.channel, 'p1', input)
    expect(service.save).toHaveBeenCalledWith('p1', input)
    expect(await ipc.invoke(ch.save.channel, 'p1', { ...input, stages: [] })).toMatchObject(invalid)
    expect(service.save).toHaveBeenCalledTimes(1)
    await ipc.invoke(ch.setAutomationPaused.channel, 'p1', TASK, true)
    expect(service.setAutomationPaused).toHaveBeenCalledWith('p1', TASK, true)
  })

  it('flow: forma do rascunho, exportar e importar', async () => {
    const ipc = fakeIpc()
    const service = {
      saveFlow: vi.fn(async () => ({ ok: true as const, value: null as never })),
      configEvents: vi.fn(async () => [])
    }
    const files = { save: vi.fn(async () => null), open: vi.fn(async () => '{oops') }
    const ch = ORKIO_API.flow
    registerGroup(ipc, options(), ch, flowHandlers(service, files))
    expect(await ipc.invoke(ch.save.channel, 'p1', { stages: 'x' })).toMatchObject(invalid)
    expect(await ipc.invoke(ch.events.channel, '../x')).toEqual([])
    expect(await ipc.invoke(ch.exportFile.channel, { a: 1 })).toEqual({
      ok: false,
      cancelled: true
    })
    expect(await ipc.invoke(ch.importFile.channel)).toMatchObject({ ok: false, cancelled: false })
  })
})

describe('agentes e orquestrador', () => {
  const ANA = defaultAgent({ id: 'ana', name: 'Ana', instructions: 'Testes sempre.' })
  const state = { projectId: 'p1', agents: [], rules: [] }
  const ch = ORKIO_API.agents

  function setup() {
    const ipc = fakeIpc()
    const service = {
      list: vi.fn(async () => state),
      save: vi.fn(async () => ({})),
      approve: vi.fn(async () => ({})),
      assign: vi.fn(async () => undefined),
      setRules: vi.fn(async () => state),
      badges: vi.fn(async () => ({})),
      get: vi.fn(async (_p: string, key: string) => (key === 'repo:ana' ? { key } : null))
    }
    const memory = {
      read: vi.fn(async () => ({ notes: [] })),
      add: vi.fn(async () => ({ notes: [] }))
    }
    const orchestrator = {
      state: vi.fn(async () => ({})),
      save: vi.fn(async () => ({})),
      tick: vi.fn(async () => undefined)
    }
    registerGroup(
      ipc,
      options(),
      ch,
      agentsHandlers(
        service as unknown as AgentsService,
        orchestrator as unknown as OrchestratorService,
        memory as unknown as AgentMemoryStore
      )
    )
    return { ipc, service, orchestrator, memory }
  }

  it('valida o payload antes de chegar ao serviço', async () => {
    const { ipc, service } = setup()
    const save = (input: unknown): Promise<unknown> => ipc.invoke(ch.save.channel, input)
    expect(
      await save({ projectId: 'p1', scope: 'nuvem', profile: ANA, isNew: true })
    ).toMatchObject({ ok: false })
    expect(
      await save({
        projectId: 'p1',
        scope: 'repo',
        profile: { ...ANA, delivery: 'sim' },
        isNew: true
      })
    ).toMatchObject({ ok: false })
    expect(
      await save({ projectId: '../x', scope: 'repo', profile: ANA, isNew: true })
    ).toMatchObject({ ok: false })
    expect(service.save).not.toHaveBeenCalled()
    expect(await save({ projectId: 'p1', scope: 'repo', profile: ANA, isNew: true })).toEqual({
      ok: true,
      value: state
    })
    expect(await ipc.invoke(ch.assign.channel, 'p1', TASK, 'nuvem:ana')).toMatchObject(invalid)
    expect(await ipc.invoke(ch.approve.channel, 'p1', 'repo:ana', 'curto')).toMatchObject(invalid)
    expect(
      await ipc.invoke(ch.setRules.channel, 'p1', [{ stageId: 's1', agentKey: 'x' }])
    ).toMatchObject(invalid)
  })

  it('memória: valida digest, nota e ação, e recusa agente que não existe', async () => {
    const { ipc, memory } = setup()
    const digest = 'a'.repeat(64)
    const note = { text: 'Testes sempre', scope: 'geral', until: null }
    expect(await ipc.invoke(ch.memory.channel, 'p1', 'repo:ana')).toMatchObject({ ok: true })
    expect(memory.read).toHaveBeenCalledWith('repo:ana', 'p1')
    expect(await ipc.invoke(ch.memory.channel, 'p1', 'repo:outro')).toMatchObject({ ok: false })
    expect(await ipc.invoke(ch.addMemory.channel, 'p1', 'repo:ana', 'curto', note)).toMatchObject(
      invalid
    )
    expect(
      await ipc.invoke(ch.addMemory.channel, 'p1', 'repo:ana', digest, { ...note, scope: 'tudo' })
    ).toMatchObject(invalid)
    expect(
      await ipc.invoke(ch.changeMemory.channel, 'p1', 'repo:ana', digest, '0123abcd', 'sumir')
    ).toMatchObject(invalid)
    expect(
      await ipc.invoke(ch.rollbackMemory.channel, 'p1', 'repo:ana', digest, '../x')
    ).toMatchObject(invalid)
    expect(await ipc.invoke(ch.addMemory.channel, 'p1', 'repo:ana', digest, note)).toMatchObject({
      ok: true
    })
    expect(memory.add).toHaveBeenCalledWith('repo:ana', 'p1', note, digest)
  })

  it('regras e orquestrador aceitam etapa com "_" como o quadro (antes: "Pedido inválido")', async () => {
    const { ipc, service, orchestrator } = setup()
    expect(
      await ipc.invoke(ch.setRules.channel, 'p1', [
        { stageId: 'em_andamento', agentKey: 'repo:ana' }
      ])
    ).toMatchObject({ ok: true })
    expect(service.setRules).toHaveBeenCalledWith('p1', [
      { stageId: 'em_andamento', agentKey: 'repo:ana' }
    ])
    const config = {
      enabled: true,
      queueStageId: null,
      maxActive: 2,
      lanes: [{ stageId: 'em_andamento', agents: ['repo:ana'], next: 'revisao_final' }]
    }
    expect(await ipc.invoke(ch.saveOrchestrator.channel, 'p1', config)).toMatchObject({
      ok: true
    })
    expect(orchestrator.save).toHaveBeenCalled()
  })

  it('erros esperados do serviço viram mensagem; inesperados, mensagem genérica', async () => {
    const { ipc, service } = setup()
    service.assign.mockRejectedValueOnce(new AgentError('busy', 'Tem fluxo.'))
    expect(await ipc.invoke(ch.assign.channel, 'p1', TASK, 'repo:ana')).toEqual({
      ok: false,
      error: { code: 'busy', message: 'Tem fluxo.' }
    })
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    service.assign.mockRejectedValueOnce(new Error('segredo ghp_xxxxxxxxxxxxxxxxxxxxxxxx'))
    const r = await ipc.invoke(ch.assign.channel, 'p1', TASK, null)
    expect(JSON.stringify(r)).not.toContain('ghp_')
    expect(r).toMatchObject({ ok: false, error: { code: 'unexpected' } })
    errors.mockRestore()
  })

  it('erro de domínio em método sem Result (badges) devolve o fallback, não um Result', async () => {
    const { ipc, service } = setup()
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    service.badges.mockRejectedValueOnce(new AgentError('busy', 'Tem fluxo.'))
    expect(await ipc.invoke(ch.badges.channel, 'p1')).toEqual({})
    errors.mockRestore()
  })
})

describe('taskFlows', () => {
  const ch = ORKIO_API.taskFlows

  function deps(over: Partial<OpenPrDeps> = {}): OpenPrDeps {
    return {
      linked: () => false,
      alvaReady: async () => true,
      compareUrl: () => 'https://github.com/o/r/compare/main...feat/x?expand=1',
      alreadyPushed: async () => false,
      startBuiltin: vi.fn(async () => ({}) as never),
      ...over
    }
  }

  function setup(openPr: OpenPrDeps = deps(), runner: Partial<FlowRunner> = {}) {
    const ipc = fakeIpc()
    registerGroup(
      ipc,
      options(),
      ch,
      taskFlowsHandlers({} as FlowsService, runner as FlowRunner, openPr)
    )
    return ipc
  }

  it('openPr: payload inválido → pedido inválido; resultado no Result', async () => {
    const ipc = setup()
    for (const args of [
      ['../x', TASK],
      ['p1', 5],
      [undefined, undefined]
    ]) {
      expect(await ipc.invoke(ch.openPr.channel, ...args)).toMatchObject(invalid)
    }
    expect(await ipc.invoke(ch.openPr.channel, 'p1', TASK)).toEqual({
      ok: true,
      value: {
        started: true,
        mode: 'push',
        compareUrl: 'https://github.com/o/r/compare/main...feat/x?expand=1'
      }
    })
  })

  it('FlowError e DeliveryError viram a mensagem pt-BR; desconhecido, genérica', async () => {
    const busy = setup(
      deps({
        startBuiltin: async () => {
          throw new FlowError('busy', 'Já há um fluxo nesta tarefa.')
        }
      })
    )
    expect(await busy.invoke(ch.openPr.channel, 'p1', TASK)).toEqual({
      ok: false,
      error: { code: 'busy', message: 'Já há um fluxo nesta tarefa.' }
    })
    const noTree = setup(
      deps({
        compareUrl: () => {
          throw new DeliveryError('no_worktree', 'Esta tarefa ainda não tem ambiente.')
        }
      })
    )
    expect(await noTree.invoke(ch.openPr.channel, 'p1', TASK)).toEqual({
      ok: false,
      error: { code: 'no_worktree', message: 'Esta tarefa ainda não tem ambiente.' }
    })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const unknown = setup(
      deps({
        compareUrl: () => {
          throw new Error('segredo-interno')
        }
      })
    )
    const r = await unknown.invoke(ch.openPr.channel, 'p1', TASK)
    expect(JSON.stringify(r)).not.toContain('segredo-interno')
    expect(r).toMatchObject({
      ok: false,
      error: { code: 'unexpected', message: 'Algo deu errado no fluxo. Tente novamente.' }
    })
    spy.mockRestore()
  })

  it('pedido de ajuste longo chega ao runner (mensagem do domínio, não "Pedido inválido")', async () => {
    const reviseGate = vi.fn(async () => {
      throw new FlowError('invalid_reply', 'O pedido de ajuste passa de 8000 caracteres.')
    })
    const ipc = setup(deps(), { reviseGate } as Partial<FlowRunner>)
    const text = 'x'.repeat(9000)
    expect(await ipc.invoke(ch.reviseGate.channel, 'p1', TASK, text)).toEqual({
      ok: false,
      error: { code: 'invalid_reply', message: 'O pedido de ajuste passa de 8000 caracteres.' }
    })
    expect(reviseGate).toHaveBeenCalledWith(TASK, text, 'p1')
  })

  it('aprovar gate: valores só de revisores válidos', async () => {
    const approveGate = vi.fn(async () => ({}) as never)
    const ipc = setup(deps(), { approveGate } as Partial<FlowRunner>)
    expect(await ipc.invoke(ch.approve.channel, 'run-1', ['ok', '$(rm)'])).toMatchObject(invalid)
    await ipc.invoke(ch.approve.channel, 'run-1', ['ana', 'team:core'])
    await ipc.invoke(ch.approve.channel, 'run-1')
    expect(approveGate.mock.calls).toEqual([
      ['run-1', ['ana', 'team:core']],
      ['run-1', undefined]
    ])
  })
})

describe('claude', () => {
  it('catálogo da pasta do projeto (sem tarefa) usa null; texto qualquer não é tarefa', async () => {
    const ipc = fakeIpc()
    const catalog = vi.fn(async () => ({ ok: true as const, value: [] }))
    const ch = ORKIO_API.claude
    registerGroup(
      ipc,
      options(),
      ch,
      claudeHandlers({ catalog } as never, {} as never, {} as never)
    )
    expect(await ipc.invoke(ch.catalog.channel, 'p1', null)).toEqual({ ok: true, value: [] })
    await ipc.invoke(ch.catalog.channel, 'p1', TASK)
    expect(await ipc.invoke(ch.catalog.channel, 'p1', 'projeto')).toMatchObject(invalid)
    expect(catalog.mock.calls).toEqual([
      ['p1', null],
      ['p1', TASK]
    ])
  })

  it('imagem da execução: só id válido e n inteiro de 1 a 20', async () => {
    const ipc = fakeIpc()
    const readImage = vi.fn(async () => ({ mime: 'image/png', data: new Uint8Array([1]) }))
    const ch = ORKIO_API.claude
    registerGroup(
      ipc,
      options(),
      ch,
      claudeHandlers({} as never, { readImage } as never, {} as never)
    )
    expect(await ipc.invoke(ch.runImage.channel, 'r1', 1)).toEqual({
      mime: 'image/png',
      data: new Uint8Array([1])
    })
    for (const n of [0, 21, 1.5, '1'])
      expect(await ipc.invoke(ch.runImage.channel, 'r1', n)).toBeNull()
    expect(await ipc.invoke(ch.runImage.channel, '../x', 1)).toBeNull()
    expect(readImage.mock.calls).toEqual([['r1', 1]])
  })
})

describe('servers', () => {
  const def = { id: 's-web', name: 'frontend', command: 'pnpm dev' }

  it('cadastro: forma conferida no IPC (as regras ficam com o serviço)', async () => {
    const ipc = fakeIpc()
    const save = vi.fn(async (_p: string, defs: unknown[]) => defs)
    const ch = ORKIO_API.servers
    registerGroup(
      ipc,
      options(),
      ch,
      serversHandlers({
        servers: { save } as never,
        hasProject: () => true,
        openExternal: async () => undefined
      })
    )
    expect(await ipc.invoke(ch.save.channel, 'p1', [def])).toEqual({ ok: true, value: [def] })
    for (const bad of [
      'x',
      [{ ...def, id: '../x' }],
      [{ ...def, env: { A: 1 } }],
      Array(7).fill(def)
    ])
      expect(await ipc.invoke(ch.save.channel, 'p1', bad)).toMatchObject(invalid)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('subir/abrir: id do servidor validado; abrir só a URL local do servidor de pé', async () => {
    const ipc = fakeIpc()
    const start = vi.fn(async () => ({ id: 's-web' }))
    const urlOf = vi.fn((_p: string, _t: string, id: string) =>
      id === 's-web' ? 'http://localhost:4100' : id === 's-evil' ? 'https://evil.test' : null
    )
    const openExternal = vi.fn(async () => undefined)
    const ch = ORKIO_API.servers
    registerGroup(
      ipc,
      options(),
      ch,
      serversHandlers({ servers: { start, urlOf } as never, hasProject: () => true, openExternal })
    )
    await ipc.invoke(ch.start.channel, 'p1', TASK, 's-web')
    expect(await ipc.invoke(ch.start.channel, 'p1', TASK, 'rm -rf')).toMatchObject(invalid)
    expect(start.mock.calls).toEqual([['p1', TASK, 's-web', 'you']])
    expect(await ipc.invoke(ch.open.channel, 'p1', TASK, 's-web')).toEqual({
      ok: true,
      value: null
    })
    expect(await ipc.invoke(ch.open.channel, 'p1', TASK, 's-evil')).toMatchObject({ ok: false })
    expect(await ipc.invoke(ch.open.channel, 'p1', TASK, 's-api')).toMatchObject({ ok: false })
    expect(openExternal.mock.calls).toEqual([['http://localhost:4100']])
  })
})

describe('updates', () => {
  function service(): UpdatesIpcService {
    const status = {
      mode: 'auto' as const,
      phase: 'idle' as const,
      currentVersion: '1.0.0',
      channel: 'stable' as const,
      version: null,
      progress: null,
      lastCheckAt: null,
      error: null,
      installWhenIdle: false,
      busy: [],
      channelNote: null
    }
    return {
      getStatus: vi.fn(() => status),
      check: vi.fn(async () => {
        throw new Error('rede')
      }),
      setChannel: vi.fn(async () => status),
      install: vi.fn(async () => ({ state: 'installing' as const })),
      openDownload: vi.fn(async () => true),
      whatsNew: vi.fn(() => null),
      markWhatsNewSeen: vi.fn(async () => undefined),
      releaseNotes: vi.fn(() => null)
    }
  }

  it('valida canal e modo; erro e canal inválido devolvem o status atual', async () => {
    const ipc = fakeIpc()
    const s = service()
    const ch = ORKIO_API.updates
    registerGroup(
      ipc,
      options(),
      ch,
      updatesHandlers(
        s,
        () => ({ version: '1.0.0', links: null }),
        async () => 'diag'
      )
    )
    expect(await ipc.invoke(ch.setChannel.channel, 'nightly')).toMatchObject({ phase: 'idle' })
    expect(s.setChannel).not.toHaveBeenCalled()
    await ipc.invoke(ch.setChannel.channel, 'beta')
    expect(s.setChannel).toHaveBeenCalledWith('beta')
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await ipc.invoke(ch.check.channel)).toMatchObject({ phase: 'idle' })
    errors.mockRestore()
    expect(await ipc.invoke(ch.install.channel, 'rm -rf')).toEqual({
      state: 'unavailable',
      message: 'Pedido inválido.'
    })
    expect(s.install).not.toHaveBeenCalled()
    expect(await ipc.invoke(ch.install.channel, 'when_idle')).toEqual({ state: 'installing' })
    ipc.trusted = false
    await expect(ipc.invoke(ch.install.channel, 'now')).rejects.toThrow(
      'Origem de IPC não autorizada'
    )
    expect(s.install).toHaveBeenCalledTimes(1)
  })
})
