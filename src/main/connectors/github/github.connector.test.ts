import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DeviceAuthorization, DevicePollResult } from '../../oauth/device-flow'
import { SecureStore, type SafeStorageLike } from '../../storage/secure-store'
import { GitHubApiError, createGitHubClient, type GitHubClient } from './github.client'
import { GITHUB_MESSAGES, GitHubConnector } from './github.connector'
import type { GitHubDeviceApi, GitHubOAuthToken } from './github.oauth'

const PAT = 'github_pat_CONNECTOR_TOKEN_SHOULD_NEVER_LEAK'
const DEVICE_TOKEN = 'gho_DEVICE_TOKEN_SHOULD_NEVER_LEAK'
const NOW = new Date('2026-11-19T12:00:00.000Z')

const USER_JSON = {
  login: 'octocat',
  id: 1,
  name: 'The Octocat',
  avatar_url: 'https://avatars.githubusercontent.com/u/1'
}

const AUTH: DeviceAuthorization = {
  deviceCode: 'dev-code',
  userCode: 'WDJB-MJHT',
  verificationUri: 'https://github.com/login/device',
  expiresInSec: 900,
  intervalSec: 5
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

function expectNoTokens(value: unknown): void {
  expect(JSON.stringify(value)).not.toMatch(/github_pat_|gho_/)
}

describe('GitHubConnector', () => {
  let dir: string
  let store: SecureStore
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>
  let client: GitHubClient
  let device: {
    requestCode: ReturnType<typeof vi.fn<GitHubDeviceApi['requestCode']>>
    pollToken: ReturnType<typeof vi.fn<GitHubDeviceApi['pollToken']>>
  }

  function makeConnector(
    overrides: { device?: GitHubDeviceApi | null; store?: SecureStore } = {}
  ): GitHubConnector {
    return new GitHubConnector({
      store: overrides.store ?? store,
      client,
      device: 'device' in overrides ? overrides.device : device,
      now: () => NOW,
      // Polling instantâneo, mas ainda acorda ao cancelar.
      sleep: async (_ms, signal) => {
        if (!signal.aborted) await new Promise((r) => setTimeout(r, 1))
      }
    })
  }

  function pollSequence(results: (DevicePollResult<GitHubOAuthToken> | Error)[]): void {
    const queue = [...results]
    device.pollToken.mockImplementation(async () => {
      const next = queue.shift() ?? { kind: 'pending' as const }
      if (next instanceof Error) throw next
      return next
    })
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'orkio-github-'))
    store = new SecureStore(dir, safeStorage())
    fetchMock = vi.fn<typeof fetch>(async () => json(USER_JSON, 200, { 'X-OAuth-Scopes': 'repo' }))
    client = createGitHubClient({ fetch: fetchMock, sleep: async () => {} })
    device = {
      requestCode: vi.fn<GitHubDeviceApi['requestCode']>(async () => AUTH),
      pollToken: vi.fn<GitHubDeviceApi['pollToken']>()
    }
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  describe('Device Flow', () => {
    it('sucesso: devolve o código, aguarda a autorização e conecta', async () => {
      pollSequence([
        { kind: 'pending' },
        { kind: 'pending' },
        { kind: 'token', value: { accessToken: DEVICE_TOKEN, scopes: ['repo'] } }
      ])
      const connector = makeConnector()

      const start = await connector.startDeviceFlow()
      expect(start).toEqual({
        ok: true,
        flow: {
          userCode: 'WDJB-MJHT',
          verificationUri: 'https://github.com/login/device',
          expiresAt: new Date(NOW.getTime() + 900_000).toISOString()
        }
      })

      const status = await connector.waitDeviceFlow()
      expect(status).toEqual({
        state: 'connected',
        account: {
          userName: 'The Octocat',
          handle: 'octocat',
          avatarUrl: USER_JSON.avatar_url
        },
        connectedAt: NOW.toISOString()
      })
      expectNoTokens([start, status])
      expect(device.pollToken).toHaveBeenCalledTimes(3)
      expect(fetchMock.mock.calls[0]![1]?.headers).toMatchObject({
        Authorization: `Bearer ${DEVICE_TOKEN}`
      })
      // Salvo cifrado.
      expect(await readdir(dir)).toEqual(['github.bin'])
      expect(await readFile(join(dir, 'github.bin'), 'utf8')).not.toContain(DEVICE_TOKEN)
      expect(JSON.parse((await store.get('github'))!)).toMatchObject({
        method: 'device',
        token: DEVICE_TOKEN,
        scopes: ['repo']
      })
    })

    it('slow_down no meio do caminho não quebra o fluxo', async () => {
      pollSequence([
        { kind: 'slow_down', intervalSec: 10 },
        { kind: 'token', value: { accessToken: DEVICE_TOKEN, scopes: ['repo'] } }
      ])
      const connector = makeConnector()
      await connector.startDeviceFlow()
      expect(await connector.waitDeviceFlow()).toMatchObject({ state: 'connected' })
    })

    it('expired_token → mensagem para gerar novo código, nada salvo', async () => {
      pollSequence([{ kind: 'pending' }, { kind: 'expired' }])
      const connector = makeConnector()
      await connector.startDeviceFlow()
      expect(await connector.waitDeviceFlow()).toEqual({
        state: 'error',
        message: GITHUB_MESSAGES.deviceExpired
      })
      expect(await readdir(dir)).toEqual([])
    })

    it('access_denied → mensagem clara, nada salvo', async () => {
      pollSequence([{ kind: 'denied' }])
      const connector = makeConnector()
      await connector.startDeviceFlow()
      expect(await connector.waitDeviceFlow()).toEqual({
        state: 'error',
        message: GITHUB_MESSAGES.deviceDenied
      })
      expect(await readdir(dir)).toEqual([])
    })

    it('cancelar → volta ao status salvo, nada salvo, polling para', async () => {
      pollSequence([])
      const connector = makeConnector()
      await connector.startDeviceFlow()
      const waiting = connector.waitDeviceFlow()
      await vi.waitFor(() => expect(device.pollToken).toHaveBeenCalled())
      connector.cancelDeviceFlow()

      expect(await waiting).toEqual({ state: 'disconnected' })
      const calls = device.pollToken.mock.calls.length
      await new Promise((r) => setTimeout(r, 20))
      expect(device.pollToken.mock.calls.length).toBe(calls)
      expect(await readdir(dir)).toEqual([])
    })

    it('chamar start de novo durante o fluxo devolve o mesmo código', async () => {
      pollSequence([])
      const connector = makeConnector()
      const first = await connector.startDeviceFlow()
      const second = await connector.startDeviceFlow()
      expect(second).toEqual(first)
      expect(device.requestCode).toHaveBeenCalledTimes(1)
      connector.cancelDeviceFlow()
      await connector.waitDeviceFlow()
    })

    it('Device Flow desligado na OAuth App → erro de configuração', async () => {
      device.requestCode.mockRejectedValueOnce(
        new GitHubApiError('oauth_config', 'O login com GitHub está mal configurado.')
      )
      expect(await makeConnector().startDeviceFlow()).toEqual({
        ok: false,
        status: { state: 'error', message: 'O login com GitHub está mal configurado.' }
      })
    })

    it('build sem client ID → indisponível', async () => {
      const connector = makeConnector({ device: null })
      expect(connector.getAuthOptions()).toEqual({ oauth: false })
      expect(await connector.startDeviceFlow()).toEqual({
        ok: false,
        status: { state: 'error', message: GITHUB_MESSAGES.oauthUnavailable }
      })
    })

    it('sem armazenamento seguro → erro antes de pedir código', async () => {
      const connector = makeConnector({ store: new SecureStore(dir, safeStorage(false)) })
      expect(await connector.startDeviceFlow()).toMatchObject({
        ok: false,
        status: { message: GITHUB_MESSAGES.encryptionUnavailable }
      })
      expect(device.requestCode).not.toHaveBeenCalled()
    })

    it('rede instável durante o polling é tolerada', async () => {
      pollSequence([
        new GitHubApiError('network', 'sem rede'),
        { kind: 'token', value: { accessToken: DEVICE_TOKEN, scopes: ['repo'] } }
      ])
      const connector = makeConnector()
      await connector.startDeviceFlow()
      expect(await connector.waitDeviceFlow()).toMatchObject({ state: 'connected' })
    })

    it('waitDeviceFlow sem fluxo devolve o status salvo', async () => {
      expect(await makeConnector().waitDeviceFlow()).toEqual({ state: 'disconnected' })
    })
  })

  describe('token colado (fine-grained PAT)', () => {
    it('válido → conectado e salvo; reabrir mantém', async () => {
      fetchMock.mockResolvedValueOnce(json(USER_JSON))
      const status = await makeConnector().connect({ kind: 'token', token: `  ${PAT}\n` })
      expect(status).toMatchObject({
        state: 'connected',
        account: { userName: 'The Octocat', handle: 'octocat' }
      })
      expectNoTokens(status)
      expect(JSON.parse((await store.get('github'))!)).toMatchObject({
        method: 'token',
        token: PAT,
        scopes: null
      })

      fetchMock.mockClear()
      const reopened = new GitHubConnector({ store: new SecureStore(dir, safeStorage()), client })
      expect(await reopened.getStatus()).toMatchObject({ state: 'connected' })
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('inválido (401) → erro e nada salvo', async () => {
      fetchMock.mockResolvedValueOnce(json({ message: 'Bad credentials' }, 401))
      const status = await makeConnector().connect({ kind: 'token', token: PAT })
      expect(status).toMatchObject({ state: 'error', message: expect.stringMatching(/inválido/) })
      expectNoTokens(status)
      expect(await readdir(dir)).toEqual([])
    })

    it('rate limit ao conectar → erro com tempo de espera, nada salvo', async () => {
      fetchMock.mockResolvedValueOnce(json({}, 429, { 'Retry-After': '120' }))
      expect(await makeConnector().connect({ kind: 'token', token: PAT })).toMatchObject({
        state: 'error',
        message: expect.stringContaining('em 2 min')
      })
      expect(await readdir(dir)).toEqual([])
    })

    it('vazio ou com espaços → erro sem chamar a API', async () => {
      const connector = makeConnector()
      expect(await connector.connect({ kind: 'token', token: ' ' })).toEqual({
        state: 'error',
        message: GITHUB_MESSAGES.emptyToken
      })
      expect(await connector.connect({ kind: 'token', token: 'ghp_a b' })).toEqual({
        state: 'error',
        message: GITHUB_MESSAGES.malformedToken
      })
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('desconectar apaga a credencial do disco', async () => {
      const connector = makeConnector()
      await connector.connect({ kind: 'token', token: PAT })
      await connector.disconnect()
      expect(await readdir(dir)).toEqual([])
      expect(await connector.getStatus()).toEqual({ state: 'disconnected' })
    })
  })

  describe('testConnection', () => {
    async function connectWith(method: 'token' | 'device'): Promise<void> {
      if (method === 'token') {
        await makeConnector().connect({ kind: 'token', token: PAT })
      } else {
        await makeConnector().connect({
          kind: 'oauth',
          tokens: { accessToken: DEVICE_TOKEN, scopes: ['repo'] }
        })
      }
      fetchMock.mockReset()
    }

    it('ok → atualiza a conta', async () => {
      await connectWith('token')
      fetchMock.mockResolvedValueOnce(json({ ...USER_JSON, name: 'Mona' }))
      expect(await makeConnector().testConnection()).toMatchObject({
        state: 'connected',
        account: { userName: 'Mona' }
      })
    })

    it('401 com token colado → erro com a mensagem do token, arquivo mantido', async () => {
      await connectWith('token')
      fetchMock.mockResolvedValueOnce(json({}, 401))
      expect(await makeConnector().testConnection()).toMatchObject({
        state: 'error',
        message: expect.stringMatching(/inválido, expirado ou revogado/),
        hasStoredCredentials: true
      })
      expect(await readdir(dir)).toEqual(['github.bin'])
    })

    it('401 com Device Flow → "autorização revogada"', async () => {
      await connectWith('device')
      fetchMock.mockResolvedValueOnce(json({}, 401))
      expect(await makeConnector().testConnection()).toEqual({
        state: 'error',
        message: GITHUB_MESSAGES.deviceRevoked,
        hasStoredCredentials: true
      })
    })

    it('rate limit primário → continua conectado com aviso', async () => {
      await connectWith('device')
      fetchMock.mockResolvedValueOnce(
        json({}, 403, {
          'x-ratelimit-remaining': '0',
          'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600)
        })
      )
      expect(await makeConnector().testConnection()).toMatchObject({
        state: 'connected',
        warning: expect.stringContaining('Limite de requisições do GitHub')
      })
    })

    it('rede, timeout e 5xx → continua conectado com aviso', async () => {
      await connectWith('device')
      fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'))
      expect(await makeConnector().testConnection()).toMatchObject({
        state: 'connected',
        warning: expect.stringMatching(/internet/)
      })
      fetchMock.mockResolvedValueOnce(new Response('', { status: 503 }))
      expect(await makeConnector().testConnection()).toMatchObject({
        state: 'connected',
        warning: expect.stringContaining('503')
      })
    })
  })

  describe('acesso a repositórios (getRepository)', () => {
    const REPO_JSON = {
      name: 'orkio',
      owner: { login: 'uBrunoow' },
      default_branch: 'main',
      visibility: 'private',
      private: true,
      archived: false,
      permissions: { admin: true, maintain: true, push: true, triage: true, pull: true }
    }

    it('sem conta conectada → not_connected, sem chamar a API', async () => {
      const connector = makeConnector()
      expect(await connector.isConnected()).toBe(false)
      await expect(connector.getRepository('a', 'b')).rejects.toMatchObject({
        code: 'not_connected'
      })
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('usa o token salvo e devolve só dados do repositório', async () => {
      const connector = makeConnector()
      await connector.connect({ kind: 'token', token: PAT })
      fetchMock.mockReset()
      fetchMock.mockResolvedValueOnce(json(REPO_JSON))

      const repo = await connector.getRepository('uBrunoow', 'orkio')
      expect(repo).toEqual({
        owner: 'uBrunoow',
        name: 'orkio',
        defaultBranch: 'main',
        visibility: 'private',
        archived: false,
        canPush: true
      })
      expectNoTokens(repo)
      const [url, init] = fetchMock.mock.calls[0]!
      expect(url).toBe('https://api.github.com/repos/uBrunoow/orkio')
      expect(init?.headers).toMatchObject({ Authorization: `Bearer ${PAT}` })
    })

    it('404 → not_found; 403 SSO → sso_required com URL; 403 restrição → oauth_restricted', async () => {
      const connector = makeConnector()
      await connector.connect({ kind: 'token', token: PAT })
      fetchMock.mockReset()

      fetchMock.mockResolvedValueOnce(json({ message: 'Not Found' }, 404))
      await expect(connector.getRepository('acme', 'secret')).rejects.toMatchObject({
        code: 'not_found'
      })

      fetchMock.mockResolvedValueOnce(
        json({ message: 'Resource protected by organization SAML enforcement.' }, 403, {
          'X-GitHub-SSO':
            'required; url=https://github.com/orgs/acme/sso?authorization_request=ABC123'
        })
      )
      const sso = await connector.getRepository('acme', 'app').catch((e: unknown) => e)
      expect(sso).toMatchObject({
        code: 'sso_required',
        details: {
          org: 'acme',
          ssoUrl: 'https://github.com/orgs/acme/sso?authorization_request=ABC123'
        }
      })

      fetchMock.mockResolvedValueOnce(
        json(
          {
            message:
              'Although you appear to have the correct authorization credentials, the `acme` organization has enabled OAuth App access restrictions, meaning that data access to third-parties is limited.'
          },
          403
        )
      )
      const restricted = await connector.getRepository('acme', 'app').catch((e: unknown) => e)
      expect(restricted).toMatchObject({
        code: 'oauth_restricted',
        message: expect.stringContaining('Um admin da organização precisa aprovar o Orkio')
      })
      expectNoTokens([sso, restricted])
    })

    it('SSO com URL fora de github.com/orgs/<org>/sso é descartada', async () => {
      const connector = makeConnector()
      await connector.connect({ kind: 'token', token: PAT })
      fetchMock.mockReset()
      fetchMock.mockResolvedValueOnce(
        json({}, 403, { 'X-GitHub-SSO': 'required; url=https://evil.example/orgs/acme/sso' })
      )
      const error = await connector.getRepository('acme', 'app').catch((e: unknown) => e)
      expect(error).toMatchObject({ code: 'sso_required', details: { org: 'acme' } })
      expect((error as GitHubApiError).details.ssoUrl).toBeUndefined()
    })

    it('accessSettingsUrl: OAuth App → página do app; PAT → página de tokens', async () => {
      const withId = new GitHubConnector({
        store,
        client,
        device,
        oauthClientId: 'Iv1.abc',
        now: () => NOW
      })
      await withId.connect({
        kind: 'oauth',
        tokens: { accessToken: DEVICE_TOKEN, scopes: ['repo'] }
      })
      expect(await withId.accessSettingsUrl()).toBe(
        'https://github.com/settings/connections/applications/Iv1.abc'
      )
      await withId.connect({ kind: 'token', token: PAT })
      expect(await withId.accessSettingsUrl()).toBe(
        'https://github.com/settings/personal-access-tokens'
      )
    })
  })
})
