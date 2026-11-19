import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SecureStore, type SafeStorageLike, type SecretStore } from '../../storage/secure-store'
import { NOTION_VERSION, createNotionClient } from './notion.client'
import { NOTION_MESSAGES, NotionConnector, toAccount } from './notion.connector'

const TOKEN = 'ntn_connector_token_SHOULD_NEVER_LEAK'
const NOW = new Date('2026-11-19T12:00:00.000Z')

const PERSON = {
  object: 'user',
  id: 'user-1',
  type: 'person',
  name: 'Ada Lovelace',
  avatar_url: 'https://s3.example.com/ada.png'
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers })
}

function safeStorage(available = true): SafeStorageLike {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (s) => Buffer.from(Buffer.from(s, 'utf8').map((b) => b ^ 0x5a)),
    decryptString: (b) => Buffer.from(b.map((x) => x ^ 0x5a)).toString('utf8')
  }
}

function expectNoToken(value: unknown): void {
  expect(JSON.stringify(value)).not.toContain(TOKEN)
}

describe('NotionConnector', () => {
  let dir: string
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>
  let store: SecretStore

  function makeConnector(s: SecretStore = store): NotionConnector {
    return new NotionConnector({
      store: s,
      client: createNotionClient({ fetch: fetchMock, sleep: async () => {} }),
      now: () => NOW
    })
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'orkio-connector-'))
    store = new SecureStore(dir, safeStorage())
    fetchMock = vi.fn<typeof fetch>()
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  describe('connect', () => {
    it('token válido → conectado, salvo criptografado no disco', async () => {
      fetchMock.mockResolvedValue(json(PERSON))
      const connector = makeConnector()

      const status = await connector.connect({ kind: 'token', token: `  ${TOKEN}\n` })

      expect(status).toEqual({
        state: 'connected',
        account: { userName: 'Ada Lovelace', avatarUrl: 'https://s3.example.com/ada.png' },
        connectedAt: NOW.toISOString()
      })
      expectNoToken(status)
      // Token enviado já sem espaços.
      expect(fetchMock.mock.calls[0]![1]?.headers).toMatchObject({
        Authorization: `Bearer ${TOKEN}`,
        'Notion-Version': NOTION_VERSION
      })
      expect(await readdir(dir)).toEqual(['notion.bin'])
      expect(await store.get('notion')).toContain(TOKEN)
    })

    it('401 → erro claro e NADA é salvo', async () => {
      fetchMock.mockResolvedValue(json({ object: 'error', code: 'unauthorized' }, 401))
      const status = await makeConnector().connect({ kind: 'token', token: TOKEN })

      expect(status).toEqual({
        state: 'error',
        message: 'Token inválido ou revogado. Gere um novo token no Notion e cole aqui.'
      })
      expect(await readdir(dir)).toEqual([])
    })

    it('429 longo → erro de rate limit e nada salvo', async () => {
      fetchMock.mockResolvedValue(json({}, 429, { 'Retry-After': '60' }))
      const status = await makeConnector().connect({ kind: 'token', token: TOKEN })
      expect(status).toMatchObject({ state: 'error', message: expect.stringContaining('em 60 s') })
      expect(await readdir(dir)).toEqual([])
    })

    it('erro de rede → erro e nada salvo', async () => {
      fetchMock.mockRejectedValue(new TypeError('fetch failed'))
      const status = await makeConnector().connect({ kind: 'token', token: TOKEN })
      expect(status).toMatchObject({ state: 'error', message: expect.stringMatching(/internet/) })
      expect(await readdir(dir)).toEqual([])
    })

    it('timeout → erro e nada salvo', async () => {
      vi.useFakeTimers()
      try {
        fetchMock.mockImplementation(
          (_u, init) =>
            new Promise((_r, reject) =>
              init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
            )
        )
        const pending = makeConnector().connect({ kind: 'token', token: TOKEN })
        await vi.advanceTimersByTimeAsync(10_000)
        expect(await pending).toMatchObject({
          state: 'error',
          message: expect.stringMatching(/demorou demais/)
        })
      } finally {
        vi.useRealTimers()
      }
      expect(await readdir(dir)).toEqual([])
    })

    it('token vazio ou com espaços internos → erro sem chamar a API', async () => {
      const connector = makeConnector()
      expect(await connector.connect({ kind: 'token', token: '   ' })).toEqual({
        state: 'error',
        message: NOTION_MESSAGES.emptyToken
      })
      expect(await connector.connect({ kind: 'token', token: 'ntn_abc def' })).toEqual({
        state: 'error',
        message: NOTION_MESSAGES.malformedToken
      })
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('criptografia indisponível → erro claro, sem chamar a API e sem gravar', async () => {
      const insecure = new SecureStore(dir, safeStorage(false))
      const status = await makeConnector(insecure).connect({ kind: 'token', token: TOKEN })

      expect(status).toEqual({ state: 'error', message: NOTION_MESSAGES.encryptionUnavailable })
      expect(fetchMock).not.toHaveBeenCalled()
      expect(await readdir(dir)).toEqual([])
    })
  })

  describe('getStatus', () => {
    it('sem token salvo → desconectado', async () => {
      expect(await makeConnector().getStatus()).toEqual({ state: 'disconnected' })
    })

    it('após conectar, uma nova instância (app reaberto) continua conectada sem rede', async () => {
      fetchMock.mockResolvedValue(json(PERSON))
      await makeConnector().connect({ kind: 'token', token: TOKEN })
      fetchMock.mockReset()

      const reopened = makeConnector(new SecureStore(dir, safeStorage()))
      const status = await reopened.getStatus()

      expect(status).toMatchObject({ state: 'connected', account: { userName: 'Ada Lovelace' } })
      expect(fetchMock).not.toHaveBeenCalled()
      expectNoToken(status)
    })

    it('arquivo salvo ilegível → erro com credencial salva', async () => {
      await store.set('notion', '{"v":99}')
      expect(await makeConnector().getStatus()).toEqual({
        state: 'error',
        message: NOTION_MESSAGES.storageReadFailed,
        hasStoredCredentials: true
      })
    })
  })

  describe('disconnect', () => {
    it('apaga o token do disco e volta a desconectado', async () => {
      fetchMock.mockResolvedValue(json(PERSON))
      const connector = makeConnector()
      await connector.connect({ kind: 'token', token: TOKEN })

      await connector.disconnect()

      expect(await readdir(dir)).toEqual([])
      expect(await connector.getStatus()).toEqual({ state: 'disconnected' })
    })
  })

  describe('testConnection', () => {
    beforeEach(async () => {
      fetchMock.mockResolvedValueOnce(json(PERSON))
      await makeConnector().connect({ kind: 'token', token: TOKEN })
    })

    it('ok → conectado e atualiza dados da conta', async () => {
      fetchMock.mockResolvedValueOnce(json({ ...PERSON, name: 'Ada King' }))
      const connector = makeConnector()

      const status = await connector.testConnection()

      expect(status).toMatchObject({ state: 'connected', account: { userName: 'Ada King' } })
      expect(status).not.toHaveProperty('warning')
      expect(await connector.getStatus()).toMatchObject({ account: { userName: 'Ada King' } })
    })

    it('401 (token revogado) → erro, mas mantém o arquivo até o usuário desconectar', async () => {
      fetchMock.mockResolvedValueOnce(json({}, 401))
      const status = await makeConnector().testConnection()

      expect(status).toMatchObject({ state: 'error', hasStoredCredentials: true })
      expect(await readdir(dir)).toEqual(['notion.bin'])
    })

    it('erro de rede → continua conectado, com aviso', async () => {
      fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'))
      const status = await makeConnector().testConnection()

      expect(status).toMatchObject({
        state: 'connected',
        connectedAt: NOW.toISOString(),
        warning: expect.stringMatching(/internet/)
      })
    })

    it('5xx → continua conectado, com aviso', async () => {
      fetchMock.mockResolvedValueOnce(new Response('', { status: 503 }))
      expect(await makeConnector().testConnection()).toMatchObject({
        state: 'connected',
        warning: expect.stringContaining('503')
      })
    })

    it('429 → continua conectado, com aviso', async () => {
      fetchMock.mockResolvedValueOnce(json({}, 429, { 'Retry-After': '120' }))
      expect(await makeConnector().testConnection()).toMatchObject({
        state: 'connected',
        warning: expect.stringContaining('limitou')
      })
    })
  })

  it('sem token salvo, testConnection → desconectado sem chamar a API', async () => {
    expect(await makeConnector().testConnection()).toEqual({ state: 'disconnected' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('toAccount', () => {
  it('bot com dono usuário usa nome/avatar do dono e o workspace', () => {
    expect(
      toAccount({
        id: 'b',
        type: 'bot',
        name: 'Integração',
        avatarUrl: null,
        ownerName: 'Grace',
        ownerAvatarUrl: 'https://x/g.png',
        workspaceName: 'Acme'
      })
    ).toEqual({ userName: 'Grace', workspaceName: 'Acme', avatarUrl: 'https://x/g.png' })
  })

  it('bot de workspace usa o nome do bot', () => {
    expect(
      toAccount({
        id: 'b',
        type: 'bot',
        name: 'Integração Orkio',
        avatarUrl: null,
        ownerName: null,
        ownerAvatarUrl: null,
        workspaceName: 'Acme'
      })
    ).toEqual({ userName: 'Integração Orkio', workspaceName: 'Acme' })
  })
})
