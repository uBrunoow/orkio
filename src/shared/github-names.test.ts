import { describe, expect, it } from 'vitest'
import {
  findInstallUrl,
  isAuthorLogin,
  isBranchName,
  isInstallUrl,
  isLogin,
  isOwner,
  isRepo,
  isReviewer
} from './github-names'

describe('github-names', () => {
  it('owner aceita conta gerenciada (EMU, com `_`) e recusa barra, ponto e espaço', () => {
    expect(isOwner('acme')).toBe(true)
    expect(isOwner('octocat_acme')).toBe(true)
    expect(isOwner('a.b')).toBe(false)
    expect(isOwner('a/b')).toBe(false)
    expect(isOwner('a b')).toBe(false)
    expect(isOwner('x'.repeat(101))).toBe(false)
  })

  it('repositório aceita ponto no início (`.github`), nunca `.`/`..`', () => {
    expect(isRepo('.github')).toBe(true)
    expect(isRepo('orkio.app')).toBe(true)
    expect(isRepo('.')).toBe(false)
    expect(isRepo('..')).toBe(false)
    expect(isRepo('a/b')).toBe(false)
  })

  it('login e revisor: o mesmo login vale nos dois (sugestão de colaborador → pedir review)', () => {
    for (const login of ['ana', 'ana-dev', 'octocat_acme']) {
      expect(isLogin(login)).toBe(true)
      expect(isReviewer(login)).toBe(true)
    }
    expect(isLogin('-ana')).toBe(false)
    expect(isLogin('a.b')).toBe(false)
    expect(isLogin('x'.repeat(40))).toBe(false)
    expect(isReviewer('team:core-devs')).toBe(true)
    expect(isReviewer('team:')).toBe(false)
    expect(isReviewer('bad login')).toBe(false)
  })

  it('autor aceita apps (`[bot]`), login comum não', () => {
    expect(isAuthorLogin('dependabot[bot]')).toBe(true)
    expect(isLogin('dependabot[bot]')).toBe(false)
  })

  it('branch: mesmas regras para vincular e para o push (inclusive `//`)', () => {
    expect(isBranchName('feat/listar-pedidos')).toBe(true)
    for (const bad of ['', 'feat/../main', '-x', 'feat x', 'feat//x', 'feat/', 'x.lock']) {
      expect(isBranchName(bad), bad).toBe(false)
    }
    expect(isBranchName('x'.repeat(251))).toBe(false)
  })

  it('link de instalação do App: só a página de instalação, achado também dentro de um texto', () => {
    const url = 'https://github.com/apps/orkio/installations/new'
    expect(isInstallUrl(url)).toBe(true)
    expect(isInstallUrl(`${url}?x=1`)).toBe(false)
    expect(isInstallUrl('https://github.com/apps/Orkio/installations/new')).toBe(false)
    expect(findInstallUrl(`Instale o App: ${url}.`)).toBe(url)
    expect(findInstallUrl(`${url}/x`)).toBeNull()
  })
})
