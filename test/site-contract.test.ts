/**
 * O site (`site/`, package próprio) revalida o que o app manda e monta o link de instalação do App
 * que o app aceita. As regras ficam escritas dos dois lados (o site não importa de `src/`); este
 * teste exige que batam.
 */
import { describe, expect, it } from 'vitest'
import {
  GITHUB_API_VERSION,
  GITHUB_NAME_SOURCES,
  isInstallUrl,
  isOwner,
  isRepo
} from '../src/shared/github-names'
/** Parte de `site/lib/github-app.ts` usada aqui. */
interface SiteGitHubApp {
  GITHUB_API_VERSION: string
  OWNER_SLUG: RegExp
  isRepoName(value: string): boolean
  installUrlFrom(env: {
    GITHUB_APP_ID: string | undefined
    GITHUB_APP_PRIVATE_KEY: string | undefined
    GITHUB_APP_SLUG?: string | undefined
  }): string | null
}

// Caminho em variável: o tsc da raiz não segue o import para dentro do package do site (que tem o
// próprio tsconfig); o Vitest importa o arquivo normalmente.
const SITE_GITHUB_APP: string = '../site/lib/github-app'
const site = (await import(SITE_GITHUB_APP)) as SiteGitHubApp

const NAMES = [
  'orkio',
  'Orkio-Dev',
  'octocat_acme',
  '_x',
  '-x',
  'x-',
  'a.b',
  '.github',
  '.',
  '..',
  'a b',
  'a/b',
  '',
  'x'.repeat(100),
  'x'.repeat(101),
  'ação'
]

describe('contrato app ↔ site', () => {
  it('mesma versão da API do GitHub', () => {
    expect(site.GITHUB_API_VERSION).toBe(GITHUB_API_VERSION)
  })

  it('mesma regra de owner', () => {
    expect(site.OWNER_SLUG.source).toBe(`^${GITHUB_NAME_SOURCES.owner}$`)
    for (const name of NAMES) expect(site.OWNER_SLUG.test(name), name).toBe(isOwner(name))
  })

  it('mesma regra de repositório', () => {
    for (const name of NAMES) expect(site.isRepoName(name), name).toBe(isRepo(name))
  })

  it('o link de instalação que o site monta é o que o app aceita', () => {
    for (const slug of [
      'orkio',
      'orkio-e2e',
      'a',
      'Orkio',
      '-x',
      'o_k',
      'x'.repeat(100),
      'x'.repeat(101)
    ]) {
      const url = site.installUrlFrom({
        GITHUB_APP_ID: undefined,
        GITHUB_APP_PRIVATE_KEY: undefined,
        GITHUB_APP_SLUG: slug
      })
      expect(url !== null, slug).toBe(
        isInstallUrl(`https://github.com/apps/${slug}/installations/new`)
      )
      if (url) expect(isInstallUrl(url), slug).toBe(true)
    }
  })
})
