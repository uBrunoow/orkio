/**
 * Contrato app ↔ site. O site (`site/`, package próprio) não importa de `src/`: tudo o que os dois
 * lados repetem mora num módulo só do site (`site/lib/contract.ts`), e este teste exige que cada
 * valor bata com o do app. Também passa o que o app manda pelo validador real do site e o que o
 * site responde pelo leitor real do app.
 */
import { describe, expect, it } from 'vitest'
import { NOTION_VERSION as NOTION_CLIENT_VERSION } from '../src/main/connectors/notion/notion.client'
import { parseOrkioSiteResponse } from '../src/main/connectors/github/orkio-site'
import {
  GITHUB_API_VERSION,
  GITHUB_NAME_SOURCES,
  isInstallUrl,
  isOwner,
  isRepo
} from '../src/shared/github-names'
import { RELEASE_ARTIFACTS, artifactFileName } from '../src/shared/release-artifacts.mjs'
import {
  REVIEW_COMMENTS_MAX,
  REVIEW_COMMENT_MAX,
  REVIEW_PATH_MAX,
  REVIEW_SUMMARY_MAX
} from '../src/shared/review-publish'
import {
  NOTION_OAUTH_REDIRECT_URI,
  NOTION_VERSION,
  REVIEW_REJECT_REASONS,
  SITE_GITHUB_ERROR_STATUS,
  reviewUrlOrNull
} from '../src/shared/site-contract'
import { RELEASES_REPO } from '../src/shared/updates'

/** `site/lib/contract.ts` (o que o teste usa). */
interface SiteContract {
  GITHUB_API_VERSION: string
  NOTION_VERSION: string
  NOTION_OAUTH_REDIRECT_URI: string
  RELEASES_REPO: string
  OWNER_SLUG: RegExp
  isRepoName(value: string): boolean
  isRepoPath(value: string): boolean
  installUrl(slug: string): string | null
  REVIEW_BODY_MAX: number
  REVIEW_COMMENTS_MAX: number
  REVIEW_COMMENT_MAX: number
  REVIEW_PATH_MAX: number
  GITHUB_ERROR_STATUS: Record<string, number>
  REVIEW_REJECT_REASONS: readonly string[]
  reviewUrlOrNull(value: unknown, owner: string, repo: string, number: number): string | null
  DOWNLOAD_FILES: Record<string, (version: string) => string>
}
/** `site/lib/github-app.ts` (o que o teste usa). */
interface SiteGitHubApp {
  validateReviewRequest(body: unknown): object | null
}

// Caminho em variável: o tsc da raiz não segue o import para dentro do package do site (que tem o
// próprio tsconfig); o Vitest importa o arquivo normalmente.
const SITE_CONTRACT: string = '../site/lib/contract'
const SITE_GITHUB_APP: string = '../site/lib/github-app'
const site = (await import(SITE_CONTRACT)) as SiteContract
const siteGitHubApp = (await import(SITE_GITHUB_APP)) as SiteGitHubApp

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

describe('contrato app ↔ site: valores', () => {
  it('mesmas versões das APIs do GitHub e do Notion', () => {
    expect(site.GITHUB_API_VERSION).toBe(GITHUB_API_VERSION)
    expect(site.NOTION_VERSION).toBe(NOTION_VERSION)
    expect(NOTION_CLIENT_VERSION).toBe(NOTION_VERSION)
  })

  it('mesmo redirect URI do Notion e mesmo repositório dos releases', () => {
    expect(site.NOTION_OAUTH_REDIRECT_URI).toBe(NOTION_OAUTH_REDIRECT_URI)
    expect(site.RELEASES_REPO).toBe(`${RELEASES_REPO.owner}/${RELEASES_REPO.repo}`)
  })

  it('mesmos limites da revisão', () => {
    expect({
      body: site.REVIEW_BODY_MAX,
      comments: site.REVIEW_COMMENTS_MAX,
      comment: site.REVIEW_COMMENT_MAX,
      path: site.REVIEW_PATH_MAX
    }).toEqual({
      body: REVIEW_SUMMARY_MAX,
      comments: REVIEW_COMMENTS_MAX,
      comment: REVIEW_COMMENT_MAX,
      path: REVIEW_PATH_MAX
    })
  })

  it('mesmos códigos de erro (e status) das rotas /github/*', () => {
    expect(site.GITHUB_ERROR_STATUS).toEqual(SITE_GITHUB_ERROR_STATUS)
    expect([...site.REVIEW_REJECT_REASONS]).toEqual([...REVIEW_REJECT_REASONS])
  })

  it('mesmos nomes dos arquivos de download (manifesto dos releases)', () => {
    const downloads = RELEASE_ARTIFACTS.filter((a) => a.download !== null)
    expect(Object.keys(site.DOWNLOAD_FILES).sort()).toEqual(downloads.map((a) => a.download).sort())
    for (const version of ['1.2.3', '0.3.0-beta.2']) {
      for (const a of downloads) {
        expect(site.DOWNLOAD_FILES[a.download!]!(version), a.download!).toBe(
          artifactFileName(a, version)
        )
      }
    }
  })
})

describe('contrato app ↔ site: regras', () => {
  it('mesma regra de owner', () => {
    expect(site.OWNER_SLUG.source).toBe(`^${GITHUB_NAME_SOURCES.owner}$`)
    for (const name of NAMES) expect(site.OWNER_SLUG.test(name), name).toBe(isOwner(name))
  })

  it('mesma regra de repositório (e de owner/repo no repositório dos releases)', () => {
    for (const name of NAMES) expect(site.isRepoName(name), name).toBe(isRepo(name))
    for (const owner of NAMES) {
      for (const repo of ['orkio', '..', 'a.b']) {
        expect(site.isRepoPath(`${owner}/${repo}`), `${owner}/${repo}`).toBe(
          isOwner(owner) && isRepo(repo)
        )
      }
    }
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
      const url = site.installUrl(slug)
      expect(url !== null, slug).toBe(
        isInstallUrl(`https://github.com/apps/${slug}/installations/new`)
      )
      if (url) expect(isInstallUrl(url), slug).toBe(true)
    }
  })

  it('mesmo link de revisão aceito', () => {
    const cases: unknown[] = [
      'https://github.com/acme/orkio/pull/7#pullrequestreview-99',
      'https://github.com/Acme/Orkio/pull/7',
      'https://github.com/acme/orkio/pull/8',
      'https://github.com/acme/orkio/pull/7?x=1',
      'http://github.com/acme/orkio/pull/7',
      'https://github.com:8443/acme/orkio/pull/7',
      'https://u:p@github.com/acme/orkio/pull/7',
      'https://github.com/acme/orkio/pull/7#discussion_r1',
      'não é url',
      null
    ]
    for (const value of cases) {
      expect(site.reviewUrlOrNull(value, 'acme', 'orkio', 7), String(value)).toBe(
        reviewUrlOrNull(value, 'acme', 'orkio', 7)
      )
    }
  })

  it('a maior revisão que o app manda passa no validador do site', () => {
    const review = {
      owner: 'acme',
      repo: 'orkio',
      number: 7,
      userToken: 'gho_x',
      review: {
        event: 'REQUEST_CHANGES',
        body: 'x'.repeat(REVIEW_SUMMARY_MAX),
        comments: Array.from({ length: REVIEW_COMMENTS_MAX }, (_, i) => ({
          path: `${'p'.repeat(REVIEW_PATH_MAX - 6)}/${String(i).padStart(2, '0')}.ts`,
          line: i + 1,
          side: 'RIGHT',
          body: 'y'.repeat(REVIEW_COMMENT_MAX)
        }))
      }
    }
    expect(siteGitHubApp.validateReviewRequest(review)).not.toBeNull()
    const tooLong = {
      ...review,
      review: { ...review.review, body: 'x'.repeat(REVIEW_SUMMARY_MAX + 1) }
    }
    expect(siteGitHubApp.validateReviewRequest(tooLong)).toBeNull()
  })

  it('o app reconhece cada código de erro que o site manda', () => {
    for (const [error, status] of Object.entries(site.GITHUB_ERROR_STATUS)) {
      const kind = parseOrkioSiteResponse({ status, body: { error } }).kind
      if (error === 'upstream') expect(kind).toBe('upstream')
      else expect(kind, error).not.toBe('upstream')
    }
    for (const reason of site.REVIEW_REJECT_REASONS) {
      expect(
        parseOrkioSiteResponse({ status: 400, body: { error: 'bad_request', reason } })
      ).toEqual({ kind: 'bad_request', reason })
    }
  })
})
