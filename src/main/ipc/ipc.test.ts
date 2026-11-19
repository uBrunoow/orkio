import type { IpcMainInvokeEvent } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS, type ConnectionStatus } from '../../shared/ipc-contract'
import type { Connector } from '../connectors/types'
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
    invoke: (channel, ...args) => {
      const handler = handlers.get(channel)
      if (!handler) throw new Error(`sem handler para ${channel}`)
      const url = state.trusted ? 'file:///app/out/renderer/index.html' : 'https://evil.example/'
      return handler({ senderFrame: { url } } as unknown as IpcMainInvokeEvent, ...args)
    }
  }
  return state
}

const guard = createSenderGuard({ rendererFileUrl: 'file:///app/out/renderer/index.html' })

function fakeConnector(overrides: Partial<Connector> = {}): Connector {
  return {
    id: 'notion',
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
