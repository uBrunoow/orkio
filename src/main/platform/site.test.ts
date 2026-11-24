import { describe, expect, it } from 'vitest'
import { allowsLoopbackSite, isAllowedSiteOrigin, siteOrigin } from './site'

describe('siteOrigin', () => {
  it('uma variável só (MAIN_VITE_SITE_URL); só a origem vale', () => {
    expect(siteOrigin({ MAIN_VITE_SITE_URL: 'https://orkio.dev/' })).toBe('https://orkio.dev')
    // Valor antigo do intermediário (com /notion) continua dando a mesma origem.
    expect(siteOrigin({ MAIN_VITE_SITE_URL: 'https://orkio.dev/notion' })).toBe('https://orkio.dev')
    expect(siteOrigin({})).toBeNull()
    expect(siteOrigin({ MAIN_VITE_SITE_URL: '   ' })).toBeNull()
  })

  it('só https; http só em 127.0.0.1 e nunca em produção; nunca localhost', () => {
    const site = (url: string, MODE = 'production') => siteOrigin({ MODE, MAIN_VITE_SITE_URL: url })
    expect(site('http://127.0.0.1:3000')).toBeNull()
    expect(site('http://127.0.0.1:3000', 'development')).toBe('http://127.0.0.1:3000')
    expect(site('http://127.0.0.1:3000', 'e2e')).toBe('http://127.0.0.1:3000')
    expect(siteOrigin({ MAIN_VITE_SITE_URL: 'http://127.0.0.1:3000' })).toBeNull() // sem MODE
    expect(site('http://localhost:3000', 'e2e')).toBeNull()
    expect(site('http://orkio.dev', 'development')).toBeNull()
    expect(site('https://u:p@orkio.dev')).toBeNull()
    expect(site('lixo')).toBeNull()
  })

  it('regra da origem (o conector confere de novo antes de mandar o token)', () => {
    expect(isAllowedSiteOrigin('https://orkio.dev', false)).toBe(true)
    expect(isAllowedSiteOrigin('https://orkio.dev/x', false)).toBe(false) // só origem
    expect(isAllowedSiteOrigin('http://127.0.0.1:3000', false)).toBe(false)
    expect(isAllowedSiteOrigin('http://127.0.0.1:3000', true)).toBe(true)
    expect(isAllowedSiteOrigin('http://localhost:3000', true)).toBe(false)
    expect(allowsLoopbackSite({ MODE: 'production' })).toBe(false)
    expect(allowsLoopbackSite({ MODE: 'e2e' })).toBe(true)
  })
})
