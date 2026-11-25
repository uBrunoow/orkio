import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nativeQuickFlow, NATIVE_PROMPTS } from '../../shared/native-flows'
import { ACTION_VARS, ORKIO_ACTIONS } from '../../shared/orkio-actions'
import { prWatchOf, type PrWatch } from '../../shared/pr-wake'
import type { TaskPullRequest } from '../../shared/task-signals'
import type { ProjectFlows } from '../../shared/task-flow'
import { BoardStore } from '../board/board.store'
import { openDatabase, type Db } from '../db/database'
import type { RunRequest } from '../claude/run-spec'
import {
  FlowRunner,
  NOOP_ACTION,
  ORKIO_LINES_EXTRACTOR,
  type FlowRunnerDeps,
  type NativePlan,
  type OrkioAction
} from './flow-runner'
import { PrWakeService, WAIT_PR_ACTION } from './pr-wake'

let db: Db
let store: BoardStore
let requests: RunRequest[]
let config: ProjectFlows
let plan: NativePlan | null
let moves: number
let pushedAnswer: string

const PUSH: OrkioAction = { ...ORKIO_ACTIONS.push, run: async () => ({ ok: true }) }
const VERIFY: OrkioAction = {
  ...ORKIO_ACTIONS.verify_pushed,
  run: async () => ({ ok: true, vars: { [ACTION_VARS.prPushed]: pushedAnswer } })
}
const MOVE_DONE: OrkioAction = {
  ...ORKIO_ACTIONS.move_done,
  run: async () => {
    moves++
    return { ok: true, message: 'A tarefa foi para Concluída.' }
  }
}

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
    actions: [NOOP_ACTION, PUSH, VERIFY, MOVE_DONE, WAIT_PR_ACTION],
    notify: () => undefined,
    emit: () => undefined,
    enterStage: () => undefined,
    worktreePath: () => null,
    integrations: [],
    agentFor: async () => null,
    agentLimit: () => null,
    onFinished: () => undefined,
    nativePlan: async () => plan,
    newId: () => `fr-${++n}`,
    ...over
  })
}

const finish = (runner: FlowRunner, runId: string, resultText = 'feito'): void =>
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

const flush = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) {
    await vi.runAllTimersAsync()
    await new Promise((resolve) => setTimeout(resolve, 2))
  }
}

const pr = (over: Partial<TaskPullRequest> = {}): PrWatch =>
  prWatchOf({
    number: 7,
    title: 'x',
    url: 'u',
    state: 'open',
    merged: false,
    headRef: 'b',
    headSha: 'aaa',
    updatedAt: 'x',
    reviewDecision: null,
    unresolvedComments: 0,
    checks: 'pending',
    reviews: [],
    unresolvedThreadIds: [],
    ...over
  })!

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setImmediate'] })
  db = openDatabase(':memory:')
  store = new BoardStore(db)
  requests = []
  config = { flows: [], bindings: [] }
  moves = 0
  pushedAnswer = 'nao'
  plan = {
    flow: nativeQuickFlow({ review: false, evidence: false }),
    source: 'column',
    reviewer: null,
    model: null
  }
})
afterEach(() => {
  vi.useRealTimers()
  db.close()
})

/** Do começo até a espera da PR (implementar → diff aprovado → push → abrir a PR). */
async function untilPrWait(runner: FlowRunner): Promise<string> {
  const view = await runner.startManual('p1', 't1')
  finish(runner, 'run-1')
  await flush()
  await runner.approveGate(view.id)
  await flush()
  finish(runner, 'run-2')
  await flush()
  return view.id
}

describe('Fase 5: a PR acorda o fluxo', () => {
  it('espera sem precisar de você; CI falhou → corrige; merge → Concluída', async () => {
    let current: PrWatch | null = pr()
    const runner = makeRunner({ prWatch: () => current })
    const id = await untilPrWait(runner)
    expect(runner.view(id)).toMatchObject({
      status: 'paused',
      pauseReason: 'waiting_pr',
      currentStep: 'esperar-pr'
    })
    // A conversa da tarefa fica livre enquanto espera.
    expect(runner.isBusy('t1')).toBe(false)
    expect(runner.waitingPr()).toEqual([
      { flowRunId: id, projectId: 'p1', taskId: 't1', baseline: pr() }
    ])

    let clock = 0
    const wake = new PrWakeService({ runner, prWatch: () => current, now: () => clock })
    current = pr({ checks: 'failure' })
    expect(await wake.tick()).toEqual([])
    clock = 60_000
    expect(await wake.tick()).toEqual([])
    clock = 120_000
    expect(await wake.tick()).toEqual([{ flowRunId: id, event: 'ci_falhou' }])
    await flush()
    expect((requests[2]!.input as { text: string }).text).toBe(NATIVE_PROMPTS.ciFix)
    finish(runner, 'run-3')
    await flush()
    // Correção enviada (push) e de volta à espera, com a foto nova.
    expect(runner.view(id)).toMatchObject({ pauseReason: 'waiting_pr', currentStep: 'esperar-pr' })

    current = pr({ checks: 'failure', merged: true })
    expect(await wake.tick()).toEqual([{ flowRunId: id, event: 'merge' }])
    await flush()
    expect(moves).toBe(1)
    expect(runner.view(id)).toMatchObject({ status: 'finished', result: 'done' })
  })

  it('PR fechada sem merge termina como "nada a fazer"', async () => {
    const runner = makeRunner({ prWatch: () => pr() })
    const id = await untilPrWait(runner)
    await runner.wakePr(id, 'fechada')
    await flush()
    expect(runner.view(id)).toMatchObject({ status: 'finished', result: 'nothing' })
    // Acordar de novo um fluxo que já não espera não faz nada.
    expect(await runner.wakePr(id, 'merge')).toBe(false)
  })
})

describe('Fase 5: parou sem entregar', () => {
  it('sem commit, sem mudanças e sem resposta → Precisa de você', async () => {
    const runner = makeRunner({ workState: async () => ({ head: 'abc', dirty: false }) })
    const view = await runner.startManual('p1', 't1')
    finish(runner, 'run-1', '   ')
    await flush()
    const v = runner.view(view.id)
    expect(v).toMatchObject({ status: 'paused', pauseReason: 'step_failed' })
    expect(v.history.at(-1)).toMatchObject({ stepId: 'implementar', code: 'no_delivery' })
  })

  it('com resposta, commit novo ou mudança sem commit, o passo entregou', async () => {
    for (const [state, text] of [
      [{ head: 'abc', dirty: false }, 'Pronto.'],
      [{ head: 'abc', dirty: true }, ''],
      [null, '']
    ] as const) {
      requests = []
      db.run('DELETE FROM flow_runs')
      const runner = makeRunner({ workState: async () => state })
      const view = await runner.startManual('p1', 't1')
      finish(runner, 'run-1', text)
      await flush()
      expect(runner.view(view.id).status).toBe('waiting_gate')
    }
    // Commit novo: o topo mudou durante o passo.
    requests = []
    db.run('DELETE FROM flow_runs')
    let head = 'abc'
    const runner = makeRunner({ workState: async () => ({ head, dirty: false }) })
    const view = await runner.startManual('p1', 't1')
    head = 'def'
    finish(runner, 'run-1', '')
    await flush()
    expect(runner.view(view.id).status).toBe('waiting_gate')
  })
})

describe('Fase 5: o uso do Claude decide quando a automação roda', () => {
  it('fluxo da automação espera a janela renovar; o seu roda', async () => {
    let hold: string | null = 'A janela de 5 horas do Claude está em 95%.'
    const runner = makeRunner({ usageHold: async () => hold })
    const auto = await runner.startManual('p1', 't1', { auto: true })
    await flush()
    expect(runner.view(auto.id)).toMatchObject({ status: 'paused', pauseReason: 'waiting_usage' })
    expect(requests).toHaveLength(0)
    await runner.promoteUsage()
    expect(requests).toHaveLength(0)
    hold = null
    await runner.promoteUsage()
    await flush()
    expect(requests).toHaveLength(1)
    expect(runner.view(auto.id).status).toBe('running')

    hold = 'cheio'
    const mine = await runner.startManual('p1', 't2')
    expect(runner.view(mine.id).status).toBe('running')
    expect(requests).toHaveLength(2)
  })

  it('medidor falhando não segura nada', async () => {
    const runner = makeRunner({ usageHold: async () => Promise.reject(new Error('x')) })
    const view = await runner.startManual('p1', 't1', { auto: true })
    expect(runner.view(view.id).status).toBe('running')
  })
})
