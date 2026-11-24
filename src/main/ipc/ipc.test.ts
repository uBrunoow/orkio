import type { IpcMainInvokeEvent } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../../shared/ipc-contract'
import type { DeviceFlowConnector, OAuthConnector } from '../connectors/types'
import { registerGitHubIpc } from './github.ipc'
import { registerProjectsIpc } from './projects.ipc'
import { registerSignalsIpc } from './signals.ipc'
import { registerBoardIpc } from './board.ipc'
import { isFlowDraft, registerFlowIpc } from './flow.ipc'
import { registerAutomationIpc } from './automation.ipc'
import { registerNotionIpc } from './notion.ipc'
import { registerNotionWorkspaceIpc } from './notion-workspace.ipc'
import { isAllowedExternalUrl, registerShellIpc, siteUrlRules } from './shell.ipc'
import { registerUpdatesIpc, type UpdatesIpcService } from './updates.ipc'
import { createSenderGuard, isTrustedRendererUrl } from './trusted-sender'
import { registerAgentsIpc, toProfile } from './agents.ipc'
import type { AgentsService } from '../agents/agents.service'
import { AgentError } from '../agents/agents.service'
import { defaultAgent, validateAgent } from '../../shared/agent'
import type { ConnectionStatus } from '../../shared/connection'

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>

interface FakeIpc {
  trusted: boolean
  handle: (channel: string, handler: Handler) => void
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
}

function fakeIpc(): FakeIpc {
  const handlers = new Map<string, Handler>()
  const state: FakeIpc = {
    trusted: true,
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

describe('registerNotionIpc', () => {
  it('encaminha connect com payload validado', async () => {
    const ipc = fakeIpc()
    const connector = fakeConnector()
    registerNotionIpc(ipc, connector, guard)

    await ipc.invoke(IPC_CHANNELS.notion.connect, { kind: 'token', token: 'ntn_x', extra: 1 })
    expect(connector.connect).toHaveBeenCalledWith({ kind: 'token', token: 'ntn_x' })
  })

  it('payload inválido não chega ao conector', async () => {
    const ipc = fakeIpc()
    const connector = fakeConnector()
    registerNotionIpc(ipc, connector, guard)

    for (const payload of [undefined, 'ntn_x', { token: 1 }, { kind: 'oauth', token: 'x' }]) {
      expect(await ipc.invoke(IPC_CHANNELS.notion.connect, payload)).toMatchObject({
        state: 'error'
      })
    }
    expect(connector.connect).not.toHaveBeenCalled()
  })

  it('recusa chamadas de origem não confiável', async () => {
    const ipc = fakeIpc()
    const connector = fakeConnector()
    registerNotionIpc(ipc, connector, guard)
    ipc.trusted = false

    await expect(ipc.invoke(IPC_CHANNELS.notion.getStatus)).rejects.toThrow('não autorizada')
    expect(connector.getStatus).not.toHaveBeenCalled()
  })

  it('disconnect devolve desconectado', async () => {
    const ipc = fakeIpc()
    const connector = fakeConnector()
    registerNotionIpc(ipc, connector, guard)
    expect(await ipc.invoke(IPC_CHANNELS.notion.disconnect)).toEqual({ state: 'disconnected' })
    expect(connector.disconnect).toHaveBeenCalled()
  })

  it('exceção inesperada vira erro genérico e o log não traz a mensagem original', async () => {
    const ipc = fakeIpc()
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    registerNotionIpc(
      ipc,
      fakeConnector({
        getStatus: async () => {
          throw new Error('segredo ntn_LEAK')
        }
      }),
      guard
    )

    const result = await ipc.invoke(IPC_CHANNELS.notion.getStatus)
    expect(result).toMatchObject({ state: 'error' })
    expect(JSON.stringify(result)).not.toContain('ntn_LEAK')
    expect(JSON.stringify(spy.mock.calls)).not.toContain('ntn_LEAK')
  })
})

describe('registerNotionIpc — OAuth', () => {
  it('expõe opções de autenticação, inicia e cancela o fluxo', async () => {
    const ipc = fakeIpc()
    const connector = fakeConnector({
      startOAuth: vi.fn(async (): Promise<ConnectionStatus> => ({
        state: 'connected',
        account: { userName: 'Ada' },
        connectedAt: '2026-11-19T12:00:00.000Z'
      }))
    })
    const onOAuthFinished = vi.fn()
    registerNotionIpc(ipc, connector, guard, { onOAuthFinished })

    expect(await ipc.invoke(IPC_CHANNELS.notion.getAuthOptions)).toEqual({ oauth: true })
    expect(await ipc.invoke(IPC_CHANNELS.notion.startOAuth)).toMatchObject({ state: 'connected' })
    expect(onOAuthFinished).toHaveBeenCalledTimes(1)
    await ipc.invoke(IPC_CHANNELS.notion.cancelOAuth)
    expect(connector.cancelOAuth).toHaveBeenCalled()
  })

  it('canais OAuth recusam origem não confiável', async () => {
    const ipc = fakeIpc()
    const connector = fakeConnector()
    registerNotionIpc(ipc, connector, guard)
    ipc.trusted = false

    for (const channel of [
      IPC_CHANNELS.notion.getAuthOptions,
      IPC_CHANNELS.notion.startOAuth,
      IPC_CHANNELS.notion.cancelOAuth
    ]) {
      await expect(ipc.invoke(channel)).rejects.toThrow('não autorizada')
    }
    expect(connector.startOAuth).not.toHaveBeenCalled()
    expect(connector.cancelOAuth).not.toHaveBeenCalled()
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

describe('registerGitHubIpc', () => {
  it('Device Flow: start devolve só código/URL/expiração; wait resolve e foca a janela', async () => {
    const ipc = fakeIpc()
    const connector = fakeGitHub()
    const onDeviceFlowFinished = vi.fn()
    registerGitHubIpc(ipc, connector, guard, { onDeviceFlowFinished })

    expect(await ipc.invoke(IPC_CHANNELS.github.getAuthOptions)).toEqual({ oauth: true })
    expect(await ipc.invoke(IPC_CHANNELS.github.startDeviceFlow)).toEqual({
      ok: true,
      flow: {
        userCode: 'WDJB-MJHT',
        verificationUri: 'https://github.com/login/device',
        expiresAt: '2026-11-19T12:15:00.000Z'
      }
    })
    await ipc.invoke(IPC_CHANNELS.github.waitDeviceFlow)
    expect(onDeviceFlowFinished).toHaveBeenCalledTimes(1)
    await ipc.invoke(IPC_CHANNELS.github.cancelDeviceFlow)
    expect(connector.cancelDeviceFlow).toHaveBeenCalled()
  })

  it('connect valida o payload', async () => {
    const ipc = fakeIpc()
    const connector = fakeGitHub()
    registerGitHubIpc(ipc, connector, guard)
    expect(await ipc.invoke(IPC_CHANNELS.github.connect, { token: 1 })).toMatchObject({
      state: 'error'
    })
    await ipc.invoke(IPC_CHANNELS.github.connect, { kind: 'token', token: 'ghp_x', extra: 1 })
    expect(connector.connect).toHaveBeenCalledWith({ kind: 'token', token: 'ghp_x' })
  })

  it('todos os canais recusam origem não confiável', async () => {
    const ipc = fakeIpc()
    const connector = fakeGitHub()
    registerGitHubIpc(ipc, connector, guard)
    ipc.trusted = false
    for (const channel of Object.values(IPC_CHANNELS.github)) {
      await expect(ipc.invoke(channel)).rejects.toThrow('não autorizada')
    }
    expect(connector.startDeviceFlow).not.toHaveBeenCalled()
  })

  it('exceção inesperada vira erro genérico, sem a mensagem original no log', async () => {
    const ipc = fakeIpc()
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    registerGitHubIpc(
      ipc,
      fakeGitHub({
        startDeviceFlow: async () => {
          throw new Error('gho_LEAK')
        }
      }),
      guard
    )
    const result = await ipc.invoke(IPC_CHANNELS.github.startDeviceFlow)
    expect(result).toMatchObject({ ok: false, status: { state: 'error' } })
    expect(JSON.stringify([result, spy.mock.calls])).not.toContain('gho_LEAK')
  })
})

describe('registerProjectsIpc', () => {
  function fakeProjects() {
    return {
      list: vi.fn(async () => ({ projects: [] })),
      revalidate: vi.fn(async () => ({ projects: [] })),
      pickFolder: vi.fn(async () => ({ ok: false as const, cancelled: true as const })),
      create: vi.fn(async () => ({ ok: false as const, cancelled: true as const })),
      relocate: vi.fn(async () => ({ ok: false as const, cancelled: true as const })),
      remove: vi.fn(async () => ({ ok: true }))
    }
  }

  it('create só aceita selectionId/remoteName/hostConfirmed/name — nunca caminhos', async () => {
    const ipc = fakeIpc()
    const service = fakeProjects()
    registerProjectsIpc(ipc, service, guard)

    for (const payload of [
      undefined,
      { localPath: '/etc' },
      { selectionId: '../../etc', remoteName: 'origin', hostConfirmed: false },
      { selectionId: 'abc', remoteName: 'origin', hostConfirmed: 'sim' },
      { selectionId: 'abc', remoteName: '', hostConfirmed: false }
    ]) {
      expect(await ipc.invoke(IPC_CHANNELS.projects.create, payload)).toMatchObject({ ok: false })
    }
    expect(service.create).not.toHaveBeenCalled()

    await ipc.invoke(IPC_CHANNELS.projects.create, {
      selectionId: 'id-1',
      remoteName: 'origin',
      hostConfirmed: false
    })
    expect(service.create).toHaveBeenCalledWith({
      selectionId: 'id-1',
      remoteName: 'origin',
      hostConfirmed: false
    })
  })

  it('relocate/remove exigem id válido', async () => {
    const ipc = fakeIpc()
    const service = fakeProjects()
    registerProjectsIpc(ipc, service, guard)
    expect(await ipc.invoke(IPC_CHANNELS.projects.relocate, '/home/user')).toMatchObject({
      ok: false
    })
    expect(await ipc.invoke(IPC_CHANNELS.projects.remove, { id: 1 })).toEqual({ ok: false })
    expect(service.relocate).not.toHaveBeenCalled()
    expect(service.remove).not.toHaveBeenCalled()
    await ipc.invoke(IPC_CHANNELS.projects.remove, 'id-1')
    expect(service.remove).toHaveBeenCalledWith('id-1')
  })

  it('espera o serviço inicializar e recusa origem não confiável', async () => {
    const ipc = fakeIpc()
    const service = fakeProjects()
    let release!: () => void
    const ready = new Promise<void>((r) => (release = r))
    registerProjectsIpc(ipc, service, guard, ready)

    const pending = ipc.invoke(IPC_CHANNELS.projects.list)
    await new Promise((r) => setTimeout(r, 5))
    expect(service.list).not.toHaveBeenCalled()
    release()
    await pending
    expect(service.list).toHaveBeenCalled()

    ipc.trusted = false
    for (const channel of [
      IPC_CHANNELS.projects.list,
      IPC_CHANNELS.projects.pickFolder,
      IPC_CHANNELS.projects.remove
    ]) {
      await expect(ipc.invoke(channel)).rejects.toThrow('não autorizada')
    }
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
    registerShellIpc(ipc, open, guard)

    expect(await ipc.invoke(IPC_CHANNELS.shell.openExternal, 'https://evil.com')).toBe(false)
    expect(open).not.toHaveBeenCalled()
    expect(await ipc.invoke(IPC_CHANNELS.shell.openExternal, 'https://notion.so/x')).toBe(true)
    expect(open).toHaveBeenCalledWith('https://notion.so/x')
  })
})

describe('registerNotionWorkspaceIpc', () => {
  const DS_A = '11111111-1111-1111-1111-111111111111'
  const DS_B = '2222222222222222222222222222222a'
  const ok = <T>(value: T) => ({ ok: true as const, value })

  function setup() {
    const ipc = fakeIpc()
    const service = {
      getStatus: vi.fn(async () => ({
        config: null,
        health: 'ok' as const,
        messages: [],
        connection: null
      })),
      revalidate: vi.fn(async () => ({
        config: null,
        health: 'ok' as const,
        messages: [],
        connection: null
      })),
      listDataSources: vi.fn(async () =>
        ok({ dataSources: [], truncated: false, connection: null })
      ),
      getTasksSchema: vi.fn(async () => ok({} as never)),
      saveConfig: vi.fn(async () => ok({} as never)),
      clearConfig: vi.fn(async () => ok({} as never)),
      listProjectChoices: vi.fn(async () => ok({ choices: [], truncated: false })),
      link: vi.fn(async () => ok({ id: DS_A, name: 'X' })),
      unlink: vi.fn(async () => ok(null)),
      listTasks: vi.fn(async () => {
        throw new Error('ntn_SECRET')
      }),
      searchTasks: vi.fn(async () => ok({ tasks: [] }))
    }
    registerNotionWorkspaceIpc(ipc, service, guard)
    return { ipc, service }
  }
  const ch = IPC_CHANNELS.notionWorkspace

  it('valida ids e o formato do mapeamento antes de chamar o serviço', async () => {
    const { ipc, service } = setup()
    await ipc.invoke(ch.getTasksSchema, DS_B, DS_A)
    expect(service.getTasksSchema).toHaveBeenCalledWith(DS_B, DS_A)

    const invalid = { ok: false, error: { code: 'invalid' } }
    expect(await ipc.invoke(ch.getTasksSchema, '../etc', DS_A)).toMatchObject(invalid)
    expect(await ipc.invoke(ch.link, 'proj-1', 'https://notion.so/x')).toMatchObject(invalid)
    expect(
      await ipc.invoke(ch.save, {
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
    await ipc.invoke(ch.save, input)
    expect(service.saveConfig).toHaveBeenCalledWith(input)

    await ipc.invoke(ch.link, 'proj-1', DS_A)
    expect(service.link).toHaveBeenCalledWith('proj-1', DS_A)
    await ipc.invoke(ch.listTasks, 'proj-1', { force: 'yes' })
    expect(service.listTasks).toHaveBeenCalledWith('proj-1', { force: false })

    // Busca: só texto curto.
    await ipc.invoke(ch.searchTasks, 'ORK-142')
    expect(service.searchTasks).toHaveBeenCalledWith('ORK-142')
    expect(await ipc.invoke(ch.searchTasks, { q: 1 })).toMatchObject(invalid)
    expect(await ipc.invoke(ch.searchTasks, 'x'.repeat(201))).toMatchObject(invalid)
    expect(service.searchTasks).toHaveBeenCalledTimes(1)
  })

  it('erro inesperado vira mensagem genérica; origem não confiável é recusada', async () => {
    const { ipc, service } = setup()
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = await ipc.invoke(ch.listTasks, 'proj-1')
    expect(JSON.stringify(result)).not.toContain('SECRET')
    expect(result).toMatchObject({ ok: false, error: { code: 'unexpected' } })
    expect(errors.mock.calls.flat().join(' ')).not.toContain('SECRET')
    errors.mockRestore()

    ipc.trusted = false
    await expect(ipc.invoke(ch.getStatus)).rejects.toThrow('não autorizada')
    expect(service.getStatus).not.toHaveBeenCalled()
  })
})

describe('registerSignalsIpc', () => {
  it('valida o id do projeto, normaliza force e não vaza erro', async () => {
    const ipc = fakeIpc()
    const service = {
      get: vi.fn(async () => {
        throw new Error('gho_SECRET')
      })
    }
    registerSignalsIpc(ipc, service as never, guard)
    expect(await ipc.invoke(IPC_CHANNELS.signals.get, '../x')).toMatchObject({
      ok: false,
      error: { code: 'invalid' }
    })
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = await ipc.invoke(IPC_CHANNELS.signals.get, 'proj-1', { force: 1 })
    expect(service.get).toHaveBeenCalledWith('proj-1', { force: false })
    expect(JSON.stringify(result)).not.toContain('SECRET')
    expect(errors.mock.calls.flat().join(' ')).not.toContain('SECRET')
    errors.mockRestore()
  })
})

describe('registerSignalsIpc: reviewThreads', () => {
  it('valida os ids, normaliza force e não vaza erro', async () => {
    const ipc = fakeIpc()
    const reviews = {
      get: vi
        .fn()
        .mockResolvedValueOnce({ ok: false, code: 'no_pr', message: 'Sem PR.' })
        .mockRejectedValueOnce(new Error('gho_SECRET'))
    }
    registerSignalsIpc(ipc, { get: vi.fn() } as never, guard, Promise.resolve(), reviews as never)
    const ch = IPC_CHANNELS.signals.reviewThreads
    expect(await ipc.invoke(ch, '../x', 'task')).toMatchObject({ ok: false })
    expect(await ipc.invoke(ch, 'proj-1', { id: 1 })).toMatchObject({ ok: false })
    expect(reviews.get).not.toHaveBeenCalled()
    expect(await ipc.invoke(ch, 'proj-1', 'task-1', { force: 1 })).toEqual({
      ok: false,
      error: { code: 'no_pr', message: 'Sem PR.' }
    })
    expect(reviews.get).toHaveBeenCalledWith('proj-1', 'task-1', false)
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const failed = await ipc.invoke(ch, 'proj-1', 'task-1', { force: true })
    expect(reviews.get).toHaveBeenLastCalledWith('proj-1', 'task-1', true)
    expect(JSON.stringify(failed)).not.toContain('SECRET')
    expect(errors.mock.calls.flat().join(' ')).not.toContain('SECRET')
    errors.mockRestore()
    ipc.trusted = false
    await expect(ipc.invoke(ch, 'proj-1', 'task-1')).rejects.toThrow('não autorizada')
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

describe('registerBoardIpc', () => {
  const TASK = '11111111-1111-4111-8111-000000000001'
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
    registerBoardIpc(ipc, service, guard)
    const ch = IPC_CHANNELS.board
    const invalid = { ok: false, error: { code: 'invalid' } }

    expect(await ipc.invoke(ch.move, 'p1', 'não-é-id', 'stage-1')).toMatchObject(invalid)
    expect(await ipc.invoke(ch.move, 'p1', TASK, '../x')).toMatchObject(invalid)
    await ipc.invoke(ch.move, 'p1', TASK, 'stage-1')
    expect(service.move).toHaveBeenCalledWith('p1', TASK, 'stage-1')

    expect(await ipc.invoke(ch.setBlocked, 'p1', TASK, 'sim')).toMatchObject(invalid)
    const input = {
      stages: [{ id: null, name: 'Prioridades', notionStatusId: 'o1' }],
      orkioStage: { mode: 'existing', propertyId: 'sel' },
      addMissingOptions: false,
      blockedPropertyId: null
    }
    await ipc.invoke(ch.save, 'p1', input)
    expect(service.save).toHaveBeenCalledWith('p1', input)
    expect(
      await ipc.invoke(ch.save, 'p1', { ...input, orkioStage: { mode: 'hack' } })
    ).toMatchObject(invalid)
    expect(await ipc.invoke(ch.save, 'p1', { ...input, stages: [] })).toMatchObject(invalid)
    expect(service.save).toHaveBeenCalledTimes(1)

    await ipc.invoke(ch.setAutomationPaused, 'p1', TASK, true)
    expect(service.setAutomationPaused).toHaveBeenCalledWith('p1', TASK, true)
    expect(await ipc.invoke(ch.setAutomationPaused, 'p1', TASK, 'sim')).toMatchObject(invalid)

    ipc.trusted = false
    await expect(ipc.invoke(ch.get, 'p1')).rejects.toThrow('não autorizada')
  })
})

describe('registerAutomationIpc', () => {
  it('valida id e booleano; erro vira estado genérico', async () => {
    const ipc = fakeIpc()
    const status = {
      paused: false,
      github: 'ok' as const,
      lastRunAt: null,
      nextRunAt: null,
      error: null
    }
    const service = {
      status: vi.fn(() => status),
      runNow: vi.fn(async () => status),
      setPaused: vi.fn(async () => {
        throw new Error('gho_SECRET')
      })
    }
    registerAutomationIpc(ipc, service, guard)
    const ch = IPC_CHANNELS.automation
    await ipc.invoke(ch.runNow, 'p1')
    expect(service.runNow).toHaveBeenCalledWith('p1')
    await ipc.invoke(ch.runNow, '../x')
    expect(service.runNow).toHaveBeenCalledTimes(1)
    await ipc.invoke(ch.setPaused, 'sim')
    expect(service.setPaused).not.toHaveBeenCalled()
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = await ipc.invoke(ch.setPaused, true)
    expect(JSON.stringify(result)).not.toContain('SECRET')
    errors.mockRestore()
  })
})

describe('registerFlowIpc / isFlowDraft', () => {
  it('aceita só a forma do rascunho; descarta campos estranhos nas regras', async () => {
    const draft = {
      stages: [{ id: 'stage-1', name: 'A', notionStatusId: 'o1' }],
      rules: [
        {
          id: 'r1',
          name: 'r',
          enabled: true,
          trigger: 'pr.merged',
          action: { type: 'move_to_stage', stageId: 'stage-1' },
          exec: 'rm -rf /'
        }
      ],
      removals: { 'stage-2': 'stage-1' }
    }
    expect(isFlowDraft(draft)).toBe(true)
    expect(JSON.stringify(draft.rules)).not.toContain('exec')
    expect(
      isFlowDraft({ ...draft, stages: [{ id: '../x', name: 'A', notionStatusId: null }] })
    ).toBe(false)
    expect(isFlowDraft({ ...draft, rules: [{ id: 'x', trigger: 'pr.hack' }] })).toBe(false)
    expect(isFlowDraft({ ...draft, removals: { 'stage-2': '../y' } })).toBe(false)

    const ipc = fakeIpc()
    const service = {
      saveFlow: vi.fn(async () => ({ ok: true as const, value: null as never })),
      configEvents: vi.fn(async () => [])
    }
    const files = { save: vi.fn(async () => null), open: vi.fn(async () => '{oops') }
    registerFlowIpc(ipc, service, files, guard)
    expect(await ipc.invoke(IPC_CHANNELS.flow.save, 'p1', { stages: 'x' })).toMatchObject({
      ok: false,
      error: { code: 'invalid' }
    })
    expect(await ipc.invoke(IPC_CHANNELS.flow.exportFile, { a: 1 })).toEqual({
      ok: false,
      cancelled: true
    })
    expect(await ipc.invoke(IPC_CHANNELS.flow.importFile)).toMatchObject({
      ok: false,
      cancelled: false
    })
  })
})

describe('registerAgentsIpc', () => {
  const ANA = defaultAgent({ id: 'ana', name: 'Ana', instructions: 'Testes sempre.' })
  const state = { projectId: 'p1', agents: [], rules: [] }

  function setup(): { ipc: FakeIpc; service: Record<string, ReturnType<typeof vi.fn>> } {
    const ipc = fakeIpc()
    const service = {
      list: vi.fn(async () => state),
      save: vi.fn(async () => ({})),
      approve: vi.fn(async () => ({})),
      assign: vi.fn(async () => undefined),
      setRules: vi.fn(async () => state),
      badges: vi.fn(async () => ({}))
    }
    registerAgentsIpc(ipc, service as unknown as AgentsService, guard)
    return { ipc, service }
  }

  it('recusa origem não confiável', async () => {
    const { ipc, service } = setup()
    ipc.trusted = false
    await expect(ipc.invoke(IPC_CHANNELS.agents.list, 'p1')).rejects.toThrow(/não autorizada/)
    expect(service['list']).not.toHaveBeenCalled()
  })

  it('valida o payload antes de chegar ao serviço', async () => {
    const { ipc, service } = setup()
    const save = (input: unknown): Promise<unknown> => ipc.invoke(IPC_CHANNELS.agents.save, input)
    expect(
      await save({ projectId: 'p1', scope: 'nuvem', profile: ANA, isNew: true })
    ).toMatchObject({
      ok: false
    })
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
    ).toMatchObject({
      ok: false
    })
    expect(service['save']).not.toHaveBeenCalled()
    expect(await save({ projectId: 'p1', scope: 'repo', profile: ANA, isNew: true })).toEqual({
      ok: true,
      value: state
    })
    expect(await ipc.invoke(IPC_CHANNELS.agents.assign, 'p1', 't1', 'nuvem:ana')).toMatchObject({
      ok: false,
      error: { code: 'invalid' }
    })
    expect(await ipc.invoke(IPC_CHANNELS.agents.approve, 'p1', 'repo:ana', 'curto')).toMatchObject({
      ok: false
    })
    expect(
      await ipc.invoke(IPC_CHANNELS.agents.setRules, 'p1', [{ stageId: 's1', agentKey: 'x' }])
    ).toMatchObject({ ok: false })
  })

  it('erros esperados do serviço viram mensagem; inesperados, mensagem genérica', async () => {
    const { ipc, service } = setup()
    service['assign']!.mockRejectedValueOnce(new AgentError('busy', 'Tem fluxo.'))
    expect(await ipc.invoke(IPC_CHANNELS.agents.assign, 'p1', 't1', 'repo:ana')).toEqual({
      ok: false,
      error: { code: 'busy', message: 'Tem fluxo.' }
    })
    service['assign']!.mockRejectedValueOnce(new Error('segredo ghp_xxxxxxxxxxxxxxxxxxxxxxxx'))
    const r = await ipc.invoke(IPC_CHANNELS.agents.assign, 'p1', 't1', null)
    expect(JSON.stringify(r)).not.toContain('ghp_')
  })

  it('payload com modelo/raciocínio inválido não vira agente válido; nome longo vale', () => {
    const bad = toProfile({ ...ANA, model: '--x' })
    expect(bad && validateAgent(bad)).toContain('Modelo inválido')
    const ultra = toProfile({ ...ANA, effort: 'ultra' })
    expect(ultra && validateAgent(ultra)).toContain('Raciocínio inválido')
    const long = toProfile({ ...ANA, model: 'claude-sonnet-4-5-20250929', effort: 'high' })
    expect(long).not.toBeNull()
    expect(long && validateAgent(long)).toEqual([])
  })

  it('toProfile só aceita a forma certa', () => {
    expect(toProfile(ANA)).toEqual(ANA)
    expect(toProfile({ ...ANA, commands: 'tudo' })).toBeNull()
    expect(toProfile({ ...ANA, limits: null })).toBeNull()
    expect(toProfile([])).toBeNull()
    expect(toProfile({ ...ANA, effort: 7 })).toBeNull()
  })
})

describe('updates IPC (6C)', () => {
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
      check: vi.fn(async () => status),
      setChannel: vi.fn(async () => status),
      install: vi.fn(async () => ({ state: 'installing' as const })),
      openDownload: vi.fn(async () => true),
      whatsNew: vi.fn(() => null),
      markWhatsNewSeen: vi.fn(async () => undefined),
      releaseNotes: vi.fn(() => null)
    }
  }

  it('valida canal e modo de instalação; recusa origem não confiável', async () => {
    const ipc = fakeIpc()
    const s = service()
    registerUpdatesIpc(ipc, s, () => ({ version: '1.0.0', links: null }), guard)
    const ch = IPC_CHANNELS.updates
    await ipc.invoke(ch.setChannel, 'nightly')
    expect(s.setChannel).not.toHaveBeenCalled()
    await ipc.invoke(ch.setChannel, 'beta')
    expect(s.setChannel).toHaveBeenCalledWith('beta')
    expect(await ipc.invoke(ch.install, 'rm -rf')).toMatchObject({ state: 'unavailable' })
    expect(s.install).not.toHaveBeenCalled()
    expect(await ipc.invoke(ch.install, 'when_idle')).toEqual({ state: 'installing' })
    ipc.trusted = false
    await expect(ipc.invoke(ch.install, 'now')).rejects.toThrow('Origem de IPC não autorizada')
    expect(s.install).toHaveBeenCalledTimes(1)
  })
})
