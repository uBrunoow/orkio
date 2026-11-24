import { describe, expect, it } from 'vitest'
import type { ClaudeCodeStatus } from '../../../../shared/agent-run'
import type {
  ConnectionStatus,
  NotionWorkspaceStatus,
  ProjectView
} from '../../../../shared/ipc-contract'
import { setupPending, setupSteps, type SetupInput } from './setup-steps'

const connected = (handle: string): ConnectionStatus => ({
  state: 'connected',
  account: { userName: handle, handle } as never,
  connectedAt: ''
})
const claudeOk: ClaudeCodeStatus = {
  installed: true,
  version: '2.4.1',
  loggedIn: true,
  authMethod: 'claude.ai',
  meetsMinimum: true,
  minimumVersion: '2.0.0',
  supportsEffort: true
}
const project = {
  id: 'p1',
  name: 'orkio',
  localPath: '/home/x/www/orkio',
  notionProject: { id: 'n', name: 'Orkio' }
} as ProjectView
const workspace = {
  config: {} as never,
  health: 'ok',
  messages: [],
  connection: 'oauth'
} as NotionWorkspaceStatus

const empty: SetupInput = {
  github: { state: 'disconnected' },
  notion: { state: 'disconnected' },
  claude: null,
  project: null,
  workspace: null,
  boardConfigured: false
}

const states = (input: SetupInput): string[] => setupSteps(input).map((s) => `${s.id}:${s.state}`)

describe('setupSteps', () => {
  it('tudo vazio: GitHub é o atual', () => {
    expect(states(empty)).toEqual([
      'github:current',
      'notion:todo',
      'claude:todo',
      'folder:todo',
      'notion-data:todo',
      'board:todo',
      'first-task:todo'
    ])
  })

  it('GitHub é obrigatório: sem ele continua o atual e conta como pendente', () => {
    const steps = setupSteps({ ...empty, notion: connected('Ana'), claude: claudeOk, project })
    expect(steps.map((s) => `${s.id}:${s.state}`).slice(0, 2)).toEqual([
      'github:current',
      'notion:done'
    ])
    expect(setupPending(steps)).toBe(3)
  })

  it('Notion com erro no meio volta a ser o atual', () => {
    const steps = setupSteps({
      ...empty,
      github: connected('uBrunoow'),
      notion: { state: 'error', message: 'x' },
      claude: claudeOk,
      project
    })
    expect(steps.map((s) => `${s.id}:${s.state}`).slice(0, 4)).toEqual([
      'github:done',
      'notion:current',
      'claude:done',
      'folder:done'
    ])
    expect(steps[0]?.summary).toBe('uBrunoow')
    expect(steps[2]?.summary).toBe('v2.4.1 · logado')
  })

  it('pendentes contam os passos 1 a 6', () => {
    const almost: SetupInput = {
      github: connected('u'),
      notion: connected('Ana'),
      claude: claudeOk,
      project,
      workspace,
      boardConfigured: false
    }
    expect(setupPending(setupSteps(almost))).toBe(1)
    expect(setupPending(setupSteps({ ...almost, boardConfigured: true }))).toBe(0)
    expect(setupPending(setupSteps({ ...almost, github: { state: 'disconnected' } }))).toBe(2)
  })

  it('primeira tarefa nunca fica feita', () => {
    const all = setupSteps({
      github: connected('u'),
      notion: connected('Ana'),
      claude: claudeOk,
      project,
      workspace,
      boardConfigured: true
    })
    expect(all.at(-1)).toMatchObject({ id: 'first-task', state: 'current' })
  })

  it('sem página do Notion vinculada, o passo 5 continua pendente', () => {
    const steps = setupSteps({
      ...empty,
      github: connected('u'),
      notion: connected('Ana'),
      claude: claudeOk,
      project: { ...project, notionProject: null },
      workspace
    })
    expect(steps.find((s) => s.id === 'notion-data')?.state).toBe('current')
  })
})
