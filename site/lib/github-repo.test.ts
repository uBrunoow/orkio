import { describe, expect, it, vi } from 'vitest'
import { STARS_MIN, formatStars, getRepoInfo } from './github-repo'

const json = (body: unknown, ok = true) =>
  vi.fn<typeof fetch>(async () => ({ ok, json: async () => body }) as Response)

describe('getRepoInfo', () => {
  it('estrelas só a partir do mínimo; falha da API mantém o link', async () => {
    expect(await getRepoInfo('acme/app', json({ stargazers_count: STARS_MIN }))).toEqual({
      url: 'https://github.com/acme/app',
      stars: STARS_MIN
    })
    expect(await getRepoInfo('acme/app', json({ stargazers_count: 3 }))).toEqual({
      url: 'https://github.com/acme/app',
      stars: null
    })
    expect(await getRepoInfo('acme/app', json({}, false))).toMatchObject({ stars: null })
    const boom = vi.fn<typeof fetch>(async () => {
      throw new Error('rede')
    })
    expect(await getRepoInfo('acme/app', boom)).toMatchObject({ stars: null })
  })

  it('sem repositório ou repositório privado: sem link', async () => {
    expect(await getRepoInfo(null, json({}))).toBeNull()
    expect(await getRepoInfo('acme/app', json({ private: true }))).toBeNull()
  })

  it('formata milhares em pt-BR', () => {
    expect(formatStars(980)).toBe('980')
    expect(formatStars(1520)).toBe('1,5 mil')
  })
})
