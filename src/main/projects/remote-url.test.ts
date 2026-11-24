import { describe, expect, it } from 'vitest'
import { apiHostFor, parseRemoteUrl, sameRepo } from './remote-url'

const gh = (owner: string, name: string, host = 'github.com') => ({
  host,
  owner,
  name,
  kind: 'github' as const
})

describe('parseRemoteUrl — github.com', () => {
  it.each([
    ['https://github.com/uBrunoow/orkio', gh('uBrunoow', 'orkio')],
    ['https://github.com/uBrunoow/orkio.git', gh('uBrunoow', 'orkio')],
    ['https://github.com/uBrunoow/orkio/', gh('uBrunoow', 'orkio')],
    ['https://github.com/uBrunoow/orkio.git/', gh('uBrunoow', 'orkio')],
    ['https://GitHub.com/Org-Name/repo.name_1', gh('Org-Name', 'repo.name_1')],
    ['https://www.github.com/o/r', gh('o', 'r', 'www.github.com')],
    ['https://user:token@github.com/o/r.git', gh('o', 'r')],
    ['http://github.com/o/r', gh('o', 'r')],
    ['git@github.com:uBrunoow/orkio.git', gh('uBrunoow', 'orkio')],
    ['git@github.com:uBrunoow/orkio', gh('uBrunoow', 'orkio')],
    ['github.com:o/r.git', gh('o', 'r')],
    ['ssh://git@github.com/uBrunoow/orkio.git', gh('uBrunoow', 'orkio')],
    ['ssh://git@github.com:22/o/r', gh('o', 'r')],
    ['ssh://git@ssh.github.com:443/o/r.git', gh('o', 'r', 'ssh.github.com')],
    ['  https://github.com/o/r.git\n', gh('o', 'r')]
  ])('%s', (url, expected) => {
    expect(parseRemoteUrl(url)).toEqual(expected)
  })
})

describe('parseRemoteUrl — hosts que pedem confirmação', () => {
  it('alias do ~/.ssh/config (host sem ponto)', () => {
    expect(parseRemoteUrl('git@github-trabalho:acme/api.git')).toEqual({
      host: 'github-trabalho',
      owner: 'acme',
      name: 'api',
      kind: 'ssh-alias'
    })
    expect(parseRemoteUrl('ssh://git@gh-work/acme/api.git')).toMatchObject({ kind: 'ssh-alias' })
  })

  it('GitHub Enterprise (outro domínio)', () => {
    expect(parseRemoteUrl('https://github.acme.com/team/app.git')).toEqual({
      host: 'github.acme.com',
      owner: 'team',
      name: 'app',
      kind: 'enterprise'
    })
    expect(parseRemoteUrl('git@git.empresa.com.br:team/app.git')).toMatchObject({
      host: 'git.empresa.com.br',
      kind: 'enterprise'
    })
  })

  it('owner de conta gerenciada (`_`) e repositório com ponto no início', () => {
    expect(parseRemoteUrl('https://github.com/octocat_acme/.github.git')).toMatchObject({
      owner: 'octocat_acme',
      name: '.github',
      kind: 'github'
    })
  })

  it('apiHostFor: alias → github.com; enterprise → o próprio host', () => {
    expect(apiHostFor(parseRemoteUrl('git@github-trabalho:a/b')!)).toBe('github.com')
    expect(apiHostFor(parseRemoteUrl('https://github.acme.com/a/b')!)).toBe('github.acme.com')
    expect(apiHostFor(parseRemoteUrl('https://github.com/a/b')!)).toBe('github.com')
  })
})

describe('parseRemoteUrl — inválidos', () => {
  it.each([
    '',
    '   ',
    '/home/user/repos/orkio',
    '../outro-repo',
    'C:\\repos\\orkio',
    'C:/repos/orkio',
    'file:///home/user/orkio.git',
    'git://github.com/o/r.git',
    'https://github.com/o',
    'https://github.com/o/r/tree/main',
    'https://github.com/',
    'https://github.com/o/r?x=1',
    'https://github.com/o/r#frag',
    'git@github.com:o',
    'git@github.com:o/r/extra.git',
    'https://github.com/-o/r',
    'https://github.com/o/..',
    'https://github.com/o r/x',
    'https://exa mple.com/o/r',
    'ftp://github.com/o/r'
  ])('%j → null', (url) => {
    expect(parseRemoteUrl(url)).toBeNull()
  })
})

describe('sameRepo', () => {
  it('ignora maiúsculas', () => {
    expect(
      sameRepo({ owner: 'uBrunoow', name: 'Orkio' }, { owner: 'ubrunoow', name: 'orkio' })
    ).toBe(true)
    expect(sameRepo({ owner: 'a', name: 'b' }, { owner: 'a', name: 'c' })).toBe(false)
  })
})
