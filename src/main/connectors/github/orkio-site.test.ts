import { describe, expect, it } from 'vitest'
import { parseInstallationResponse, ORKIO_BOT_MESSAGES } from './orkio-bot'
import { parseOrkioSiteResponse } from './orkio-site'
import { parseSiteResponse, ReviewPostError } from './review-poster'

const INSTALL = 'https://github.com/apps/orkio/installations/new'

function reviewCode(status: number, body: unknown): string {
  try {
    parseSiteResponse({ status, body }, 'acme', 'orkio', 7)
    return 'ok'
  } catch (error) {
    return error instanceof ReviewPostError ? error.code : 'outro'
  }
}

describe('parseOrkioSiteResponse (contrato único do site)', () => {
  it('decide pelo código do corpo; o status só sem código', () => {
    expect(parseOrkioSiteResponse({ status: 503, body: { error: 'not_configured' } })).toEqual({
      kind: 'app_not_configured'
    })
    expect(
      parseOrkioSiteResponse({ status: 412, body: { error: 'not_installed', installUrl: INSTALL } })
    ).toEqual({
      kind: 'not_installed',
      installUrl: INSTALL
    })
    expect(
      parseOrkioSiteResponse({ status: 400, body: { error: 'bad_request', reason: 'x' } })
    ).toEqual({
      kind: 'bad_request',
      reason: null
    })
    expect(parseOrkioSiteResponse({ status: 404, body: null }).kind).toBe('site_outdated')
    expect(parseOrkioSiteResponse({ status: 405, body: 'html' }).kind).toBe('site_outdated')
    expect(parseOrkioSiteResponse({ status: 429, body: null }).kind).toBe('rate_limited')
    expect(parseOrkioSiteResponse({ status: 503, body: null }).kind).toBe('upstream')
  })

  it('site antigo sem a rota: revisão e cartão do bot dizem o mesmo (antes: "não configurado" × "desatualizado")', () => {
    expect(reviewCode(404, null)).toBe('site_outdated')
    expect(parseInstallationResponse({ status: 404, body: null })).toEqual({
      state: 'unknown',
      message: ORKIO_BOT_MESSAGES.siteOutdated
    })
  })

  it('App não configurado no site: os dois leem pelo código', () => {
    expect(reviewCode(503, { error: 'not_configured' })).toBe('app_not_configured')
    expect(parseInstallationResponse({ status: 503, body: { error: 'not_configured' } })).toEqual({
      state: 'unknown',
      message: ORKIO_BOT_MESSAGES.notConfigured
    })
  })
})
