import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Flow, ProjectFlows } from '../../shared/task-flow'
import { BoardStore } from '../board/board.store'
import type { StageChange } from '../board/board.service'
import { openDatabase, type Db } from '../db/database'
import {
  FLOW_MESSAGES,
  FlowError,
  FlowRunner,
  NOOP_ACTION,
  ORKIO_LINES_EXTRACTOR,
  type FlowExtractor,
  type FlowRunnerDeps
} from './flow-runner'

const FLOW: Flow = {
  id: 'f1',
  name: 'Revisar e entregar',
  steps: [
    {
      id: 'revisar',
      name: 'Revisar',
      type: 'claude_command',
      command: 'revisar',
      args: '{{task_id}} {{briefing_path}}',
      timeoutMin: 10,
      extract: { extractor: 'linhas_orkio' }
    },
    {
      id: 'ok',
      name: 'Aprovar',
      type: 'gate',
      message: 'Pode seguir?',
      show: 'diff',
      onReject: 'stop',
      timeoutMin: null
    },
    {
      id: 'entregar',
      name: 'Entregar',
      type: 'claude_command',
      command: 'entregar',
      args: 'pr={{flow.pr}}',
      timeoutMin: 10
    },
    { id: 'fim', name: 'Fim', type: 'orkio_action', action: 'noop' }
  ]
}

const flush = (): Promise<void> => new Promise((r) => setImmediate(() => setImmediate(r)))

let db: Db
let store: BoardStore
let started: {
  runId: string
  command: string
  args: string
  briefing: string
  includeBriefing?: boolean
  delivery?: boolean
}[]
let cancelled: string[]
let notifications: string[]
let stage: string | null
let prepare: ReturnType<typeof vi.fn>
let config: ProjectFlows

function makeRunner(over: Partial<FlowRunnerDeps> = {}): FlowRunner {
  let n = 0
  return new FlowRunner({
    db,
    store,
    flows: () => config,
    currentStage: () => stage,
    prepare: prepare as unknown as FlowRunnerDeps['prepare'],
    startClaude: async (input) => {
      const runId = `run-${started.length + 1}`
      started.push({
        runId,
        command: input.command,
        args: input.args,
        briefing: input.briefing,
        includeBriefing: input.includeBriefing,
        delivery: input.delivery
      })
      return runId
    },
    cancelClaude: (id) => cancelled.push(id),
    extractors: [ORKIO_LINES_EXTRACTOR],
    actions: [NOOP_ACTION],
    notify: (title) => notifications.push(title),
    emit: () => undefined,
    newId: () => `fr-${++n}`,
    ...over
  })
}

const finish = (
  runner: FlowRunner,
  runId: string,
  status: 'succeeded' | 'failed' | 'cancelled',
  resultText = ''
): void =>
  runner.onRunFinished({
    runId,
    taskId: 't1',
    status,
    resultText,
    summary: null,
    costUsd: 0.02,
    message: status === 'failed' ? 'Deu ruim' : null
  })

const enter = (runner: FlowRunner, source: StageChange['source'], to = 's-rev'): void =>
  runner.onStageChanged({ projectId: 'p1', taskId: 't1', from: 's-dev', to, source })

beforeEach(() => {
  db = openDatabase(':memory:')
  store = new BoardStore(db)
  started = []
  cancelled = []
  notifications = []
  stage = 's-rev'
  prepare = vi.fn(async () => ({ briefing: '# ORK-1', displayId: 'ORK-1', notionUrl: null }))
  config = {
    flows: [FLOW],
    bindings: [{ stageId: 's-rev', flowId: 'f1', enabled: true, mode: 'on_enter' }]
  }
})
afterEach(() => db.close())

describe('FlowRunner', () => {
  it('on_enter só em entrada real (manual/automação), nunca reconciliação/desfazer/remoção', async () => {
    const runner = makeRunner()
    for (const source of ['notion', 'rollback', 'stage_removed'] as const) {
      enter(runner, source)
      await flush()
    }
    expect(runner.list('t1')).toEqual([])
    enter(runner, 'automation')
    await flush()
    expect(runner.list('t1')).toHaveLength(1)
    expect(started).toHaveLength(1)
    // Desligada ou modo manual: entrar não dispara.
    config = { ...config, bindings: [{ ...config.bindings[0]!, mode: 'manual' }] }
    const other = makeRunner()
    db.run("UPDATE flow_runs SET status = 'cancelled'")
    enter(other, 'manual')
    await flush()
    expect(other.list('t1').filter((r) => r.status !== 'cancelled')).toEqual([])
  })

  it('sequência com gate: comando → gate (notifica) → aprovar → comando → ação → concluído', async () => {
    const runner = makeRunner()
    const view = await runner.startManual('p1', 't1')
    expect(view.status).toBe('running')
    expect(started[0]).toMatchObject({ command: 'revisar', args: 'ORK-1 .orkio/briefing.md' })

    finish(runner, 'run-1', 'succeeded', 'Tudo certo\n@orkio pr=45\n@orkio Ruim=x')
    await flush()
    let v = runner.view(view.id)
    expect(v.status).toBe('waiting_gate')
    expect(v.currentStep).toBe('ok')
    expect(v.vars).toEqual({ pr: '45' })
    expect(notifications).toContain('Um fluxo espera sua aprovação')

    await runner.approveGate(view.id)
    expect(started[1]).toMatchObject({ command: 'entregar', args: 'pr=45' })
    finish(runner, 'run-2', 'succeeded')
    await flush()
    v = runner.view(view.id)
    expect(v).toMatchObject({ status: 'finished', result: 'done' })
    expect(v.history.map((h) => [h.stepId, h.status])).toEqual([
      ['revisar', 'ok'],
      ['ok', 'approved'],
      ['entregar', 'ok'],
      ['fim', 'ok']
    ])
    expect(prepare).toHaveBeenCalledTimes(1) // briefing montado uma vez por fluxo
    expect(store.events('t1').map((e) => e.kind)[0]).toBe('flow_finished')
    expect(store.events('t1').map((e) => e.kind)).toContain('gate_approved')
  })

  it('falha pausa e não segue sozinha; retomar repete; pular segue', async () => {
    const runner = makeRunner()
    const { id } = await runner.startManual('p1', 't1')
    finish(runner, 'run-1', 'failed')
    await flush()
    let v = runner.view(id)
    expect(v).toMatchObject({
      status: 'paused',
      pauseReason: 'step_failed',
      currentStep: 'revisar'
    })
    expect(v.history[0]).toMatchObject({ status: 'failed', message: 'Deu ruim' })
    expect(started).toHaveLength(1) // nada novo começou
    expect(notifications).toContain('Um fluxo precisa de você')

    await runner.resume(id)
    expect(started).toHaveLength(2)
    expect(started[1]!.command).toBe('revisar')
    finish(runner, 'run-2', 'failed')
    await flush()
    await runner.skip(id)
    v = runner.view(id)
    expect(v.status).toBe('waiting_gate')
    expect(v.history.map((h) => h.status)).toEqual(['failed', 'skipped', 'waiting'])
  })

  it('gate recusado com "stop" encerra como recusado; ações fora de hora são recusadas', async () => {
    const runner = makeRunner()
    const { id } = await runner.startManual('p1', 't1')
    await expect(runner.approveGate(id)).rejects.toThrow(FLOW_MESSAGES.wrongState)
    finish(runner, 'run-1', 'succeeded')
    await flush()
    await runner.rejectGate(id)
    expect(runner.view(id)).toMatchObject({ status: 'finished', result: 'rejected' })
  })

  it('um fluxo por tarefa', async () => {
    const runner = makeRunner()
    await runner.startManual('p1', 't1')
    await expect(runner.startManual('p1', 't1')).rejects.toBeInstanceOf(FlowError)
    expect(runner.hasActive('t1')).toBe(true)
    expect(runner.activeForProject('p1')).toEqual({ t1: 'running' })
  })

  it('reiniciar: rodando vira interrompido (retomável); gate continua em gate', async () => {
    const r1 = makeRunner()
    const { id } = await r1.startManual('p1', 't1')
    r1.dispose()

    const r2 = makeRunner()
    r2.init()
    const v = r2.view(id)
    expect(v).toMatchObject({
      status: 'paused',
      pauseReason: 'interrupted',
      currentStep: 'revisar'
    })
    expect(v.history[0]!.status).toBe('interrupted')
    expect(r2.activeForProject('p1')).toMatchObject({ t1: 'needs_you' })
    // Retomar deste passo: nova execução do mesmo comando, briefing refeito.
    await r2.resume(id)
    expect(started.at(-1)!.command).toBe('revisar')
    expect(prepare).toHaveBeenCalledTimes(2)
    finish(r2, started.at(-1)!.runId, 'succeeded')
    await flush()
    expect(r2.view(id).status).toBe('waiting_gate')

    // Fecha de novo com o gate aberto: continua em gate.
    const r3 = makeRunner()
    r3.init()
    expect(r3.view(id).status).toBe('waiting_gate')
    await r3.approveGate(id)
    expect(r3.view(id).status).toBe('running')
  })

  it('tarefa saiu da etapa: o passo termina, mas só avança com sua escolha', async () => {
    const runner = makeRunner()
    const { id } = await runner.startManual('p1', 't1')
    runner.onStageChanged({
      projectId: 'p1',
      taskId: 't1',
      from: 's-rev',
      to: 's-dev',
      source: 'manual'
    })
    await flush()
    expect(runner.view(id)).toMatchObject({
      status: 'awaiting_decision',
      pauseReason: 'left_stage'
    })
    expect(notifications).toContain('A tarefa saiu da etapa do fluxo')

    finish(runner, 'run-1', 'succeeded')
    await flush()
    expect(runner.view(id).status).toBe('awaiting_decision') // não avançou para o gate
    expect(runner.view(id).history[0]!.status).toBe('ok')

    await runner.decideLeft(id, 'continue')
    expect(runner.view(id).status).toBe('waiting_gate')
    // Já não acompanha a etapa: sair de novo não pergunta outra vez.
    runner.onStageChanged({
      projectId: 'p1',
      taskId: 't1',
      from: 's-rev',
      to: 's-x',
      source: 'manual'
    })
    await flush()
    expect(runner.view(id).status).toBe('waiting_gate')
  })

  it('cancelar no meio de um comando cancela a execução da 4A', async () => {
    const runner = makeRunner()
    const { id } = await runner.startManual('p1', 't1')
    runner.onStageChanged({
      projectId: 'p1',
      taskId: 't1',
      from: 's-rev',
      to: 's-dev',
      source: 'automation'
    })
    await flush()
    await runner.decideLeft(id, 'cancel')
    expect(cancelled).toEqual(['run-1'])
    expect(runner.view(id)).toMatchObject({ status: 'cancelled', result: 'cancelled' })
    expect(runner.view(id).history[0]!.status).toBe('cancelled')
  })

  it('não conseguir iniciar o comando pausa com a mensagem', async () => {
    const runner = makeRunner({
      startClaude: async () => {
        throw new FlowError('not_installed', 'Claude Code não encontrado.')
      }
    })
    const { id } = await runner.startManual('p1', 't1')
    expect(runner.view(id)).toMatchObject({ status: 'paused', pauseReason: 'step_failed' })
    expect(runner.view(id).history[0]!.message).toBe('Claude Code não encontrado.')
  })

  it('fechar o app: o cancelamento das execuções não vira falha (reabre como interrompido)', async () => {
    const r1 = makeRunner()
    const { id } = await r1.startManual('p1', 't1')
    r1.dispose()
    finish(r1, 'run-1', 'cancelled') // cancelAll da 4A ao sair
    await flush()
    expect(r1.view(id).status).toBe('running')
    const r2 = makeRunner()
    r2.init()
    expect(r2.view(id)).toMatchObject({ status: 'paused', pauseReason: 'interrupted' })
  })

  describe('5B: capacidades genéricas', () => {
    const CHOOSER: FlowExtractor = {
      id: 'escolhe',
      label: 'Escolhe',
      snapshot: async () => ['antes'],
      extract: ({ resultText, snapshot }) =>
        resultText === 'nada'
          ? { fail: 'Nada foi criado.' }
          : resultText === 'varias'
            ? {
                vars: { 'x.antes': String((snapshot as string[])[0]) },
                choose: {
                  prompt: 'Qual?',
                  options: [
                    { value: 'A', label: 'A' },
                    { value: 'B', label: 'B' }
                  ]
                }
              }
            : { vars: { 'x.id': resultText } },
      resolveChoice: async ({ value }) => ({ vars: { 'x.id': value } })
    }
    const ALVA: Flow = {
      id: 'alva',
      name: 'Alva',
      tags: ['alva'],
      steps: [
        {
          id: 'spec',
          name: 'Spec',
          type: 'claude_command',
          command: 'alva-flow:spec',
          args: '{{alva.spec_arg}}',
          timeoutMin: 60,
          includeBriefing: false,
          extract: { extractor: 'escolhe' }
        },
        {
          id: 'plan',
          name: 'Plan',
          type: 'claude_command',
          command: 'alva-flow:plan',
          args: '{{x.id}} {{task_title}}',
          timeoutMin: 60
        },
        { id: 'push', name: 'Push', type: 'orkio_action', action: 'push' }
      ]
    }
    const PUSH = { id: 'push', label: 'Push', pending: 'Push chega na 5C.', run: NOOP_ACTION.run }

    function alvaRunner(over: Partial<FlowRunnerDeps> = {}): FlowRunner {
      config = {
        flows: [ALVA],
        bindings: [{ stageId: 's-rev', flowId: 'alva', enabled: true, mode: 'manual' }]
      }
      prepare.mockResolvedValue({
        briefing: '# ORK-1',
        displayId: 'ORK-1',
        title: 'Exportar CSV',
        notionUrl: null
      })
      return makeRunner({
        extractors: [CHOOSER],
        actions: [PUSH],
        initialVars: async () => ({ 'alva.spec_arg': 'ORK-1 — Exportar CSV' }),
        ...over
      })
    }

    it('variáveis iniciais, sem briefing nos argumentos, escolha pedida pelo extrator e ação pendente', async () => {
      const runner = alvaRunner()
      const { id } = await runner.startManual('p1', 't1')
      expect(started[0]).toMatchObject({ args: 'ORK-1 — Exportar CSV', includeBriefing: false })
      finish(runner, 'run-1', 'succeeded', 'varias')
      await flush()
      let v = runner.view(id)
      expect(v).toMatchObject({ status: 'paused', pauseReason: 'needs_choice' })
      expect(v.choice).toEqual({
        prompt: 'Qual?',
        options: [
          { value: 'A', label: 'A' },
          { value: 'B', label: 'B' }
        ]
      })
      await expect(runner.choose(id, 'Z')).rejects.toThrow('Opção inválida')
      await runner.choose(id, 'B')
      expect(started[1]).toMatchObject({ args: 'B Exportar CSV', includeBriefing: true })
      expect(runner.view(id).vars).toMatchObject({ 'x.id': 'B', 'x.antes': 'antes' })
      finish(runner, 'run-2', 'succeeded')
      await flush()
      v = runner.view(id)
      expect(v).toMatchObject({ status: 'waiting_gate', currentStep: 'push' })
      expect(notifications).toContain('Um fluxo espera você')
      await runner.approveGate(id) // fez o push à mão
      expect(runner.view(id)).toMatchObject({ status: 'finished', result: 'done' })
    })

    it('extrator que falha pausa o fluxo com a mensagem', async () => {
      const runner = alvaRunner()
      const { id } = await runner.startManual('p1', 't1')
      finish(runner, 'run-1', 'succeeded', 'nada')
      await flush()
      expect(runner.view(id)).toMatchObject({ status: 'paused', pauseReason: 'step_failed' })
      expect(runner.view(id).history[0]).toMatchObject({
        status: 'failed',
        message: 'Nada foi criado.'
      })
    })

    it('recusar a ação pendente cancela o fluxo', async () => {
      const runner = alvaRunner()
      const { id } = await runner.startManual('p1', 't1')
      finish(runner, 'run-1', 'succeeded', 'A')
      await flush()
      finish(runner, 'run-2', 'succeeded')
      await flush()
      await runner.rejectGate(id)
      expect(runner.view(id)).toMatchObject({ status: 'cancelled' })
    })

    it('limite por projeto: o segundo fluxo Alva espera vaga e começa sozinho', async () => {
      const runner = alvaRunner({ concurrencyLimit: () => 1 })
      const first = await runner.startManual('p1', 't1')
      const second = await runner.startManual('p1', 't2')
      expect(runner.view(second.id)).toMatchObject({
        status: 'paused',
        pauseReason: 'waiting_slot'
      })
      expect(started).toHaveLength(1)
      await runner.cancel(first.id)
      await flush()
      expect(runner.view(second.id).status).toBe('running')
      expect(started).toHaveLength(2)
    })
  })

  describe('5C: ações com confirmação e modo entrega', () => {
    const DELIVER: Flow = {
      id: 'd',
      name: 'Entregar',
      steps: [
        {
          id: 'pr',
          name: 'PR',
          type: 'claude_command',
          command: 'alva-flow:pr',
          args: 'x',
          timeoutMin: 10,
          delivery: true
        },
        {
          id: 'depois',
          name: 'Depois',
          type: 'claude_command',
          command: 'revisar',
          args: 'x',
          timeoutMin: 10
        },
        { id: 'push', name: 'Push', type: 'orkio_action', action: 'push' },
        { id: 'review', name: 'Review', type: 'orkio_action', action: 'request_review' }
      ]
    }
    let pushes: number
    let reviewInput: string[] | undefined
    let pushProblem: string | null
    const PUSH = {
      id: 'push',
      label: 'Push',
      confirm: async () =>
        pushProblem
          ? { problem: pushProblem }
          : {
              title: 'Enviar?',
              message: 'm',
              details: [{ label: 'Destino', value: 'origin → ORK-1/x' }],
              commits: [{ hash: 'abc', subject: 'feat' }],
              stat: '1 file',
              approveLabel: 'Fazer push',
              link: null
            },
      run: async () => {
        pushes++
        return { ok: true as const, vars: { 'delivery.pushed': 'sim' } }
      }
    }
    const REVIEW = {
      id: 'request_review',
      label: 'Review',
      confirm: async () => ({
        title: 'Pedir review?',
        message: 'm',
        details: [],
        input: { label: 'Revisores', options: ['ana', 'bia'], selected: ['ana'], allowOther: true },
        approveLabel: 'Pedir review',
        link: null
      }),
      run: async ({ input }: { input?: string[] }) => {
        reviewInput = input
        return { ok: true as const }
      }
    }

    function deliveryRunner(over: Partial<FlowRunnerDeps> = {}): FlowRunner {
      pushes = 0
      reviewInput = undefined
      pushProblem = null
      config = {
        flows: [DELIVER],
        bindings: [{ stageId: 's-rev', flowId: 'd', enabled: true, mode: 'manual' }]
      }
      return makeRunner({ actions: [PUSH, REVIEW], ...over })
    }

    it('modo entrega só no passo marcado; push espera a confirmação e só então age', async () => {
      const runner = deliveryRunner()
      const { id } = await runner.startManual('p1', 't1')
      expect(started[0]).toMatchObject({ command: 'alva-flow:pr', delivery: true })
      finish(runner, 'run-1', 'succeeded')
      await flush()
      expect(started[1]).toMatchObject({ command: 'revisar', delivery: false })
      finish(runner, 'run-2', 'succeeded')
      await flush()
      let v = runner.view(id)
      expect(v).toMatchObject({ status: 'waiting_gate', currentStep: 'push' })
      expect(v.confirm).toMatchObject({ title: 'Enviar?', commits: [{ hash: 'abc' }] })
      expect(pushes).toBe(0)
      expect(notifications).toContain('Um fluxo espera sua aprovação')
      await runner.approveGate(id)
      expect(pushes).toBe(1)
      v = runner.view(id)
      expect(v).toMatchObject({ status: 'waiting_gate', currentStep: 'review' })
      expect(v.vars).toMatchObject({ 'delivery.pushed': 'sim' })
      await runner.approveGate(id, ['bia', 'team:core'])
      expect(reviewInput).toEqual(['bia', 'team:core'])
      expect(runner.view(id)).toMatchObject({ status: 'finished', result: 'done', confirm: null })
      const kinds = store.events('t1').map((e) => e.kind)
      expect(kinds.filter((k) => k === 'gate_approved')).toHaveLength(2)
    })

    it('recusar a confirmação encerra como recusado sem agir; problema na prévia pausa', async () => {
      const runner = deliveryRunner()
      const { id } = await runner.startManual('p1', 't1')
      finish(runner, 'run-1', 'succeeded')
      await flush()
      finish(runner, 'run-2', 'succeeded')
      await flush()
      await runner.rejectGate(id)
      expect(pushes).toBe(0)
      expect(runner.view(id)).toMatchObject({ status: 'finished', result: 'rejected' })

      const r2 = deliveryRunner({ newId: () => 'fr-b' })
      pushProblem = 'Não há commits novos para enviar.'
      await r2.startManual('p1', 't1')
      finish(r2, 'run-3', 'succeeded')
      await flush()
      finish(r2, 'run-4', 'succeeded')
      await flush()
      expect(r2.view('fr-b')).toMatchObject({ status: 'paused', pauseReason: 'step_failed' })
      expect(r2.view('fr-b').history.at(-1)).toMatchObject({
        stepId: 'push',
        status: 'failed',
        message: 'Não há commits novos para enviar.'
      })
      // Resolvido o problema, "Retomar" prepara de novo e pede a confirmação.
      pushProblem = null
      await r2.resume('fr-b')
      expect(r2.view('fr-b')).toMatchObject({ status: 'waiting_gate', currentStep: 'push' })
    })

    it('PR aberta pelo passo move a tarefa (automação): o fluxo segue sem acompanhar a etapa', async () => {
      config = {
        flows: [DELIVER],
        bindings: [{ stageId: 's-rev', flowId: 'd', enabled: true, mode: 'on_enter' }]
      }
      const runner = makeRunner({ actions: [PUSH, REVIEW] })
      enter(runner, 'manual')
      await flush()
      await flush()
      const id = 'fr-1'
      expect(runner.view(id)).toMatchObject({ status: 'running', currentStep: 'pr' })
      runner.onStageChanged({
        projectId: 'p1',
        taskId: 't1',
        from: 's-rev',
        to: 's-revisando',
        source: 'automation'
      })
      await flush()
      expect(runner.view(id).status).toBe('running')
      finish(runner, 'run-1', 'succeeded')
      await flush()
      expect(runner.view(id)).toMatchObject({ status: 'running', currentStep: 'depois' })
    })

    it('reabrir o app com a confirmação aberta: continua esperando, com o que mostrar', async () => {
      const runner = deliveryRunner()
      const { id } = await runner.startManual('p1', 't1')
      finish(runner, 'run-1', 'succeeded')
      await flush()
      finish(runner, 'run-2', 'succeeded')
      await flush()
      runner.dispose()
      const r2 = makeRunner({ actions: [PUSH, REVIEW] })
      r2.init()
      expect(r2.view(id)).toMatchObject({ status: 'waiting_gate', confirm: { title: 'Enviar?' } })
      await r2.approveGate(id)
      expect(pushes).toBe(1)
    })
  })
})
