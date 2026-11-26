import { describe, expect, it, vi } from 'vitest'
import {
  ORKIO_BOT_MESSAGES,
  OrkioBotService,
  parseInstallationResponse,
  reposOf,
  stateFromError
} from './orkio-bot'
import type { ProjectView } from '../../../shared/projects'
import { ApiError } from '../../net/http'

const INSTALL = 'https://github.com/apps/orkio/installations/new'

function project(name: string, owner: string, repo: string, host = 'github.com'): ProjectView {
  return {
    id: name,
    name,
    localPath: `/tmp/${name}`,
    repo: {
      host,
      owner,
      name: repo,
      remoteName: 'origin',
      defaultBranch: 'main',
      visibility: 'private',
      canPush: true,
      archived: false,
      verified: true
    },
    createdAt: '',
    updatedAt: '',
    local: null,
    health: { state: 'ok' },
    notices: [],
    notionProject: null,
    archived: false
  }
}

describe('parseInstallationResponse', () => {
  it('instalado, não instalado (link só da allowlist), sem acesso e erros do site', () => {
    expect(parseInstallationResponse({ status: 200, body: { installed: true } })).toEqual({
      state: 'installed'
    })
    expect(
      parseInstallationResponse({ status: 200, body: { installed: false, installUrl: INSTALL } })
    ).toEqual({ state: 'not_installed', installUrl: INSTALL })
    expect(
      parseInstallationResponse({
        status: 200,
        body: { installed: false, installUrl: 'https://evil.example/apps/x/installations/new' }
      })
    ).toEqual({ state: 'not_installed', installUrl: null })
    expect(parseInstallationResponse({ status: 403, body: { error: 'forbidden' } })).toEqual({
      state: 'no_access'
    })
    expect(parseInstallationResponse({ status: 503, body: { error: 'not_configured' } })).toEqual({
      state: 'unknown',
      message: ORKIO_BOT_MESSAGES.notConfigured
    })
    expect(parseInstallationResponse({ status: 404, body: null })).toEqual({
      state: 'unknown',
      message: ORKIO_BOT_MESSAGES.siteOutdated
    })
    // Decide pelo código do corpo: 503 sem código não é "App não configurado".
    expect(parseInstallationResponse({ status: 503, body: null }).state).toBe('unknown')
    expect(parseInstallationResponse({ status: 502, body: null })).toEqual({
      state: 'unknown',
      message: ORKIO_BOT_MESSAGES.unexpected
    })
    expect(parseInstallationResponse({ status: 200, body: { installed: 'sim' } }).state).toBe(
      'unknown'
    )
  })

  it('erros do conector viram mensagem em pt-BR, nunca a exceção crua', () => {
    expect(stateFromError(new ApiError('site', 'no_site', 'x'))).toEqual({
      state: 'unknown',
      message: ORKIO_BOT_MESSAGES.noSite
    })
    expect(stateFromError(new Error('segredo no stack'))).toEqual({
      state: 'unknown',
      message: ORKIO_BOT_MESSAGES.unexpected
    })
  })
})

describe('reposOf', () => {
  it('junta projetos do mesmo repositório (sem caixa) e ignora Enterprise e sem repo', () => {
    const noRepo = { ...project('c', 'x', 'y'), repo: null }
    expect(
      reposOf([
        project('a', 'Acme', 'orkio'),
        project('b', 'acme', 'Orkio'),
        project('e', 'acme', 'orkio', 'ghe.acme.com'),
        noRepo
      ])
    ).toEqual([{ owner: 'Acme', repo: 'orkio', projects: ['a', 'b'] }])
  })
  it('projeto só com git local publica pelo gh: o bot não é usado (nem consultado)', () => {
    const gitOnly = project('g', 'acme', 'painel')
    expect(reposOf([{ ...gitOnly, repo: { ...gitOnly.repo!, access: 'git' } }])).toEqual([])
  })
})

describe('OrkioBotService', () => {
  it('sem GitHub conectado não consulta o site', async () => {
    const installation = vi.fn()
    const svc = new OrkioBotService({
      isConnected: async () => false,
      listProjects: async () => [project('a', 'acme', 'orkio')],
      installation
    })
    expect(await svc.status()).toEqual({ github: 'disconnected', repos: [], checkedAt: null })
    expect(installation).not.toHaveBeenCalled()
  })

  it('consulta cada repositório uma vez, guarda 60 s e `force` consulta de novo', async () => {
    let now = 1_000_000
    const installation = vi.fn(async (_o: string, repo: string) =>
      repo === 'orkio'
        ? { status: 200, body: { installed: true } }
        : Promise.reject(new ApiError('github', 'network', 'Sem internet.'))
    )
    const svc = new OrkioBotService({
      isConnected: async () => true,
      listProjects: async () => [project('a', 'acme', 'orkio'), project('b', 'acme', 'site')],
      installation,
      now: () => now
    })
    const first = await svc.status()
    expect(first.repos.map((r) => r.status)).toEqual([
      { state: 'installed' },
      { state: 'unknown', message: 'Sem internet.' }
    ])
    expect(installation).toHaveBeenCalledTimes(2)
    now += 30_000
    await svc.status()
    expect(installation).toHaveBeenCalledTimes(2)
    await svc.status(true)
    expect(installation).toHaveBeenCalledTimes(4)
  })
})
