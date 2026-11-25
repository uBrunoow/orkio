import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { builtinAgent, BUILTIN_AGENT_KEYS } from '../../shared/agent-presets'
import { nativeQuickFlow, NATIVE_PROMPTS } from '../../shared/native-flows'
import type { ProjectFlows } from '../../shared/task-flow'
import { BoardStore } from '../board/board.store'
import { openDatabase, type Db } from '../db/database'
import { ORKIO_ACTIONS } from '../../shared/orkio-actions'
import type { RunRequest } from '../claude/run-spec'
import {
  FlowRunner,
  NOOP_ACTION,
  ORKIO_LINES_EXTRACTOR,
  type FlowAgent,
  type FlowRunnerDeps,
  type NativePlan,
  type OrkioAction
} from './flow-runner'

let db: Db
let store: BoardStore
let requests: RunRequest[]
let config: ProjectFlows
let plan: NativePlan | null
let implementer: FlowAgent | null

const REVIEWER: FlowAgent = {
  key: BUILTIN_AGENT_KEYS.reviewer,
  profile: builtinAgent('revisor')!
}
const IMPLEMENTER: FlowAgent = {
  key: BUILTIN_AGENT_KEYS.implementer,
  profile: builtinAgent('implementador')!
}

// O push é uma ação do Orkio; aqui só registra que passou.
const PUSH: OrkioAction = { ...ORKIO_ACTIONS.push, run: async () => ({ ok: true }) }

function makeRunner(over: Partial<FlowRunnerDeps> = {}): FlowRunner {
  let n = 0
  return new FlowRunner({
    db,
    store,
    flows: () => config,
    currentStage: () => 's-dev',
    prepare: async () => ({ briefing: '# ORK-1', displayId: 'ORK-1', notionUrl: null }),
    startClaude: async (req) => {
      requests.push(req)
      return `run-${requests.length}`
    },
    cancelClaude: () => undefined,
    extractors: [ORKIO_LINES_EXTRACTOR],
    actions: [NOOP_ACTION, PUSH],
    notify: () => undefined,
    emit: () => undefined,
    enterStage: () => undefined,
    worktreePath: () => null,
    integrations: [],
    agentFor: async () => implementer,
    agentLimit: () => null,
    onFinished: () => undefined,
    nativePlan: async () => plan,
    lastResult: async (runId) => `Texto final de ${runId}`,
    newId: () => `fr-${++n}`,
    ...over
  })
}

const finish = (runner: FlowRunner, runId: string, resultText = ''): void =>
  runner.onRunFinished({
    runId,
    taskId: 't1',
    status: 'succeeded',
    resultText,
    summary: null,
    costUsd: 0.01,
    message: null,
    code: null
  })

const flush = (): Promise<void> => vi.runAllTimersAsync().then(() => undefined)

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setImmediate'] })
  db = openDatabase(':memory:')
  store = new BoardStore(db)
  requests = []
  config = { flows: [], bindings: [] }
  implementer = null
  plan = {
    flow: nativeQuickFlow({ review: true, evidence: false }),
    source: 'column',
    reviewer: REVIEWER,
    model: 'opus'
  }
})
afterEach(() => {
  vi.useRealTimers()
  db.close()
})

describe('FlowRunner com fluxo nativo (Fase 1)', () => {
  it('entrar na coluna com modo roda o fluxo nativo, sem fluxo ligado', async () => {
    const runner = makeRunner()
    runner.onStageChanged({
      projectId: 'p1',
      taskId: 't1',
      from: 's-todo',
      to: 's-dev',
      source: 'manual'
    })
    await flush()
    const [view] = runner.list('t1')
    expect(view).toMatchObject({ flowId: 'orkio:rapido', status: 'running' })
    expect(view!.reviewer).toMatchObject({ key: REVIEWER.key, name: 'Revisor' })
    expect(requests[0]!.input).toEqual({ kind: 'prompt', text: NATIVE_PROMPTS.implement })
  })

  it('revisor em sessão própria; quem implementa continua a dele; correção leva a revisão', async () => {
    implementer = IMPLEMENTER
    const runner = makeRunner()
    const view = await runner.startManual('p1', 't1')
    // Implementar: quem implementa, modelo da configuração, sessão mais recente sem a do revisor.
    expect(requests[0]).toMatchObject({
      agent: { key: IMPLEMENTER.key },
      runtime: { model: 'opus' },
      session: { kind: 'latest', excludeAgent: REVIEWER.key }
    })
    finish(runner, 'run-1')
    await flush()
    // Revisão: outro agente, só leitura, sessão nova com o briefing, sem o modelo da tarefa.
    expect(requests[1]).toMatchObject({
      agent: { key: REVIEWER.key, name: 'Revisor' },
      access: { tools: 'read_only' },
      session: { kind: 'new', includeBriefing: true },
      runtime: null
    })
    finish(runner, 'run-2', 'Achei um bug.\n@orkio bloqueios=1')
    await flush()
    // Correção: volta para quem implementa com o texto final da revisão.
    expect(requests[2]!.agent).toMatchObject({ key: IMPLEMENTER.key })
    expect(requests[2]!.input).toEqual({
      kind: 'prompt',
      text: `${NATIVE_PROMPTS.fix}\n\n---\nResultado do passo anterior:\n\nTexto final de run-2`
    })
    finish(runner, 'run-3')
    await flush()
    expect(requests[3]!.agent).toMatchObject({ key: REVIEWER.key })
    finish(runner, 'run-4', 'Tudo certo.\n@orkio bloqueios=0')
    await flush()
    expect(runner.view(view.id)).toMatchObject({ status: 'waiting_gate', currentStep: 'ver-diff' })
  })

  it('quem implementa não revisa o próprio trabalho', async () => {
    implementer = { ...REVIEWER, profile: { ...REVIEWER.profile, delivery: true } }
    const runner = makeRunner()
    await expect(runner.startManual('p1', 't1')).rejects.toMatchObject({ code: 'same_reviewer' })
    expect(requests).toHaveLength(0)
  })

  it('modo da tarefa vence o fluxo ligado; da coluna perde para o fluxo preferido do agente', async () => {
    config = {
      flows: [
        {
          id: 'preferido',
          name: 'Preferido',
          steps: [{ id: 'fim', name: 'Fim', type: 'orkio_action', action: 'noop' }]
        }
      ],
      bindings: []
    }
    implementer = { ...IMPLEMENTER, profile: { ...IMPLEMENTER.profile, flow: 'preferido' } }
    const runner = makeRunner()
    const first = await runner.startManual('p1', 't1')
    expect(first.flowId).toBe('preferido')
    plan = { ...plan!, source: 'task' }
    const other = makeRunner({ newId: () => 'fr-x' })
    db.run(`UPDATE flow_runs SET status = 'finished'`)
    const second = await other.startManual('p1', 't1')
    expect(second.flowId).toBe('orkio:rapido')
  })

  it('sem modo e sem fluxo ligado: "Rodar" explica que não há fluxo', async () => {
    plan = null
    const runner = makeRunner()
    await expect(runner.startManual('p1', 't1')).rejects.toMatchObject({ code: 'no_binding' })
  })
})
