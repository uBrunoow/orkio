import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LoopbackAuthError } from '../../oauth/loopback'
import { SecureStore, type SafeStorageLike } from '../../storage/secure-store'
import { NotionApiError, type NotionClient, type NotionSelf } from './notion.client'
import { NOTION_MESSAGES, NotionConnector, type NotionOAuthDeps } from './notion.connector'
import type { NotionOAuthBroker, NotionTokenSet } from './notion.oauth'

const NOW = new Date('2026-11-19T12:00:00.000Z')
const REDIRECT = 'http://127.0.0.1:47821/oauth/notion/callback'

function tokens(n: number): NotionTokenSet {
  return {
    accessToken: `ntn_ACCESS_${n}_SHOULD_NEVER_LEAK`,
    refreshToken: `nrt_REFRESH_${n}_SHOULD_NEVER_LEAK`,
    botId: 'bot-1',
    workspaceId: 'ws-1',
    workspaceName: 'Acme',
    workspaceIconUrl: null,
    ownerName: 'Ada Lovelace',
    ownerAvatarUrl: 'https://x/ada.png'
  }
}

const BOT_SELF: NotionSelf = {
  id: 'bot-1',
  type: 'bot',
  name: 'Orkio',
  avatarUrl: null,
  ownerName: 'Ada Lovelace',
  ownerAvatarUrl: 'https://x/ada.png',
  workspaceName: 'Acme'
}

function safeStorage(available = true): SafeStorageLike {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (s) => Buffer.from(Buffer.from(s, 'utf8').map((b) => b ^ 0x5a)),
    decryptString: (b) => Buffer.from(b.map((x) => x ^ 0x5a)).toString('utf8')
  }
}

/** Nenhum token (de nenhuma geração) pode aparecer no que sai do conector. */
function expectNoTokens(value: unknown): void {
  expect(JSON.stringify(value)).not.toMatch(/ntn_ACCESS|nrt_REFRESH/)
}

describe('NotionConnector — OAuth', () => {
  let dir: string
  let store: SecureStore
  let client: { getSelf: ReturnType<typeof vi.fn<NotionClient['getSelf']>> }
  let broker: {
    exchangeCode: ReturnType<typeof vi.fn<NotionOAuthBroker['exchangeCode']>>
    refresh: ReturnType<typeof vi.fn<NotionOAuthBroker['refresh']>>
  }
  let authorize: ReturnType<typeof vi.fn<NotionOAuthDeps['authorize']>>

  function makeConnector(
    overrides: { oauth?: NotionOAuthDeps | null; store?: SecureStore } = {}
  ): NotionConnector {
    const oauth =
      'oauth' in overrides ? overrides.oauth : { authorize, broker, redirectUri: REDIRECT }
    return new NotionConnector({
      store: overrides.store ?? store,
      client,
      oauth: oauth ?? null,
      now: () => NOW
    })
  }

  async function connectViaOAuth(): Promise<void> {
    authorize.mockResolvedValueOnce({ code: 'code-1' })
    broker.exchangeCode.mockResolvedValueOnce(tokens(1))
    client.getSelf.mockResolvedValueOnce(BOT_SELF)
    expect(await makeConnector().startOAuth()).toMatchObject({ state: 'connected' })
  }

  async function storedRecord(): Promise<Record<string, unknown>> {
    return JSON.parse((await store.get('notion'))!) as Record<string, unknown>
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'orkio-notion-oauth-'))
    store = new SecureStore(dir, safeStorage())
    client = { getSelf: vi.fn<NotionClient['getSelf']>() }
    broker = {
      exchangeCode: vi.fn<NotionOAuthBroker['exchangeCode']>(),
      refresh: vi.fn<NotionOAuthBroker['refresh']>()
    }
    authorize = vi.fn<NotionOAuthDeps['authorize']>()
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  describe('startOAuth', () => {
    it('autoriza, troca o code no intermediário, valida e salva criptografado', async () => {
      authorize.mockResolvedValueOnce({ code: 'code-1' })
      broker.exchangeCode.mockResolvedValueOnce(tokens(1))
      client.getSelf.mockResolvedValueOnce(BOT_SELF)

      const status = await makeConnector().startOAuth()

      expect(status).toEqual({
        state: 'connected',
        account: {
          userName: 'Ada Lovelace',
          workspaceName: 'Acme',
          avatarUrl: 'https://x/ada.png'
        },
        connectedAt: NOW.toISOString()
      })
      expectNoTokens(status)
      expect(broker.exchangeCode).toHaveBeenCalledWith('code-1', REDIRECT)
      expect(client.getSelf).toHaveBeenCalledWith(tokens(1).accessToken)
      expect(await storedRecord()).toMatchObject({
        v: 2,
        method: 'oauth',
        accessToken: tokens(1).accessToken,
        refreshToken: tokens(1).refreshToken,
        botId: 'bot-1'
      })
      // No disco o conteúdo está cifrado.
      const raw = await readFile(join(dir, 'notion.bin'), 'utf8')
      expect(raw).not.toContain('ntn_ACCESS')
    })

    it('reabrir o app (nova instância) mantém conectado sem rede', async () => {
      await connectViaOAuth()
      client.getSelf.mockReset()
      const status = await makeConnector({ store: new SecureStore(dir, safeStorage()) }).getStatus()
      expect(status).toMatchObject({ state: 'connected', account: { userName: 'Ada Lovelace' } })
      expect(client.getSelf).not.toHaveBeenCalled()
    })

    it('build sem OAuth configurado → erro claro', async () => {
      const connector = makeConnector({ oauth: null })
      expect(connector.getAuthOptions()).toEqual({ oauth: false })
      expect(await connector.startOAuth()).toEqual({
        state: 'error',
        message: NOTION_MESSAGES.oauthUnavailable
      })
    })

    it('sem armazenamento seguro → erro antes de abrir o navegador', async () => {
      const connector = makeConnector({ store: new SecureStore(dir, safeStorage(false)) })
      expect(await connector.startOAuth()).toEqual({
        state: 'error',
        message: NOTION_MESSAGES.encryptionUnavailable
      })
      expect(authorize).not.toHaveBeenCalled()
    })

    it('cancelar → volta ao status salvo, nada gravado', async () => {
      const connector = makeConnector()
      authorize.mockImplementationOnce(
        (signal) =>
          new Promise((_resolve, reject) =>
            signal.addEventListener('abort', () =>
              reject(new LoopbackAuthError('cancelled', 'Conexão cancelada.'))
            )
          )
      )
      const pending = connector.startOAuth()
      await vi.waitFor(() => expect(authorize).toHaveBeenCalled())
      connector.cancelOAuth()

      expect(await pending).toEqual({ state: 'disconnected' })
      expect(broker.exchangeCode).not.toHaveBeenCalled()
      expect(await readdir(dir)).toEqual([])
    })

    it('usuário recusa no Notion → erro e nada gravado', async () => {
      authorize.mockRejectedValueOnce(
        new LoopbackAuthError('access_denied', 'Você não autorizou o acesso. Nada foi conectado.')
      )
      expect(await makeConnector().startOAuth()).toEqual({
        state: 'error',
        message: 'Você não autorizou o acesso. Nada foi conectado.'
      })
      expect(await readdir(dir)).toEqual([])
    })

    it('tempo esgotado / porta ocupada → mensagem do fluxo', async () => {
      authorize.mockRejectedValueOnce(
        new LoopbackAuthError('port_in_use', 'A porta 47821 está sendo usada por outro programa.')
      )
      expect(await makeConnector().startOAuth()).toMatchObject({
        state: 'error',
        message: expect.stringContaining('47821')
      })
    })

    it('intermediário recusa o code → erro e nada gravado', async () => {
      authorize.mockResolvedValueOnce({ code: 'code-1' })
      broker.exchangeCode.mockRejectedValueOnce(
        new NotionApiError('invalid_grant', 'Sua autorização do Notion expirou.', 400)
      )
      expect(await makeConnector().startOAuth()).toMatchObject({
        state: 'error',
        message: 'Sua autorização do Notion expirou.'
      })
      expect(await readdir(dir)).toEqual([])
    })

    it('cancelado durante a troca do code → descarta os tokens', async () => {
      const connector = makeConnector()
      authorize.mockResolvedValueOnce({ code: 'code-1' })
      broker.exchangeCode.mockImplementationOnce(async () => {
        connector.cancelOAuth()
        return tokens(1)
      })
      expect(await connector.startOAuth()).toEqual({ state: 'disconnected' })
      expect(await readdir(dir)).toEqual([])
    })

    it('não permite dois fluxos ao mesmo tempo', async () => {
      const connector = makeConnector()
      authorize.mockImplementationOnce(() => new Promise(() => {}))
      void connector.startOAuth()
      await vi.waitFor(() => expect(authorize).toHaveBeenCalled())
      expect(await connector.startOAuth()).toEqual({
        state: 'error',
        message: NOTION_MESSAGES.oauthInProgress
      })
    })

    it('/users/me fora do ar logo após autorizar → salva mesmo assim, com aviso', async () => {
      authorize.mockResolvedValueOnce({ code: 'code-1' })
      broker.exchangeCode.mockResolvedValueOnce(tokens(1))
      client.getSelf.mockRejectedValueOnce(new NotionApiError('server', 'O Notion está instável.'))

      expect(await makeConnector().startOAuth()).toMatchObject({
        state: 'connected',
        account: { userName: 'Ada Lovelace', workspaceName: 'Acme' },
        warning: 'O Notion está instável.'
      })
      expect(await readdir(dir)).toEqual(['notion.bin'])
    })

    it('reconectar a partir de um erro e falhar mantém hasStoredCredentials', async () => {
      await connectViaOAuth()
      authorize.mockRejectedValueOnce(new LoopbackAuthError('timeout', 'O tempo acabou.'))
      expect(await makeConnector().startOAuth()).toEqual({
        state: 'error',
        message: 'O tempo acabou.',
        hasStoredCredentials: true
      })
    })
  })

  describe('testConnection com renovação de token', () => {
    beforeEach(connectViaOAuth)

    it('401 → renova no intermediário, salva o par novo e tenta de novo', async () => {
      client.getSelf
        .mockRejectedValueOnce(new NotionApiError('unauthorized', 'Token inválido', 401))
        .mockResolvedValueOnce(BOT_SELF)
      broker.refresh.mockResolvedValueOnce(tokens(2))

      const status = await makeConnector().testConnection()

      expect(status).toMatchObject({ state: 'connected', account: { userName: 'Ada Lovelace' } })
      expect(status).not.toHaveProperty('warning')
      expectNoTokens(status)
      expect(broker.refresh).toHaveBeenCalledWith(tokens(1).refreshToken)
      expect(client.getSelf).toHaveBeenLastCalledWith(tokens(2).accessToken)
      expect(await storedRecord()).toMatchObject({
        accessToken: tokens(2).accessToken,
        refreshToken: tokens(2).refreshToken
      })
    })

    it('renovações concorrentes viram uma só (refresh token é rotativo)', async () => {
      client.getSelf.mockImplementation(async (token) => {
        if (token === tokens(1).accessToken) throw new NotionApiError('unauthorized', 'x', 401)
        return BOT_SELF
      })
      broker.refresh.mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 10))
        return tokens(2)
      })
      const connector = makeConnector()

      const results = await Promise.all([connector.testConnection(), connector.testConnection()])

      expect(results.map((r) => r.state)).toEqual(['connected', 'connected'])
      expect(broker.refresh).toHaveBeenCalledTimes(1)
    })

    it('refresh com invalid_grant → erro "reconectar", arquivo mantido', async () => {
      client.getSelf.mockRejectedValueOnce(new NotionApiError('unauthorized', 'x', 401))
      broker.refresh.mockRejectedValueOnce(
        new NotionApiError('invalid_grant', 'Sua autorização expirou.', 400)
      )
      expect(await makeConnector().testConnection()).toEqual({
        state: 'error',
        message: NOTION_MESSAGES.oauthRevoked,
        hasStoredCredentials: true
      })
      expect(await readdir(dir)).toEqual(['notion.bin'])
    })

    it('refresh sem rede → continua conectado, com aviso', async () => {
      client.getSelf.mockRejectedValueOnce(new NotionApiError('unauthorized', 'x', 401))
      broker.refresh.mockRejectedValueOnce(
        new NotionApiError('network', 'Não foi possível falar com o serviço de login.')
      )
      expect(await makeConnector().testConnection()).toMatchObject({
        state: 'connected',
        warning: 'Não foi possível falar com o serviço de login.'
      })
    })

    it('intermediário mal configurado → erro com a mensagem de configuração', async () => {
      client.getSelf.mockRejectedValueOnce(new NotionApiError('unauthorized', 'x', 401))
      broker.refresh.mockRejectedValueOnce(
        new NotionApiError('oauth_config', 'O login com Notion está mal configurado.', 401)
      )
      expect(await makeConnector().testConnection()).toMatchObject({
        state: 'error',
        message: 'O login com Notion está mal configurado.',
        hasStoredCredentials: true
      })
    })

    it('sem refresh token salvo, 401 → erro "reconectar" sem chamar o intermediário', async () => {
      const record = await storedRecord()
      await store.set('notion', JSON.stringify({ ...record, refreshToken: null }))
      client.getSelf.mockRejectedValueOnce(new NotionApiError('unauthorized', 'x', 401))

      expect(await makeConnector().testConnection()).toMatchObject({
        state: 'error',
        message: NOTION_MESSAGES.oauthRevoked
      })
      expect(broker.refresh).not.toHaveBeenCalled()
    })

    it('falha transitória sem 401 → aviso, sem renovar', async () => {
      client.getSelf.mockRejectedValueOnce(new NotionApiError('server', 'Notion instável (503).'))
      expect(await makeConnector().testConnection()).toMatchObject({
        state: 'connected',
        warning: 'Notion instável (503).'
      })
      expect(broker.refresh).not.toHaveBeenCalled()
    })

    it('desconectar apaga tokens do disco', async () => {
      const connector = makeConnector()
      await connector.disconnect()
      expect(await readdir(dir)).toEqual([])
      expect(await connector.getStatus()).toEqual({ state: 'disconnected' })
    })
  })

  it('conexão salva na Etapa 1 (v1, token colado) continua funcionando', async () => {
    await store.set(
      'notion',
      JSON.stringify({
        v: 1,
        token: 'ntn_old',
        account: { userName: 'Ada' },
        connectedAt: NOW.toISOString()
      })
    )
    client.getSelf.mockResolvedValueOnce({ ...BOT_SELF, type: 'person', name: 'Ada' })

    const connector = makeConnector()
    expect(await connector.getStatus()).toMatchObject({ state: 'connected' })
    expect(await connector.testConnection()).toMatchObject({ state: 'connected' })
    expect(client.getSelf).toHaveBeenCalledWith('ntn_old')
    expect(await storedRecord()).toMatchObject({ v: 2, method: 'token', token: 'ntn_old' })
  })
})
