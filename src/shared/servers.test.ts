import { describe, expect, it } from 'vitest'
import {
  SERVER_LIMITS,
  parseServerDefs,
  serverEnv,
  serverProblems,
  serverRefs,
  serverUrl,
  type ServerDef
} from './servers'

const web: ServerDef = { id: 's-web', name: 'frontend', command: 'pnpm dev', cwd: 'apps/web' }
const api: ServerDef = {
  id: 's-api',
  name: 'backend',
  command: 'uv run uvicorn app:app --port $PORT',
  portEnv: 'API_PORT'
}

function fields(defs: ServerDef[]): string[] {
  return serverProblems(defs).map((p) => `${p.index}:${p.field}`)
}

describe('serverProblems', () => {
  it('aceita o cadastro comum', () => {
    expect(serverProblems([web, api])).toEqual([])
    expect(serverProblems([{ ...web, env: { VITE_API_URL: '{backend.url}' } }, api])).toEqual([])
  })

  it('nome: formato e repetido', () => {
    expect(fields([{ ...web, name: 'Front End' }])).toEqual(['0:name'])
    expect(fields([web, { ...api, name: 'frontend' }])).toEqual(['1:name'])
  })

  it('comando: vazio, várias linhas ou longo demais', () => {
    expect(fields([{ ...web, command: '  ' }])).toEqual(['0:command'])
    expect(fields([{ ...web, command: 'pnpm dev\nrm -rf /' }])).toEqual(['0:command'])
    expect(fields([{ ...web, command: 'x'.repeat(SERVER_LIMITS.command + 1) }])).toEqual([
      '0:command'
    ])
  })

  it('pasta: só relativa, sem subir', () => {
    for (const cwd of ['/etc', '../fora', 'a/../../b', 'a\\b', 'a b']) {
      expect(fields([{ ...web, cwd }])).toEqual(['0:cwd'])
    }
    expect(fields([{ ...web, cwd: 'apps/web-2' }])).toEqual([])
  })

  it('variável da porta e variáveis extras seguem a regra do Vault', () => {
    expect(fields([{ ...web, portEnv: 'port' }])).toEqual(['0:portEnv'])
    expect(fields([{ ...web, portEnv: 'PATH' }])).toEqual(['0:portEnv'])
    expect(fields([{ ...web, env: { NODE_OPTIONS: 'x' } }])).toEqual(['0:env'])
  })

  it('URL: só localhost com {port}', () => {
    expect(fields([{ ...web, url: 'http://localhost:{port}/app' }])).toEqual([])
    expect(fields([{ ...web, url: 'http://127.0.0.1:{port}' }])).toEqual([])
    expect(fields([{ ...web, url: 'https://exemplo.com:{port}' }])).toEqual(['0:url'])
    expect(fields([{ ...web, url: 'http://localhost:3000' }])).toEqual(['0:url'])
  })

  it('referência a servidor inexistente ou a si mesmo é recusada', () => {
    expect(fields([{ ...web, env: { API: '{nada.url}' } }])).toEqual(['0:env'])
    expect(fields([{ ...web, env: { SELF: '{frontend.port}' } }])).toEqual(['0:env'])
  })

  it('no máximo 6 servidores', () => {
    const many = Array.from({ length: 7 }, (_, i) => ({ ...web, id: `s-${i}`, name: `s${i}` }))
    expect(fields(many)).toContain('6:name')
  })
})

describe('serverUrl / serverEnv / serverRefs', () => {
  it('URL padrão e modelo', () => {
    expect(serverUrl(web, 4100)).toBe('http://localhost:4100')
    expect(serverUrl({ ...web, url: 'http://127.0.0.1:{port}/docs' }, 4201)).toBe(
      'http://127.0.0.1:4201/docs'
    )
  })

  it('porta na variável escolhida e referência ao outro servidor', () => {
    const front = { ...web, env: { VITE_API_URL: '{backend.url}', API_PORT_X: '{backend.port}' } }
    const ports: Record<string, number> = { 's-web': 4100, 's-api': 4200 }
    expect(serverEnv(front, [front, api], (id) => ports[id]!)).toEqual({
      PORT: '4100',
      VITE_API_URL: 'http://localhost:4200',
      API_PORT_X: '4200'
    })
    expect(serverEnv(api, [front, api], (id) => ports[id]!)).toEqual({ API_PORT: '4200' })
    expect(serverRefs(front)).toEqual(['backend'])
  })
})

describe('parseServerDefs', () => {
  it('descarta o que não é servidor e mantém os válidos', () => {
    const parsed = parseServerDefs([web, { name: 'x' }, 'lixo', { ...api, env: { A: 1 } }, api])
    expect(parsed).toEqual([web, api])
    expect(parseServerDefs('nada')).toEqual([])
  })
})
