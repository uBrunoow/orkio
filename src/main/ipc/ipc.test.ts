import type { IpcMainInvokeEvent } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS, type ConnectionStatus } from '../../shared/ipc-contract'
import type { DeviceFlowConnector, OAuthConnector } from '../connectors/types'
import { registerGitHubIpc } from './github.ipc'
import { registerNotionIpc } from './notion.ipc'
import { isAllowedExternalUrl, registerShellIpc } from './shell.ipc'
import { createSenderGuard, isTrustedRendererUrl } from './trusted-sender'

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

describe('shell.openExternal', () => {
  it('allowlist: só https nos domínios do Notion', () => {
    expect(isAllowedExternalUrl('https://developers.notion.com/guides/x')).toBe(true)
    expect(isAllowedExternalUrl('https://www.notion.so/profile/integrations')).toBe(true)
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
