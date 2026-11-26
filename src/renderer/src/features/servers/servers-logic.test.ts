import { describe, expect, it } from 'vitest'
import {
  defOf,
  draftOf,
  draftProblems,
  emptyDraft,
  newServerId,
  parseEnvText,
  serverStateText,
  withServer
} from './servers-logic'
import { isServerId, type ServerDef, type ServerView } from '../../../../shared/servers'

const api: ServerDef = { id: 's-api', name: 'backend', command: 'uvicorn app:app' }

describe('servers-logic', () => {
  it('rascunho ↔ cadastro: padrões somem, env em linhas', () => {
    const d = {
      ...emptyDraft('s-web'),
      name: ' frontend ',
      command: 'pnpm dev',
      cwd: 'apps/web/',
      portEnv: 'PORT',
      url: 'http://localhost:{port}',
      env: 'VITE_API_URL={backend.url}\n\n'
    }
    const def = defOf(d)
    expect(def).toEqual({
      id: 's-web',
      name: 'frontend',
      command: 'pnpm dev',
      cwd: 'apps/web',
      env: { VITE_API_URL: '{backend.url}' }
    })
    expect(defOf(draftOf(def))).toEqual(def)
  })

  it('problemas por campo com os outros servidores do projeto', () => {
    const d = { ...emptyDraft('s-new'), name: 'backend', command: '', env: 'SEM_IGUAL' }
    expect(draftProblems(d, [api])).toEqual({
      name: expect.stringMatching(/Já existe/),
      command: expect.any(String),
      env: expect.stringMatching(/NOME=valor/)
    })
    const ok = {
      ...emptyDraft('s-new'),
      name: 'frontend',
      command: 'pnpm dev',
      env: 'API_URL={backend.url}'
    }
    expect(draftProblems(ok, [api])).toEqual({})
    // Editando o próprio: o nome dele não conta como repetido.
    expect(draftProblems(draftOf(api), [api])).toEqual({})
  })

  it('env: linha sem = é recusada', () => {
    expect(parseEnvText('A=1\nB = 2')).toEqual({ A: '1', B: '2' })
    expect(parseEnvText('=x')).toBeNull()
  })

  it('id novo no formato do main; troca ou acrescenta', () => {
    expect(isServerId(newServerId())).toBe(true)
    const web = { ...api, id: 's-web', name: 'frontend' }
    expect(withServer([api], web)).toEqual([api, web])
    expect(withServer([api, web], { ...api, command: 'x' })[0]!.command).toBe('x')
  })

  it('texto do estado', () => {
    const base: ServerView = {
      id: 's-api',
      name: 'backend',
      command: 'x',
      state: 'exited',
      port: 4200,
      url: null,
      terminalId: null,
      by: 'you',
      exitCode: 1,
      startedAt: null
    }
    expect(serverStateText(base)).toEqual({ label: 'Parou sozinho (código 1)', tone: 'danger' })
    expect(serverStateText({ ...base, state: 'ready' }).label).toBe('Rodando')
  })
})
