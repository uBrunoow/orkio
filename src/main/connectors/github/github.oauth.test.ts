import { describe, expect, it, vi } from 'vitest'
import {
  createGitHubDeviceApi,
  isGitHubDevicePage,
  parseTokenPollResponse,
  readGitHubOAuthConfig
} from './github.oauth'

const ACCESS = 'gho_DEVICE_TOKEN_SHOULD_NEVER_LEAK'
const CONFIG = { clientId: 'Iv1.0123456789abcdef' }

const DEVICE_CODE_RESPONSE = {
  device_code: '3584d83530557fdd1f46af8289938c8ef79f9dc5',
  user_code: 'WDJB-MJHT',
  verification_uri: 'https://github.com/login/device',
  expires_in: 900,
  interval: 5
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

describe('readGitHubOAuthConfig', () => {
  it('lê o client ID público', () => {
    expect(readGitHubOAuthConfig({ MAIN_VITE_GITHUB_CLIENT_ID: ' Iv1.abc123 ' })).toEqual({
      clientId: 'Iv1.abc123'
    })
  })

  it('sem client ID ou com valor estranho → null', () => {
    expect(readGitHubOAuthConfig({})).toBeNull()
    expect(readGitHubOAuthConfig({ MAIN_VITE_GITHUB_CLIENT_ID: 'tem espaço' })).toBeNull()
  })
})

describe('createGitHubDeviceApi', () => {
  it('requestCode: POST /login/device/code com client_id e scope repo, sem secret', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => json(DEVICE_CODE_RESPONSE))
    const auth = await createGitHubDeviceApi(CONFIG, { fetch: fetchMock }).requestCode()

    expect(auth).toEqual({
      deviceCode: DEVICE_CODE_RESPONSE.device_code,
      userCode: 'WDJB-MJHT',
      verificationUri: 'https://github.com/login/device',
      expiresInSec: 900,
      intervalSec: 5
    })
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://github.com/login/device/code')
    expect((init?.headers as Record<string, string>)['Accept']).toBe('application/json')
    expect(JSON.parse(String(init?.body))).toEqual({ client_id: CONFIG.clientId, scope: 'repo' })
    expect(JSON.stringify(init)).not.toMatch(/secret/i)
  })

  it('requestCode com Device Flow desligado → oauth_config', async () => {
    const api = createGitHubDeviceApi(CONFIG, {
      fetch: async () => json({ error: 'device_flow_disabled' })
    })
    await expect(api.requestCode()).rejects.toMatchObject({ code: 'oauth_config' })
  })

  it('requestCode com client ID inválido (404) → oauth_config', async () => {
    const api = createGitHubDeviceApi(CONFIG, { fetch: async () => json({}, 404) })
    await expect(api.requestCode()).rejects.toMatchObject({ code: 'oauth_config' })
  })

  it('requestCode recusa verification_uri fora de github.com/login/device', async () => {
    const api = createGitHubDeviceApi(CONFIG, {
      fetch: async () =>
        json({ ...DEVICE_CODE_RESPONSE, verification_uri: 'https://evil.example/login/device' })
    })
    await expect(api.requestCode()).rejects.toMatchObject({ code: 'unexpected' })
  })

  it('pollToken: POST /login/oauth/access_token com grant_type device_code', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      json({ access_token: ACCESS, token_type: 'bearer', scope: 'repo' })
    )
    const result = await createGitHubDeviceApi(CONFIG, { fetch: fetchMock }).pollToken('dev-1')

    expect(result).toEqual({ kind: 'token', value: { accessToken: ACCESS, scopes: ['repo'] } })
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://github.com/login/oauth/access_token')
    expect(JSON.parse(String(init?.body))).toEqual({
      client_id: CONFIG.clientId,
      device_code: 'dev-1',
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code' // RFC 8628
    })
  })

  it('pollToken: 5xx e rede viram erros transitórios', async () => {
    await expect(
      createGitHubDeviceApi(CONFIG, {
        fetch: async () => new Response('', { status: 502 })
      }).pollToken('d')
    ).rejects.toMatchObject({ code: 'server' })
    await expect(
      createGitHubDeviceApi(CONFIG, {
        fetch: async () => {
          throw new TypeError('fetch failed')
        }
      }).pollToken('d')
    ).rejects.toMatchObject({ code: 'network' })
  })
})

describe('parseTokenPollResponse', () => {
  it.each([
    [{ error: 'authorization_pending' }, { kind: 'pending' }],
    [
      { error: 'slow_down', interval: 10 },
      { kind: 'slow_down', intervalSec: 10 }
    ],
    [{ error: 'slow_down' }, { kind: 'slow_down' }],
    [{ error: 'expired_token' }, { kind: 'expired' }],
    [{ error: 'token_expired' }, { kind: 'expired' }],
    [{ error: 'incorrect_device_code' }, { kind: 'expired' }],
    [{ error: 'bad_verification_code' }, { kind: 'expired' }],
    [{ error: 'access_denied' }, { kind: 'denied' }]
  ])('%j → %j', (body, expected) => {
    expect(parseTokenPollResponse(body)).toEqual(expected)
  })

  it.each(['device_flow_disabled', 'incorrect_client_credentials', 'unsupported_grant_type'])(
    '%s → oauth_config',
    (error) => {
      expect(() => parseTokenPollResponse({ error })).toThrow(
        expect.objectContaining({ code: 'oauth_config' })
      )
    }
  )

  it('erro desconhecido → invalid (para o polling), sem detalhes do GitHub na mensagem', () => {
    expect(() =>
      parseTokenPollResponse({ error: 'weird', error_description: 'segredo interno' })
    ).toThrow(
      expect.objectContaining({
        code: 'invalid',
        message: expect.not.stringContaining('segredo')
      })
    )
  })
})

describe('isGitHubDevicePage', () => {
  it('só a página oficial', () => {
    expect(isGitHubDevicePage('https://github.com/login/device')).toBe(true)
    expect(isGitHubDevicePage('https://github.com/login/device/select_account')).toBe(true)
    expect(isGitHubDevicePage('http://github.com/login/device')).toBe(false)
    expect(isGitHubDevicePage('https://github.com.evil.com/login/device')).toBe(false)
    expect(isGitHubDevicePage('https://github.com/settings')).toBe(false)
  })
})
