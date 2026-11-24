import { describe, expect, it } from 'vitest'
import { githubRepoOf, type ProjectRepo } from './projects'

const repo = (over: Partial<ProjectRepo> = {}): ProjectRepo => ({
  host: 'github.com',
  owner: 'acme',
  name: 'orkio',
  remoteName: 'origin',
  defaultBranch: 'main',
  visibility: 'private',
  canPush: true,
  archived: false,
  verified: true,
  ...over
})

// Bug: sinais aceitavam outro host se `verified`, a entrega exigia `verified` com host exato, e
// histórico/aba Revisão/revisão publicada só olhavam o host. Agora todos perguntam aqui.
describe('githubRepoOf', () => {
  it('github.com verificado → coordenadas da API', () => {
    expect(githubRepoOf({ repo: repo() })).toEqual({ owner: 'acme', name: 'orkio' })
    expect(githubRepoOf({ repo: repo({ host: 'GitHub.com' }) })).toEqual({
      owner: 'acme',
      name: 'orkio'
    })
  })

  it('não verificado (Enterprise ou não confirmado na conta) → null', () => {
    expect(githubRepoOf({ repo: repo({ host: 'ghe.acme.com', verified: false }) })).toBeNull()
    expect(githubRepoOf({ repo: repo({ verified: false }) })).toBeNull()
  })

  it('verificado com outro host (config editada à mão) → null: owner/name não são do github.com', () => {
    expect(githubRepoOf({ repo: repo({ host: 'ghe.acme.com' }) })).toBeNull()
  })

  it('sem projeto ou sem repositório → null', () => {
    expect(githubRepoOf(null)).toBeNull()
    expect(githubRepoOf({ repo: null })).toBeNull()
  })
})
