import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Flow, ProjectFlows } from '../../shared/task-flow'
import { defaultAgent, type AgentProfile } from '../../shared/agent'
import { builtinAgent } from '../../shared/agent-presets'
import { ORKIO_SITE_TIMEOUT_MESSAGE } from '../connectors/github/github.connector'
import { ReviewPostError } from '../connectors/github/review-poster'
import { createPublishReviewAction } from '../delivery/review-publish'
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
  type FlowRunnerDeps,
  type OrkioAction
} from './flow-runner'
import { ORKIO_ACTIONS } from '../../shared/orkio-actions'
import type { FlowIntegration } from './flow-integration'

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

/** Integração de teste (marcador `x`, variáveis `x.*`). */
function integration(over: Partial<FlowIntegration> = {}): FlowIntegration {
  return {
    tag: 'x',
    varPrefix: 'x.',
    missingVar: { code: 'x_missing', message: 'Falta a variável da integração x.' },
    initialVars: async () => ({}),
    canStart: async () => null,
    concurrencyLimit: () => null,
    ...over
  }
}

/**
 * Espera o runner terminar o que os gatilhos sem promessa (`onRunFinished`, `onStageChanged`)
 * deixaram em andamento: roda os `setImmediate` (falsos) e as promessas até nada mais ficar
 * pendente, sem depender de quantos saltos assíncronos o runner dá.
 */
const flush = async (): Promise<void> => {
  await vi.runAllTimersAsync()
}

let db: Db
let store: BoardStore
let started: {
  runId: string
  command: string
  args: string
  briefing: string
  includeBriefing?: boolean
  delivery?: boolean
  agent?: {
    key: string
    name: string
    prompt: string
    model: string | null
    effort?: string | null
  } | null
  reply?: string
  prompt?: string
  readOnly?: boolean
  runtime?: { model?: string | null; effort?: string | null }
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
    // O pedido (`RunRequest`) achatado para as asserções: comando/args, briefing da sessão nova,
    // resposta (continua a sessão, sem sessão nova) ou pedido em texto (continua ou começa).
    startClaude: async (req) => {
      const runId = `run-${started.length + 1}`
      const s = req.session
      const fresh = s.kind === 'new' ? s : s.kind === 'latest' ? s.orNew : null
      const text = req.input.kind === 'prompt' ? req.input.text : null
      started.push({
        runId,
        command: req.input.kind === 'command' ? req.input.name : '',
        args: req.input.kind === 'command' ? req.input.args : '',
        briefing: fresh?.briefing ?? '',
        ...(fresh ? { includeBriefing: fresh.includeBriefing } : {}),
        delivery: req.access.github === 'deliver',
        agent: req.agent,
        ...(text !== null && s.kind === 'latest' && !s.orNew ? { reply: text } : {}),
        ...(text !== null && s.kind === 'latest' && s.orNew ? { prompt: text } : {}),
        ...(req.access.tools === 'read_only' ? { readOnly: true } : {}),
        ...(req.runtime !== null ? { runtime: req.runtime } : {})
      })
      return runId
    },
    cancelClaude: (id) => cancelled.push(id),
    extractors: [ORKIO_LINES_EXTRACTOR],
    actions: [NOOP_ACTION],
    notify: (title) => notifications.push(title),
    emit: () => undefined,
    enterStage: () => undefined,
    worktreePath: () => null,
    integrations: [],
    agentFor: async () => null,
    agentLimit: () => null,
    onFinished: () => undefined,
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
    message: status === 'failed' ? 'Deu ruim' : null,
    code: status === 'failed' ? 'claude_error' : status === 'cancelled' ? 'cancelled' : null
  })

const enter = (runner: FlowRunner, source: StageChange['source'], to = 's-rev'): void =>
  runner.onStageChanged({ projectId: 'p1', taskId: 't1', from: 's-dev', to, source })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setImmediate'] })
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
afterEach(() => {
  vi.useRealTimers()
  db.close()
})

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
    await runner.cancel(runner.list('t1')[0]!.id)
    const other = makeRunner({ newId: () => 'fr-other' })
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

  it('"Passo feito" (Continuar no Claude): o comando parado conta como certo e o fluxo segue', async () => {
    const runner = makeRunner()
    const { id } = await runner.startManual('p1', 't1')
    expect(runner.activeFor('t1')).toEqual({ id, status: 'running', claudeStep: true })
    // Só com o passo parado: rodando, é recusado.
    await expect(runner.completeByYou(id)).rejects.toBeInstanceOf(FlowError)
    finish(runner, 'run-1', 'cancelled')
    await flush()
    expect(runner.activeFor('t1')).toMatchObject({ status: 'paused', claudeStep: true })
    await runner.completeByYou(id)
    const v = runner.view(id)
    expect(v.status).toBe('waiting_gate')
    expect(v.history.map((h) => h.status)).toEqual(['ok', 'waiting'])
    expect(v.history[0]?.message).toBe(FLOW_MESSAGES.doneByYou)
    expect(started).toHaveLength(1) // o Claude não rodou de novo
    // No gate (não é comando do Claude Code): "Passo feito" não vale.
    await expect(runner.completeByYou(id)).rejects.toBeInstanceOf(FlowError)
    expect(runner.activeFor('t1')).toMatchObject({ status: 'waiting_gate', claudeStep: false })
  })

  it('"Responder e continuar": o passo parado segue na mesma sessão com a sua resposta (uma vez só)', async () => {
    const runner = makeRunner()
    const { id } = await runner.startManual('p1', 't1')
    finish(runner, 'run-1', 'failed')
    await flush()
    await expect(runner.resumeWithReply(id, '   ')).rejects.toThrow(/Escreva a resposta/)
    expect(started).toHaveLength(1)

    await runner.resumeWithReply(id, ' Formato: CSV; só admins ')
    expect(started).toHaveLength(2)
    // A resposta vai como texto na sessão do passo (o comando não roda de novo).
    expect(started[1]).toMatchObject({ command: '', reply: 'Formato: CSV; só admins' })
    expect(runner.view(id)).toMatchObject({ status: 'running', currentStep: 'revisar' })

    // Falhou de novo: "Retomar" roda o comando de verdade, sem reenviar a resposta.
    finish(runner, 'run-2', 'failed')
    await flush()
    await runner.resume(id)
    expect(started[2]!.reply).toBeUndefined()

    // A resposta bem-sucedida segue o fluxo para o próximo passo.
    finish(runner, 'run-3', 'failed')
    await flush()
    await runner.resumeWithReply(id, 'agora sim')
    finish(runner, 'run-4', 'succeeded', 'ok')
    await flush()
    expect(runner.view(id).status).toBe('waiting_gate')
  })

  it('modelo/raciocínio do passo vão em runtime (também em "Responder e continuar"); sem eles, sem runtime', async () => {
    const first = FLOW.steps[0] as Extract<Flow['steps'][number], { type: 'claude_command' }>
    config = {
      ...config,
      flows: [
        { ...FLOW, steps: [{ ...first, model: 'opus', effort: 'low' }, ...FLOW.steps.slice(1)] }
      ]
    }
    const runner = makeRunner()
    const { id } = await runner.startManual('p1', 't1')
    expect(started[0]!.runtime).toEqual({ model: 'opus', effort: 'low' })
    finish(runner, 'run-1', 'failed')
    await flush()
    await runner.resumeWithReply(id, 'segue')
    expect(started[1]).toMatchObject({ reply: 'segue', runtime: { model: 'opus', effort: 'low' } })

    started.length = 0
    config = { ...config, flows: [FLOW] }
    await runner.cancel(id)
    await makeRunner({ newId: () => 'fr-other' }).startManual('p1', 't1')
    expect(started[0]).not.toHaveProperty('runtime')
  })

  it('isBusy: passo rodando bloqueia a mensagem da sessão; pausa por falha e gate liberam', async () => {
    const runner = makeRunner()
    const { id } = await runner.startManual('p1', 't1')
    expect(runner.isBusy('t1')).toBe(true)
    finish(runner, 'run-1', 'failed')
    await flush()
    expect(runner.view(id).status).toBe('paused')
    expect(runner.isBusy('t1')).toBe(false) // dá para responder ao Claude pelo campo da sessão
  })

  it('"Responder e continuar" só com o fluxo pausado num comando do Claude Code', async () => {
    const runner = makeRunner()
    const { id } = await runner.startManual('p1', 't1')
    // Rodando: não pode.
    await expect(runner.resumeWithReply(id, 'oi')).rejects.toThrow()
    expect(started).toHaveLength(1)
  })

  it('mensagem da sessão e "Responder e continuar" decidem igual: pausa por limite de passos volta ao passo', async () => {
    const runner = makeRunner()
    const { id } = await runner.startManual('p1', 't1')
    finish(runner, 'run-1', 'failed')
    await flush()
    // Antes, só falha/interrupção voltavam ao fluxo: a mensagem escapava para uma execução avulsa.
    db.run(`UPDATE flow_runs SET pause_reason = 'loop_guard' WHERE id = ?`, id)
    expect(await runner.handleMessage('t1', 'pode seguir')).toBe('reply')
    expect(started[1]).toMatchObject({ command: '', reply: 'pode seguir' })
    expect(runner.view(id)).toMatchObject({ status: 'running', currentStep: 'revisar' })
  })

  it('gate expirado: nem a mensagem nem "Responder e continuar" voltam ao passo (gate não tem sessão)', async () => {
    const runner = makeRunner()
    const { id } = await runner.startManual('p1', 't1')
    finish(runner, 'run-1', 'succeeded')
    await flush()
    expect(runner.view(id).currentStep).toBe('ok')
    db.run(`UPDATE flow_runs SET status = 'paused', pause_reason = 'gate_timeout' WHERE id = ?`, id)
    expect(await runner.handleMessage('t1', 'oi')).toBeNull()
    await expect(runner.resumeWithReply(id, 'oi')).rejects.toMatchObject({ code: 'wrong_state' })
  })

  it('comando com variável de uma integração sem valor não roda: pausa com a falha dela, sem gastar uma execução', async () => {
    config = {
      flows: [
        {
          id: 'f-x',
          name: 'X',
          steps: [
            {
              id: 'plan',
              name: 'Planejar',
              type: 'claude_command',
              command: 'x:plan',
              args: '{{x.task_id}}',
              timeoutMin: 5
            }
          ]
        }
      ],
      bindings: []
    }
    const runner = makeRunner({ integrations: [integration()] })
    const { id } = await runner.startById('p1', 't1', 'f-x')
    await flush()
    expect(started).toHaveLength(0) // o Claude Code nem começou
    const v = runner.view(id)
    expect(v).toMatchObject({ status: 'paused', pauseReason: 'step_failed', currentStep: 'plan' })
    expect(v.history[0]).toMatchObject({
      status: 'failed',
      code: 'x_missing',
      message: 'Falta a variável da integração x.'
    })
  })

  it('variável da integração com valor (das variáveis iniciais dela) roda normalmente', async () => {
    config = {
      flows: [
        {
          id: 'f-x',
          name: 'X',
          tags: ['x'],
          steps: [
            {
              id: 'plan',
              name: 'Planejar',
              type: 'claude_command',
              command: 'x:plan',
              args: '{{x.task_id}}',
              timeoutMin: 5
            }
          ]
        }
      ],
      bindings: []
    }
    const runner = makeRunner({
      integrations: [integration({ initialVars: async () => ({ 'x.task_id': 'TASK-7' }) })]
    })
    await runner.startById('p1', 't1', 'f-x')
    await flush()
    expect(started.map((s) => s.args)).toEqual(['TASK-7'])
  })

  it('startBuiltin roda um fluxo que não está na config, com a cópia, e recusa com fluxo ativo', async () => {
    const builtin: Flow = {
      id: 'builtin:x',
      name: 'Do app',
      steps: [
        {
          id: 'c',
          name: 'C',
          type: 'claude_command',
          command: 'revisar',
          args: 'a',
          timeoutMin: 5
        }
      ]
    }
    const runner = makeRunner()
    const view = await runner.startBuiltin('p1', 't1', builtin)
    await flush()
    expect(view.flowName).toBe('Do app')
    expect(started.map((s) => s.command)).toEqual(['revisar'])
    const row = db.get<{ flow_json: string; stage_id: string | null }>(
      'SELECT flow_json, stage_id FROM flow_runs WHERE id = ?',
      view.id
    )
    expect(JSON.parse(row!.flow_json)).toMatchObject({ id: 'builtin:x' })
    expect(row!.stage_id).toBeNull()
    await expect(runner.startBuiltin('p1', 't1', builtin)).rejects.toMatchObject({ code: 'busy' })
  })

  it('rodar de novo um passo anterior: volta ao comando e segue dali (só em falha)', async () => {
    const runner = makeRunner()
    const { id } = await runner.startManual('p1', 't1')
    // Sem falha ainda: não há o que refazer.
    await expect(runner.rerunFrom(id, 'revisar')).rejects.toMatchObject({ code: 'wrong_state' })
    finish(runner, 'run-1', 'succeeded')
    await flush()
    await runner.approveGate(id)
    await flush()
    finish(runner, 'run-2', 'failed') // 'entregar' falha
    await flush()
    expect(runner.view(id)).toMatchObject({ status: 'paused', currentStep: 'entregar' })

    // Só comandos do Claude Code antes do passo parado: nem gate, nem passo à frente, nem o mesmo.
    await expect(runner.rerunFrom(id, 'ok')).rejects.toMatchObject({ code: 'invalid_step' })
    await expect(runner.rerunFrom(id, 'fim')).rejects.toMatchObject({ code: 'invalid_step' })
    await expect(runner.rerunFrom(id, 'entregar')).rejects.toMatchObject({ code: 'invalid_step' })
    await expect(runner.rerunFrom(id, 'nao-existe')).rejects.toMatchObject({ code: 'invalid_step' })

    await runner.rerunFrom(id, 'revisar')
    expect(started).toHaveLength(3)
    expect(started[2]!.command).toBe('revisar')
    const v = runner.view(id)
    expect(v).toMatchObject({ status: 'running', currentStep: 'revisar', pauseReason: null })
    // O histórico mantém a falha de 'entregar' como aconteceu.
    expect(v.history.map((h) => [h.stepId, h.status])).toEqual([
      ['revisar', 'ok'],
      ['ok', 'approved'],
      ['entregar', 'failed'],
      ['revisar', 'running']
    ])
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
    expect(runner.activeViews().map((v) => [v.taskId, v.status])).toEqual([['t1', 'running']])
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
          ? { fail: { code: 'nada', message: 'Nada foi criado.' } }
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
      tags: ['x'],
      steps: [
        {
          id: 'spec',
          name: 'Spec',
          type: 'claude_command',
          command: 'alva-flow:spec',
          args: '{{x.spec_arg}}',
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
    const PUSH = { ...NOOP_ACTION, id: 'push' }

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
        integrations: [
          integration({ initialVars: async () => ({ 'x.spec_arg': 'ORK-1 — Exportar CSV' }) })
        ],
        ...over
      })
    }

    it('variáveis iniciais, sem briefing nos argumentos e escolha pedida pelo extrator', async () => {
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
      expect(v).toMatchObject({ status: 'finished', result: 'done' })
    })

    it('mensagem com anexo: a nota não entra no casamento da escolha', async () => {
      const runner = alvaRunner()
      await runner.startManual('p1', 't1')
      finish(runner, 'run-1', 'succeeded', 'varias')
      await flush()
      const note =
        '\n\nAnexos (leia com a ferramenta Read): .orkio/attachments/ab12cd34-a.md, x-b.md'
      // A nota cita "a" e "b" (as opções): sem ela a mensagem é ambígua, com ela não pode mudar nada.
      await expect(runner.handleMessage('t1', 'sei lá', note)).rejects.toThrow()
      expect(await runner.handleMessage('t1', 'escolho B', note)).toBe('choice')
      expect(started[1]).toMatchObject({ args: 'B Exportar CSV' })
    })

    it('extrator que falha pausa o fluxo com a mensagem', async () => {
      const runner = alvaRunner()
      const { id } = await runner.startManual('p1', 't1')
      finish(runner, 'run-1', 'succeeded', 'nada')
      await flush()
      expect(runner.view(id)).toMatchObject({ status: 'paused', pauseReason: 'step_failed' })
      expect(runner.view(id).history[0]).toMatchObject({
        status: 'failed',
        code: 'nada',
        message: 'Nada foi criado.'
      })
    })

    it('a integração impede o começo: nada é criado e a mensagem dela sobe', async () => {
      const runner = alvaRunner({
        integrations: [integration({ canStart: async () => 'Projeto não pronto.' })]
      })
      await expect(runner.startManual('p1', 't1')).rejects.toThrow('Projeto não pronto.')
      expect(runner.list('t1')).toEqual([])
    })

    it('limite por projeto: o segundo fluxo da integração espera vaga e começa sozinho', async () => {
      const runner = alvaRunner({
        integrations: [
          integration({
            initialVars: async () => ({ 'x.spec_arg': 'ORK-1' }),
            concurrencyLimit: () => 1
          })
        ]
      })
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
    const PUSH: OrkioAction = {
      ...ORKIO_ACTIONS.push,
      label: 'Push',
      confirm: async () =>
        pushProblem
          ? { problem: { code: 'dirty', message: pushProblem } }
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
        return { ok: true as const }
      }
    }
    const REVIEW: OrkioAction = {
      ...ORKIO_ACTIONS.request_review,
      label: 'Review',
      confirm: async () => ({
        title: 'Pedir review?',
        message: 'm',
        details: [],
        input: { label: 'Revisores', options: ['ana', 'bia'], selected: ['ana'], allowOther: true },
        approveLabel: 'Pedir review',
        link: null
      }),
      run: async ({ input }) => {
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

    it('ação que muda a etapa de propósito (detach_and_reenter): ao terminar, o fluxo da coluna nova começa', async () => {
      // Caso real: revisão do orkio[bot] com "Pedir alterações" → regra move para Revisado durante
      // o passo → ao terminar, o "comentários da PR" (ligado a Revisado) tem que começar.
      let runner: FlowRunner | null = null
      const MOVES: OrkioAction = {
        id: 'muda_etapa',
        label: 'Muda a etapa',
        delivers: false,
        onStageMoved: 'detach_and_reenter',
        phase: null,
        outputs: [],
        run: async () => {
          stage = 's-revisado'
          runner!.onStageChanged({
            projectId: 'p1',
            taskId: 't1',
            from: 's-rev',
            to: 's-revisado',
            source: 'automation'
          })
          await flush()
          return { ok: true as const }
        }
      }
      config = {
        flows: [
          {
            id: 'd',
            name: 'Revisão publicada',
            steps: [{ id: 'pub', name: 'Publicar', type: 'orkio_action', action: 'muda_etapa' }]
          },
          { id: 'c', name: 'Comentários', steps: [DELIVER.steps[1]!] }
        ],
        bindings: [
          { stageId: 's-rev', flowId: 'd', enabled: true, mode: 'on_enter' },
          { stageId: 's-revisado', flowId: 'c', enabled: true, mode: 'on_enter' }
        ]
      }
      const entered: StageChange[] = []
      runner = makeRunner({
        actions: [MOVES],
        enterStage: (change) => {
          entered.push(change)
          runner!.onStageChanged(change)
        }
      })
      enter(runner, 'manual')
      await flush()
      expect(runner.view('fr-1')).toMatchObject({ status: 'finished', result: 'done' })
      expect(entered).toEqual([
        { projectId: 'p1', taskId: 't1', from: 's-rev', to: 's-revisado', source: 'automation' }
      ])
      expect(started.map((s) => s.command)).toEqual(['revisar'])
      expect(runner.view('fr-2')).toMatchObject({ flowId: 'c', status: 'running' })
    })

    it('outros passos de entrega (/pr → Revisando) não disparam a coluna nova ao terminar', async () => {
      config = {
        flows: [{ id: 'd', name: 'Entregar', steps: [DELIVER.steps[0]!] }],
        bindings: [
          { stageId: 's-rev', flowId: 'd', enabled: true, mode: 'on_enter' },
          { stageId: 's-revisando', flowId: 'd', enabled: true, mode: 'on_enter' }
        ]
      }
      const entered: StageChange[] = []
      const runner = makeRunner({ enterStage: (c) => void entered.push(c) })
      enter(runner, 'manual')
      await flush()
      stage = 's-revisando'
      runner.onStageChanged({
        projectId: 'p1',
        taskId: 't1',
        from: 's-rev',
        to: 's-revisando',
        source: 'automation'
      })
      await flush()
      finish(runner, 'run-1', 'succeeded')
      await flush()
      expect(runner.view('fr-1')).toMatchObject({ status: 'finished', result: 'done' })
      expect(entered).toEqual([])
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

describe('FlowRunner: publicar revisão como orkio[bot] (Task 18)', () => {
  const PUBLISH_FLOW: Flow = {
    id: 'rp',
    name: 'Revisão publicada',
    steps: [
      {
        id: 'json',
        name: 'Converter',
        type: 'claude_command',
        command: '',
        args: '',
        prompt: 'Converta a revisão acima',
        readOnly: true,
        timeoutMin: 15
      },
      { id: 'publicar', name: 'Publicar', type: 'orkio_action', action: 'publish_review' }
    ]
  }
  const ANSWER =
    '```json\n' +
    JSON.stringify({
      event: 'REQUEST_CHANGES',
      summary: 'Falta validar a entrada.',
      comments: [
        { path: 'src/a.ts', line: 3, body: 'Valide aqui.' },
        { path: 'README.md', line: 40, body: 'Fora do diff.' }
      ]
    }) +
    '\n```'
  let posts: { owner: string; repo: string; number: number; review: unknown }[]
  let postError: Error | null
  let readRuns: string[]

  function publishRunner(over: Partial<FlowRunnerDeps> = {}): FlowRunner {
    posts = []
    postError = null
    readRuns = []
    config = {
      flows: [PUBLISH_FLOW],
      bindings: [{ stageId: 's-rev', flowId: 'rp', enabled: true, mode: 'manual' }]
    }
    const action = createPublishReviewAction({
      poster: {
        isConfigured: () => true,
        diffLines: async () => new Map([['src/a.ts', new Set([3])]]),
        postReview: async (owner, repo, number, review) => {
          if (postError) throw postError
          posts.push({ owner, repo, number, review })
          return { url: 'https://github.com/acme/app/pull/7#pullrequestreview-99' }
        }
      },
      finalText: async (runId) => {
        readRuns.push(runId)
        return ANSWER
      },
      signals: async () => ({
        ok: true,
        value: {
          signals: {
            t1: { pr: { number: 7, state: 'open', url: 'https://github.com/acme/app/pull/7' } }
          }
        } as never
      }),
      repo: () => ({ owner: 'acme', repo: 'app' }),
      store
    })
    return makeRunner({ actions: [NOOP_ACTION, action], ...over })
  }

  it('o gate mostra a revisão (lida da última execução); aprovar publica sem os fora do diff', async () => {
    const runner = publishRunner()
    const { id } = await runner.startManual('p1', 't1')
    expect(started[0]).toMatchObject({ prompt: 'Converta a revisão acima', readOnly: true })
    finish(runner, 'run-1', 'succeeded', ANSWER)
    await flush()
    const v = runner.view(id)
    expect(v).toMatchObject({ status: 'waiting_gate', currentStep: 'publicar' })
    expect(readRuns).toEqual(['run-1'])
    expect(v.confirm?.review).toEqual({
      event: 'REQUEST_CHANGES',
      summary: 'Falta validar a entrada.',
      comments: [
        { path: 'src/a.ts', line: 3, body: 'Valide aqui.', inDiff: true },
        { path: 'README.md', line: 40, body: 'Fora do diff.', inDiff: false }
      ],
      pr: { owner: 'acme', repo: 'app', number: 7 }
    })
    expect(posts).toEqual([]) // nada antes de aprovar
    await runner.approveGate(id)
    expect(posts).toEqual([
      {
        owner: 'acme',
        repo: 'app',
        number: 7,
        review: {
          event: 'REQUEST_CHANGES',
          body: 'Falta validar a entrada.',
          comments: [{ path: 'src/a.ts', line: 3, body: 'Valide aqui.' }]
        }
      }
    ])
    expect(runner.view(id)).toMatchObject({ status: 'finished', result: 'done' })
    const delivery = store.events('t1').find((e) => e.kind === 'delivery')
    expect(delivery?.detail).toMatchObject({
      by: 'orkio',
      action: 'review_post',
      reviewEvent: 'REQUEST_CHANGES',
      reviewId: 99,
      pr: { number: 7, owner: 'acme', repo: 'app' }
    })
  })

  it('timeout do site: falha dizendo que pode ter publicado; Retomar pede a confirmação de novo', async () => {
    const runner = publishRunner()
    const { id } = await runner.startManual('p1', 't1')
    finish(runner, 'run-1', 'succeeded', ANSWER)
    await flush()
    postError = new ReviewPostError('site_timeout', ORKIO_SITE_TIMEOUT_MESSAGE)
    await runner.approveGate(id)
    const v = runner.view(id)
    expect(v).toMatchObject({ status: 'paused', pauseReason: 'step_failed' })
    expect(v.history.at(-1)?.message).toContain('a revisão pode ter sido publicada')
    postError = null
    await runner.resume(id)
    const again = runner.view(id)
    expect(again).toMatchObject({ status: 'waiting_gate', currentStep: 'publicar' })
    expect(again.confirm?.warning).toMatch(/pode já estar na PR/)
    expect(posts).toEqual([]) // nada foi reenviado sem você aprovar
    await runner.approveGate(id)
    expect(posts).toHaveLength(1)
  })

  it('o texto da revisão sai do banco ao cancelar, ao sair da etapa e cancelar, e ao concluir', async () => {
    const state = (id: string): string =>
      db.get<{ state_json: string }>('SELECT state_json FROM flow_runs WHERE id = ?', id)!
        .state_json
    const runner = publishRunner()
    const a = await runner.startManual('p1', 't1')
    finish(runner, 'run-1', 'succeeded', ANSWER)
    await flush()
    expect(state(a.id)).toContain('Falta validar a entrada.')
    await runner.cancel(a.id)
    expect(state(a.id)).not.toContain('Falta validar')

    // Tarefa saiu da etapa com o gate aberto → "Cancelar".
    config = {
      flows: [PUBLISH_FLOW],
      bindings: [{ stageId: 's-rev', flowId: 'rp', enabled: true, mode: 'on_enter' }]
    }
    const r2 = publishRunner({ newId: () => 'fr-left' })
    config = {
      flows: [PUBLISH_FLOW],
      bindings: [{ stageId: 's-rev', flowId: 'rp', enabled: true, mode: 'on_enter' }]
    }
    enter(r2, 'manual')
    await flush()
    finish(r2, `run-${started.length}`, 'succeeded', ANSWER)
    await flush()
    expect(r2.view('fr-left').status).toBe('waiting_gate')
    r2.onStageChanged({
      projectId: 'p1',
      taskId: 't1',
      from: 's-rev',
      to: 's-ok',
      source: 'manual'
    })
    await flush()
    expect(r2.view('fr-left').status).toBe('awaiting_decision')
    await r2.decideLeft('fr-left', 'cancel')
    expect(state('fr-left')).not.toContain('Falta validar')

    // Concluído (aprovado e publicado).
    const r3 = publishRunner({ newId: () => 'fr-ok' })
    await r3.startManual('p1', 't1')
    finish(r3, `run-${started.length}`, 'succeeded', ANSWER)
    await flush()
    await r3.approveGate('fr-ok')
    expect(r3.view('fr-ok').status).toBe('finished')
    expect(state('fr-ok')).not.toContain('Falta validar')
  })

  it('não instalado: falha com o link de instalação e nada é publicado', async () => {
    const runner = publishRunner()
    const { id } = await runner.startManual('p1', 't1')
    finish(runner, 'run-1', 'succeeded', ANSWER)
    await flush()
    postError = new ReviewPostError('not_installed', 'x', {
      installUrl: 'https://github.com/apps/orkio/installations/new'
    })
    await runner.approveGate(id)
    const failed = runner.view(id).history.at(-1)
    expect(failed?.message).toContain('não está instalado')
    // O link vai num campo próprio do passo (a tela de problema não procura no texto).
    expect(failed?.link).toBe('https://github.com/apps/orkio/installations/new')
    expect(posts).toEqual([])
  })

  it('o agente Revisor (sem entrega) pode rodar o fluxo de publicar revisão', async () => {
    const revisor = builtinAgent('revisor')!
    expect(revisor.delivery).toBe(false)
    const runner = publishRunner({
      agentFor: async () => ({ key: 'builtin:revisor', profile: revisor })
    })
    const view = await runner.startManual('p1', 't1')
    expect(view.status).toBe('running')
    expect(started[0]?.agent).toMatchObject({ key: 'builtin:revisor' })
  })
})

describe('FlowRunner com agentes (8A)', () => {
  const ANA: AgentProfile = defaultAgent({
    id: 'ana',
    name: 'Ana',
    model: 'sonnet',
    instructions: 'Testes sempre. Nunca mexa em migrations sem perguntar.'
  })
  const OUTRO: Flow = { ...FLOW, id: 'f2', name: 'Fluxo da Ana' }
  let agents: Record<string, { key: string; profile: AgentProfile } | Error>
  let limit: string | null
  const agentRunner = (): FlowRunner =>
    makeRunner({
      agentFor: async (_p, taskId) => {
        const a = agents[taskId]
        if (a instanceof Error) throw new FlowError('agent', a.message)
        return a ?? null
      },
      agentLimit: () => limit
    })

  beforeEach(() => {
    agents = { t1: { key: 'repo:ana', profile: ANA } }
    limit = null
    config = { ...config, flows: [FLOW, OUTRO] }
  })

  it('roda com as instruções e o modelo do agente; o briefing continua igual', async () => {
    const runner = agentRunner()
    const view = await runner.startManual('p1', 't1')
    expect(view.agent).toEqual({ key: 'repo:ana', name: 'Ana', color: 'orange' })
    expect(started[0]?.briefing).toBe('# ORK-1')
    expect(started[0]?.agent).toMatchObject({ key: 'repo:ana', name: 'Ana', model: 'sonnet' })
    expect(started[0]?.agent?.prompt).toContain('Nunca mexa em migrations sem perguntar.')
    expect(store.events('t1').find((e) => e.kind === 'flow_started')?.detail).toMatchObject({
      agent: 'Ana',
      agentKey: 'repo:ana'
    })
  })

  it('fluxo preferido do agente substitui o da coluna (se existir no projeto)', async () => {
    agents = { t1: { key: 'repo:ana', profile: { ...ANA, flow: 'f2' } } }
    const runner = agentRunner()
    expect((await runner.startManual('p1', 't1')).flowName).toBe('Fluxo da Ana')
    await runner.cancel(runner.list('t1')[0]!.id)
    agents = { t1: { key: 'repo:ana', profile: { ...ANA, flow: 'nao-existe' } } }
    expect((await runner.startManual('p1', 't1')).flowName).toBe('Revisar e entregar')
  })

  it('fluxo escolhido à mão não muda, mas usa as instruções do agente', async () => {
    agents = { t1: { key: 'repo:ana', profile: { ...ANA, flow: 'f2' } } }
    const runner = agentRunner()
    const view = await runner.startById('p1', 't1', 'f1')
    expect(view.flowName).toBe('Revisar e entregar')
    expect(started[0]?.agent?.name).toBe('Ana')
  })

  it('agente com menos permissões: fluxo que entrega ou comando fora da lista não começa', async () => {
    const entrega: Flow = {
      ...FLOW,
      steps: [...FLOW.steps, { id: 'push', name: 'Push', type: 'orkio_action', action: 'push' }]
    }
    config = { ...config, flows: [entrega] }
    agents = { t1: { key: 'repo:ana', profile: { ...ANA, delivery: false } } }
    const runner = agentRunner()
    await expect(runner.startManual('p1', 't1')).rejects.toMatchObject({ code: 'agent_denied' })
    agents = { t1: { key: 'repo:ana', profile: { ...ANA, commands: ['revisar'] } } }
    await expect(runner.startManual('p1', 't1')).rejects.toThrow(/entregar/)
    expect(started).toEqual([])
    expect(runner.list('t1')).toEqual([])
  })

  it('agente que não pode rodar (sem aprovação) impede o fluxo, com a mensagem', async () => {
    agents = { t1: new Error('O perfil deste agente mudou no repositório.') }
    const runner = agentRunner()
    await expect(runner.startManual('p1', 't1')).rejects.toThrow(/mudou no repositório/)
    enter(runner, 'manual')
    await flush()
    expect(notifications).toContain('O fluxo da coluna não começou')
  })

  it('limite de paralelo do agente: a segunda tarefa espera e começa quando a primeira termina', async () => {
    agents = {
      t1: { key: 'repo:ana', profile: ANA },
      t2: { key: 'repo:ana', profile: ANA },
      t3: { key: 'local:bob', profile: { ...ANA, id: 'bob', name: 'Bob' } }
    }
    const runner = agentRunner()
    const a = await runner.startManual('p1', 't1')
    const b = await runner.startManual('p1', 't2')
    const c = await runner.startManual('p1', 't3')
    expect(a.status).toBe('running')
    expect(b).toMatchObject({ status: 'paused', pauseReason: 'waiting_agent' })
    expect(c.status).toBe('running')
    expect(started.map((x) => x.agent?.name)).toEqual(['Ana', 'Bob'])
    await runner.cancel(a.id)
    await flush()
    expect(runner.view(b.id).status).toBe('running')
    expect(started.map((x) => x.agent?.name)).toEqual(['Ana', 'Bob', 'Ana'])
  })

  it('limite diário: pausa antes do comando; "Retomar" passa por cima uma vez', async () => {
    limit = 'Ana atingiu o limite de hoje (40 execuções do Claude Code).'
    const runner = agentRunner()
    const view = await runner.startManual('p1', 't1')
    expect(runner.view(view.id)).toMatchObject({
      status: 'paused',
      pauseReason: 'agent_daily_limit',
      currentStep: 'revisar'
    })
    expect(started).toEqual([])
    expect(notifications).toContain('Um fluxo precisa de você')
    await runner.resume(view.id)
    expect(started).toHaveLength(1)
    finish(runner, 'run-1', 'succeeded')
    await flush()
    await runner.approveGate(view.id)
    // Passou por cima só uma vez: o próximo comando pausa de novo.
    expect(runner.view(view.id).pauseReason).toBe('agent_daily_limit')
    expect(started).toHaveLength(1)
  })

  it('limite diário: a mensagem da sessão responde e segue (passa por cima uma vez, como "Retomar")', async () => {
    limit = 'Ana atingiu o limite de hoje (40 execuções do Claude Code).'
    const runner = agentRunner()
    const view = await runner.startManual('p1', 't1')
    expect(runner.view(view.id).pauseReason).toBe('agent_daily_limit')
    expect(await runner.handleMessage('t1', 'segue mesmo assim')).toBe('reply')
    expect(started).toHaveLength(1)
    expect(started[0]).toMatchObject({ reply: 'segue mesmo assim' })
    expect(runner.view(view.id).status).toBe('running')
  })

  it('editar o agente no meio do fluxo não muda o fluxo em curso (cópia do perfil)', async () => {
    const runner = agentRunner()
    const view = await runner.startManual('p1', 't1')
    agents = {
      t1: { key: 'repo:ana', profile: { ...ANA, name: 'Ana 2', instructions: 'Outra coisa' } }
    }
    finish(runner, 'run-1', 'succeeded')
    await flush()
    await runner.approveGate(view.id)
    expect(started[1]?.agent?.name).toBe('Ana')
    expect(started[1]?.agent?.prompt).toContain('Nunca mexa em migrations')
  })
})

describe('FlowRunner: plano aprovado antes de corrigir (pedido em texto, só leitura, "Pedir ajustes")', () => {
  const REVIEW: Flow = {
    id: 'rev',
    name: 'Comentários da PR',
    steps: [
      { id: 'ler', name: 'Ler', type: 'orkio_action', action: 'snap' },
      {
        id: 'plano',
        name: 'Plano de correções',
        type: 'claude_command',
        command: '',
        args: '',
        prompt: 'Leia .orkio/revisao.md da PR #{{review.pr}} e faça o plano.',
        readOnly: true,
        timeoutMin: 30
      },
      {
        id: 'aprovar',
        name: 'Aprovar correções',
        type: 'gate',
        message: 'Aprovar correções da PR #{{review.pr}}',
        show: 'result',
        onReject: 'stop',
        timeoutMin: null,
        revise: { step: 'plano', max: 2 }
      },
      {
        id: 'aplicar',
        name: 'Aplicar',
        type: 'claude_command',
        command: '',
        args: '',
        prompt: 'Plano aprovado. Aplique.',
        timeoutMin: 60,
        delivery: true
      }
    ]
  }
  const SNAP: OrkioAction = {
    ...NOOP_ACTION,
    id: 'snap',
    label: 'Ler',
    run: async () => ({ ok: true as const, vars: { 'review.count': '2', 'review.pr': '13' } })
  }
  let bodies: string[]
  const reviewRunner = (): FlowRunner =>
    makeRunner({
      actions: [NOOP_ACTION, SNAP],
      notify: (title, body) => {
        notifications.push(title)
        bodies.push(body)
      }
    })

  beforeEach(() => {
    bodies = []
    config = {
      flows: [REVIEW],
      bindings: [{ stageId: 's-rev', flowId: 'rev', enabled: true, mode: 'on_enter' }]
    }
  })

  async function atGate(runner: FlowRunner): Promise<string> {
    const { id } = await runner.startManual('p1', 't1')
    finish(runner, `run-${started.length}`, 'succeeded', '1. Trocar o for por map')
    await flush()
    expect(runner.view(id).status).toBe('waiting_gate')
    return id
  }

  it('o pedido roda em texto (com as variáveis), só leitura; o gate mostra a mensagem com a PR', async () => {
    const runner = reviewRunner()
    const id = await atGate(runner)
    expect(started[0]).toMatchObject({
      command: '',
      args: '',
      prompt: 'Leia .orkio/revisao.md da PR #13 e faça o plano.',
      readOnly: true,
      delivery: false
    })
    const v = runner.view(id)
    expect(v.steps.find((s) => s.id === 'aprovar')).toMatchObject({
      message: 'Aprovar correções da PR #13'
    })
    expect(v.revise).toEqual({ used: 0, max: 2 })
    expect(bodies).toContain('Aprovar correções da PR #13')
  })

  it('reviseGate: guarda o texto (sem segredos), volta ao plano na mesma sessão, conta e limita', async () => {
    const runner = reviewRunner()
    const id = await atGate(runner)
    await expect(runner.reviseGate('t1', '   ')).rejects.toThrow('Escreva o que ajustar.')
    await expect(runner.reviseGate('t1', 'x', 'outro-projeto')).rejects.toThrow(FlowError)

    let v = await runner.reviseGate(
      't1',
      'Não mexa no teste. token ghp_abcdefghijklmnopqrstuvwxyz0123456789',
      'p1'
    )
    expect(v).toMatchObject({ status: 'running', currentStep: 'plano', revise: null })
    expect(started[1]).toMatchObject({ readOnly: true })
    expect(started[1]!.reply).toContain('Não mexa no teste.')
    expect(started[1]!.reply).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz0123456789')
    expect(started[1]!.reply).toContain('Não altere arquivos.')
    expect(v.history.map((h) => [h.stepId, h.status])).toEqual([
      ['ler', 'ok'],
      ['plano', 'ok'],
      ['aprovar', 'revised'],
      ['plano', 'running']
    ])
    expect(store.events('t1').map((e) => e.kind)).toContain('gate_revised')

    // Segunda volta pelo campo da sessão ("mensagem nunca espera").
    finish(runner, 'run-2', 'succeeded', '1. Trocar o for por map (sem mexer no teste)')
    await flush()
    expect(runner.view(id).revise).toEqual({ used: 1, max: 2 })
    expect(await runner.handleMessage('t1', 'Explique o item 1')).toBe('revise')
    expect(started[2]!.reply).toContain('Explique o item 1')
    finish(runner, 'run-3', 'succeeded', 'plano final')
    await flush()
    v = runner.view(id)
    expect(v.revise).toEqual({ used: 2, max: 2 })
    // Limite: recusado, o gate continua esperando.
    await expect(runner.reviseGate('t1', 'mais um')).rejects.toThrow(
      'Limite de ajustes atingido (2). Aprove ou recuse no cartão.'
    )
    // Pelo campo da sessão, a mesma mensagem (o fluxo usa a mensagem e recusa).
    await expect(runner.handleMessage('t1', 'mais um')).rejects.toThrow(
      'Limite de ajustes atingido (2). Aprove ou recuse no cartão.'
    )
    expect(runner.view(id).status).toBe('waiting_gate')
    expect(started).toHaveLength(3)

    // Aprovar segue para aplicar, em modo entrega, sem só leitura.
    await runner.approveGate(id)
    expect(started[3]).toMatchObject({
      prompt: 'Plano aprovado. Aplique.',
      delivery: true
    })
    expect(started[3]!.readOnly).toBeUndefined()
    expect(started[3]!.reply).toBeUndefined()
  })

  it('recusar encerra sem corrigir; gate sem ajustes recusa o pedido', async () => {
    const runner = reviewRunner()
    const id = await atGate(runner)
    await runner.rejectGate(id)
    expect(runner.view(id)).toMatchObject({ status: 'finished', result: 'rejected' })
    expect(started).toHaveLength(1)

    // Gate sem `revise`: a mensagem da sessão não é usada pelo fluxo (vai ao Claude como sempre).
    config = { flows: [FLOW], bindings: config.bindings.map((b) => ({ ...b, flowId: 'f1' })) }
    const plain = makeRunner({ newId: () => 'fr-plain' })
    const other = await plain.startManual('p1', 't1')
    finish(plain, `run-${started.length}`, 'succeeded')
    await flush()
    expect(plain.view(other.id).status).toBe('waiting_gate')
    expect(plain.view(other.id).revise).toBeNull()
    expect(await plain.handleMessage('t1', 'ajuste isso')).toBeNull()
    await expect(plain.reviseGate('t1', 'ajuste isso')).rejects.toThrow(FLOW_MESSAGES.notRevisable)
  })
})
