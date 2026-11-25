import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createReviewRoundActions } from './review-round-actions'
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

let worktree: string
/** Texto final de cada execução (o revisor responde nas três seções). */
let answers: Map<string, string>
const ROUND = (blockers: string): string =>
  `## Bloqueios\n${blockers}\n\n## Detalhes\n- Nenhum\n\n## Evidência\nLi o diff.`

/** Ações reais da revisão até ficar limpo, num worktree temporário e git falso. */
function reviewActions(): OrkioAction[] {
  return [
    NOOP_ACTION,
    PUSH,
    ...createReviewRoundActions({
      worktree: () => ({ path: worktree, baseRef: 'origin/main' }),
      git: {
        diffText: async () => 'diff --git a/x b/x\n+novo\n',
        diffStat: async () => ({ stat: ' x | 1 +', files: ['x'] }),
        commitsSince: async () => [{ hash: 'abc1234', subject: 'feat: x' }],
        statusPorcelain: async () => []
      },
      finalText: async (runId) => answers.get(runId) ?? null
    })
  ]
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

/**
 * As ações da revisão gravam no disco de verdade (I/O real, fora dos timers falsos): algumas
 * voltas com uma espera curta de relógio real até o motor assentar.
 */
const flush = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) {
    await vi.runAllTimersAsync()
    await new Promise((resolve) => setTimeout(resolve, 3))
  }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setImmediate'] })
  worktree = mkdtempSync(join(tmpdir(), 'orkio-review-'))
  answers = new Map()
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
  rmSync(worktree, { recursive: true, force: true })
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

  it('revisor em sessão própria; quem implementa continua a dele; revisão até ficar limpo', async () => {
    implementer = IMPLEMENTER
    const runner = makeRunner({ actions: reviewActions() })
    const view = await runner.startManual('p1', 't1')
    // Implementar: quem implementa, modelo da configuração, sessão mais recente sem a do revisor.
    expect(requests[0]).toMatchObject({
      agent: { key: IMPLEMENTER.key },
      runtime: { model: 'opus' },
      session: { kind: 'latest', excludeAgent: REVIEWER.key }
    })
    finish(runner, 'run-1')
    await flush()
    // O Orkio grava o diff para o revisor antes da rodada.
    expect(readFileSync(join(worktree, '.orkio/revisao/diff.md'), 'utf8')).toContain('+novo')
    // Revisão: outro agente, só leitura, sessão nova com o briefing, sem o modelo da tarefa.
    expect(requests[1]).toMatchObject({
      agent: { key: REVIEWER.key, name: 'Revisor' },
      access: { tools: 'read_only' },
      session: { kind: 'new', includeBriefing: true },
      runtime: null
    })
    expect((requests[1]!.input as { text: string }).text).toContain('rodada 1 de 3')
    answers.set('run-2', ROUND('- [B-1] src/a.ts:1 — quebra no vazio'))
    finish(runner, 'run-2')
    await flush()
    expect(readFileSync(join(worktree, '.orkio/revisao/rodada-1.md'), 'utf8')).toContain('[B-1]')
    // Correção: volta para quem implementa, apontando o arquivo da rodada.
    expect(requests[2]!.agent).toMatchObject({ key: IMPLEMENTER.key })
    expect((requests[2]!.input as { text: string }).text).toContain('.orkio/revisao/rodada-1.md')
    finish(runner, 'run-3')
    await flush()
    expect(requests[3]!.agent).toMatchObject({ key: REVIEWER.key })
    expect((requests[3]!.input as { text: string }).text).toContain('rodada 2 de 3')
    answers.set('run-4', ROUND('- Nenhum'))
    finish(runner, 'run-4')
    await flush()
    const done = runner.view(view.id)
    expect(done).toMatchObject({ status: 'waiting_gate', currentStep: 'ver-diff' })
    expect(done.vars).toMatchObject({ 'revisao.veredito': 'limpo', 'revisao.rodada': '2' })
    expect(done.history.find((h) => h.stepId === 'registrar-revisao')?.message).toContain(
      'Rodada 1: 1 bloqueio (B-1)'
    )
  })

  it('os mesmos bloqueios voltando: o fluxo termina "travado" (final honesto)', async () => {
    const runner = makeRunner({ actions: reviewActions() })
    const view = await runner.startManual('p1', 't1')
    finish(runner, 'run-1')
    await flush()
    answers.set('run-2', ROUND('- [B-1] src/a.ts:1 — quebra'))
    finish(runner, 'run-2')
    await flush()
    finish(runner, 'run-3')
    await flush()
    answers.set('run-4', ROUND('- [B-1] src/a.ts:1 — continua quebrando'))
    finish(runner, 'run-4')
    await flush()
    expect(runner.view(view.id)).toMatchObject({ status: 'finished', result: 'stuck' })
  })

  it('o limite do dia vale para o revisor (o passo dele pausa, não o de quem implementa)', async () => {
    implementer = IMPLEMENTER
    const runner = makeRunner({
      actions: reviewActions(),
      agentLimit: (a) => (a.key === REVIEWER.key ? 'Revisor no limite do dia.' : null)
    })
    const view = await runner.startManual('p1', 't1')
    expect(requests).toHaveLength(1)
    finish(runner, 'run-1')
    await flush()
    expect(requests).toHaveLength(1)
    expect(runner.view(view.id)).toMatchObject({
      status: 'paused',
      pauseReason: 'agent_daily_limit',
      currentStep: 'revisar'
    })
  })

  it('o paralelo vale para o revisor: a revisão espera a vaga dele e começa sozinha', async () => {
    const reviewer = {
      ...REVIEWER,
      profile: { ...REVIEWER.profile, limits: { ...REVIEWER.profile.limits, parallel: 1 } }
    }
    plan = { ...plan!, reviewer }
    let n = 0
    const runner = makeRunner({ actions: reviewActions(), newId: () => `fr-${++n}` })
    const a = await runner.startManual('p1', 't1')
    const b = await runner.startManual('p1', 't2')
    finish(runner, 'run-1')
    await flush()
    finish(runner, 'run-2')
    await flush()
    // t1 revisando (run-3); t2 esperando a vaga do revisor no passo de revisão.
    expect(requests.map((r) => r.taskId)).toEqual(['t1', 't2', 't1'])
    expect(runner.view(b.id)).toMatchObject({
      status: 'paused',
      pauseReason: 'waiting_agent',
      currentStep: 'revisar'
    })
    answers.set('run-3', ROUND('- Nenhum'))
    finish(runner, 'run-3')
    await flush()
    expect(runner.view(a.id)).toMatchObject({ status: 'waiting_gate' })
    expect(requests.at(-1)).toMatchObject({ taskId: 't2', agent: { key: reviewer.key } })
    expect(runner.view(b.id)).toMatchObject({ status: 'running', currentStep: 'revisar' })
  })

  it('quem implementa não revisa o próprio trabalho', async () => {
    implementer = {
      ...REVIEWER,
      profile: { ...REVIEWER.profile, delivery: true, autonomy: 'edits' }
    }
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
