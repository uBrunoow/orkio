import { describe, expect, it } from 'vitest'
import type { BoardStage } from './board'
import {
  buildRunning,
  costSum,
  finishedCount,
  flowWaitingItem,
  notionWaitingItem,
  prAttention,
  projectCard,
  pullsInWeek,
  requestWaitingItem,
  sortWaiting,
  stageDwell,
  type OverviewTask,
  type StageEventInput
} from './overview'
import type { FlowRunView } from './task-flow'
import type { TaskSignals } from './task-signals'

const task = (taskId = 't1', projectId = 'p1'): OverviewTask => ({
  projectId,
  projectName: 'Orkio',
  taskId,
  displayId: 'ORK-1',
  title: 'Exportar CSV'
})

function flow(over: Partial<FlowRunView> = {}): FlowRunView {
  return {
    id: 'fr1',
    projectId: 'p1',
    taskId: 't1',
    flowId: 'f1',
    flowName: 'Revisar',
    agent: null,
    revise: null,
    steps: [
      {
        id: 'rev',
        name: 'Revisar',
        type: 'claude_command',
        command: 'revisar',
        args: '',
        timeoutMin: 5
      },
      {
        id: 'ok',
        name: 'Aprovar diff',
        type: 'gate',
        message: 'Confira o diff antes do commit. Se ainda houver blocker, recuse e corrija à mão.',
        show: 'diff',
        onReject: 'stop',
        timeoutMin: null
      }
    ],
    status: 'running',
    currentStep: 'rev',
    pauseReason: null,
    result: null,
    startedAt: '2026-11-20T10:00:00.000Z',
    endedAt: null,
    vars: {},
    history: [
      {
        seq: 1,
        stepId: 'rev',
        runId: 'run1',
        status: 'running',
        code: null,
        link: null,
        startedAt: '2026-11-20T10:01:00.000Z',
        endedAt: null,
        message: null,
        costUsd: null
      }
    ],
    choice: null,
    confirm: null,
    ...over
  }
}

const STAGES: BoardStage[] = [
  { id: 's1', name: 'Prioridades', order: 0, notionStatus: { id: 'a', name: 'A' } },
  { id: 's3', name: 'Revisado', order: 2, notionStatus: { id: 'a', name: 'A' } },
  { id: 's2', name: 'Em andamento', order: 1, notionStatus: { id: 'a', name: 'A' } },
  { id: 's4', name: 'Finalizada', order: 3, notionStatus: { id: 'b', name: 'B' } }
]

describe('Esperando você', () => {
  it('gate, ação com confirmação, escolha, saída da etapa e pausa viram itens; vaga e rodando não', () => {
    const gate = flowWaitingItem(flow({ status: 'waiting_gate', currentStep: 'ok' }), task())
    expect(gate).toMatchObject({
      kind: 'gate',
      what: 'Aprovação no fluxo: Aprovar diff',
      section: 'flow'
    })
    expect(gate?.since).toBe('2026-11-20T10:01:00.000Z')
    // Mensagem curta (já com as variáveis do fluxo) vira o título do item.
    const short = flow({ status: 'waiting_gate', currentStep: 'ok' })
    const steps = short.steps.map((s) =>
      s.type === 'gate' ? { ...s, message: 'Aprovar correções da PR #13' } : s
    )
    expect(flowWaitingItem({ ...short, steps }, task())).toMatchObject({
      kind: 'gate',
      what: 'Aprovar correções da PR #13'
    })

    const action = flowWaitingItem(
      flow({
        status: 'waiting_gate',
        confirm: { title: 'Push de ORK-1/x', message: '', details: [], approveLabel: 'Enviar' }
      }),
      task()
    )
    expect(action).toMatchObject({ kind: 'action', what: 'Aprovar: Push de ORK-1/x' })

    expect(
      flowWaitingItem(
        flow({
          status: 'paused',
          pauseReason: 'needs_choice',
          choice: { prompt: 'Qual task é desta tarefa?', options: [] }
        }),
        task()
      )
    ).toMatchObject({ kind: 'choice', what: 'Qual task é desta tarefa?' })
    expect(flowWaitingItem(flow({ status: 'awaiting_decision' }), task())?.kind).toBe('decision')
    expect(
      flowWaitingItem(flow({ status: 'paused', pauseReason: 'step_failed' }), task())?.what
    ).toBe('Um passo falhou (Revisar)')
    expect(
      flowWaitingItem(flow({ status: 'paused', pauseReason: 'waiting_slot' }), task())
    ).toBeNull()
    expect(flowWaitingItem(flow(), task())).toBeNull()
  })

  it('pergunta e permissão abrem a seção do Claude Code', () => {
    const q = requestWaitingItem(
      { runId: 'r', requestId: 'q1', kind: 'question', summary: 'Qual formato?', since: 'x' },
      task()
    )
    expect(q).toMatchObject({
      key: 'req:r:q1',
      section: 'claude',
      what: 'Pergunta do Claude Code: Qual formato?'
    })
    const p = requestWaitingItem(
      { runId: 'r', requestId: 'p1', kind: 'permission', summary: 'pnpm test', since: 'x' },
      task()
    )
    expect(p.what).toBe('Permissão para o Claude Code: pnpm test')
  })

  it('escrita recusada pelo Notion explica o motivo; presa mostra as tentativas', () => {
    expect(
      notionWaitingItem({ type: 'rejected', eventId: 7, code: 'forbidden', at: 'x' }, task()).what
    ).toBe('O Notion recusou a mudança e o card voltou (a integração não pode editar esta página)')
    expect(
      notionWaitingItem({ type: 'retrying', writeId: 3, attempts: 4, since: 'x' }, task())
    ).toMatchObject({ key: 'notion:pending:3', section: 'history' })
  })

  it('ordena do mais antigo para o mais novo', () => {
    const a = requestWaitingItem(
      { runId: 'r', requestId: 'a', kind: 'question', summary: '', since: '2026-01-02' },
      task()
    )
    const b = requestWaitingItem(
      { runId: 'r', requestId: 'b', kind: 'question', summary: '', since: '2026-01-01' },
      task()
    )
    expect(sortWaiting([a, b]).map((i) => i.key)).toEqual(['req:r:b', 'req:r:a'])
  })
})

describe('Em execução', () => {
  it('execução que é passo de fluxo aparece uma vez, como o fluxo; fila por último', () => {
    const items = buildRunning(
      [
        {
          runId: 'run1',
          projectId: 'p1',
          taskId: 't1',
          state: 'running',
          startedAt: '2026-11-20T10:01:00Z',
          command: 'revisar'
        },
        {
          runId: 'run2',
          projectId: 'p1',
          taskId: 't2',
          state: 'queued',
          startedAt: '2026-11-20T09:00:00Z',
          command: null
        },
        {
          runId: 'run3',
          projectId: 'p1',
          taskId: 't3',
          state: 'running',
          startedAt: '2026-11-20T11:00:00Z',
          command: null
        }
      ],
      [flow(), flow({ id: 'fr2', taskId: 't4', status: 'waiting_gate' })],
      (projectId, taskId) => task(taskId, projectId)
    )
    expect(items.map((i) => [i.key, i.label, i.state])).toEqual([
      ['flow:fr1', 'Revisar · /revisar', 'running'],
      ['run:run3', 'Claude Code · prompt', 'running'],
      ['run:run2', 'Claude Code · prompt', 'queued']
    ])
  })

  it('fluxo aguardando vaga aparece como na fila', () => {
    const [item] = buildRunning([], [flow({ status: 'paused', pauseReason: 'waiting_slot' })], () =>
      task()
    )
    expect(item).toMatchObject({ state: 'queued', label: 'Revisar · aguardando vaga' })
  })
})

describe('PRs que precisam de atenção', () => {
  const now = new Date('2026-11-20T12:00:00Z')
  const signal = (
    taskId: string,
    pr: Partial<NonNullable<TaskSignals['pr']>> | null
  ): TaskSignals => ({
    taskId,
    displayId: 'ORK-1',
    localBranches: [],
    remoteBranches: [],
    otherPrs: 0,
    pr: pr
      ? {
          number: 10,
          title: 'x',
          url: 'https://github.com/o/r/pull/10',
          state: 'open',
          merged: false,
          headRef: 'ORK-1/x',
          updatedAt: '2026-11-20T00:00:00Z',
          createdAt: '2026-11-19T00:00:00Z',
          reviewDecision: null,
          unresolvedComments: 0,
          checks: null,
          ...pr
        }
      : null
  })

  it('CI vermelho, mudanças pedidas, comentários e PR antiga sem review; ordem por gravidade', () => {
    const items = prAttention(
      {
        a: signal('a', { number: 1, reviewDecision: 'changes_requested' }),
        b: signal('b', { number: 2, checks: 'failure', unresolvedComments: 2 }),
        c: signal('c', { number: 3, createdAt: '2026-11-15T00:00:00Z' }),
        d: signal('d', {
          number: 4,
          createdAt: '2026-11-15T00:00:00Z',
          reviews: [{ id: 'r', state: 'approved', at: 'x' }]
        }),
        e: signal('e', { number: 5, state: 'merged', checks: 'failure' }),
        f: signal('f', null),
        g: signal('g', { number: 7, state: 'draft', createdAt: '2026-11-01T00:00:00Z' })
      },
      (taskId) => task(taskId),
      now
    )
    expect(items.map((i) => [i.number, i.reasons])).toEqual([
      [2, ['ci_failed', 'unresolved_comments']],
      [1, ['changes_requested']],
      [3, ['stale_review']]
    ])
    expect(items[0]?.unresolved).toBe(2)
    expect(items[2]?.openDays).toBe(5)
  })
})

describe('Por projeto', () => {
  const project = {
    id: 'p1',
    name: 'Orkio',
    health: { state: 'ok' as const },
    repo: null,
    notionProject: { id: 'n', name: 'N' }
  }

  it('conta por etapa na ordem do quadro; etapa desconhecida vai para "sem etapa"', () => {
    const card = projectCard({
      project,
      stages: STAGES,
      states: [
        { stageId: 's1', blocked: false, automationPaused: false },
        { stageId: 's1', blocked: true, automationPaused: true },
        { stageId: 's4', blocked: false, automationPaused: false },
        { stageId: 'velha', blocked: false, automationPaused: false },
        { stageId: null, blocked: false, automationPaused: false }
      ],
      notionHealth: 'ok',
      automationsPaused: true,
      waiting: 2
    })
    expect(card.stages.map((s) => [s.name, s.count])).toEqual([
      ['Prioridades', 2],
      ['Em andamento', 0],
      ['Revisado', 0],
      ['Finalizada', 1]
    ])
    expect(card).toMatchObject({
      noStage: 2,
      total: 5,
      blocked: 1,
      pausedTasks: 1,
      waiting: 2,
      automationsPaused: true,
      hasBoard: true
    })
    expect(card.health).toEqual({ folder: 'ok', github: 'off', notion: 'ok', message: null })
  })

  it('pasta sumida, GitHub desconectado e mapeamento quebrado aparecem na saúde', () => {
    const missing = projectCard({
      project: {
        ...project,
        health: { state: 'missing_folder', message: 'Pasta não encontrada.' },
        repo: {} as never
      },
      stages: null,
      states: [],
      notionHealth: null,
      automationsPaused: false,
      waiting: 0
    })
    expect(missing.health).toMatchObject({
      folder: 'problem',
      github: 'warning',
      notion: 'warning',
      message: 'Pasta não encontrada.'
    })
    expect(missing.hasBoard).toBe(false)
    const broken = projectCard({
      project: { ...project, health: { state: 'github_disconnected' }, repo: {} as never },
      stages: null,
      states: [],
      notionHealth: 'broken',
      automationsPaused: false,
      waiting: 0
    })
    expect(broken.health).toMatchObject({ github: 'warning', notion: 'problem' })
  })
})

describe('Semana', () => {
  const since = '2026-11-13T00:00:00.000Z'
  const ev = (
    id: number,
    taskPageId: string,
    at: string,
    from: string | null,
    to: string | null,
    kind: StageEventInput['kind'] = 'moved'
  ): StageEventInput => ({
    id,
    taskPageId,
    projectId: 'p1',
    at,
    kind,
    fromStage: from,
    toStage: to
  })

  it('finalizadas: tarefas distintas que entraram na etapa concluída na semana', () => {
    const final = new Map([['p1', 's4']])
    expect(
      finishedCount(
        [
          ev(1, 'a', '2026-11-10T00:00:00Z', 's3', 's4'),
          ev(2, 'b', '2026-11-14T00:00:00Z', 's3', 's4'),
          ev(3, 'b', '2026-11-15T00:00:00Z', 's4', 's3'),
          ev(4, 'b', '2026-11-16T00:00:00Z', 's3', 's4'),
          ev(5, 'c', '2026-11-16T00:00:00Z', null, 's4', 'added')
        ],
        final,
        since
      )
    ).toBe(1)
  })

  it('tempo médio em Revisado conta cada passagem que terminou na semana', () => {
    const review = new Map([['p1', 's3']])
    const result = stageDwell(
      [
        ev(1, 'a', '2026-11-10T00:00:00Z', 's2', 's3'),
        ev(2, 'a', '2026-11-14T00:00:00Z', 's3', 's4'),
        ev(3, 'b', '2026-11-14T00:00:00Z', 's2', 's3'),
        ev(4, 'b', '2026-11-15T00:00:00Z', 's3', 's2'),
        ev(5, 'b', '2026-11-16T00:00:00Z', 's2', 's3'),
        ev(6, 'b', '2026-11-18T00:00:00Z', 's3', 's4'),
        ev(7, 'c', '2026-11-01T00:00:00Z', 's2', 's3'),
        ev(8, 'c', '2026-11-02T00:00:00Z', 's3', 's4')
      ],
      review,
      since
    )
    // a: 4 d; b: 1 d + 2 d; c terminou antes da semana.
    expect(result.samples).toBe(3)
    expect(result.avgMs).toBe(((4 + 1 + 2) / 3) * 24 * 60 * 60 * 1000)
    expect(stageDwell([], review, since)).toEqual({ avgMs: null, samples: 0 })
  })

  it('PRs abertas/mergeadas na semana; sem cache do GitHub = desconhecido', () => {
    expect(pullsInWeek([null], since)).toEqual({ opened: null, merged: null })
    expect(
      pullsInWeek(
        [
          [
            { createdAt: '2026-11-14T00:00:00Z', merged: false, closedAt: null },
            { createdAt: '2026-11-01T00:00:00Z', merged: true, closedAt: '2026-11-15T00:00:00Z' },
            { createdAt: '2026-11-01T00:00:00Z', merged: true, closedAt: '2026-11-02T00:00:00Z' }
          ],
          null
        ],
        since
      )
    ).toEqual({ opened: 1, merged: 1 })
  })

  it('custo soma só o conhecido e diz quantas execuções têm custo', () => {
    expect(costSum([{ cost: 0.5 }, { cost: null }, { cost: 1.25 }])).toEqual({
      usd: 1.75,
      known: 2,
      total: 3
    })
  })
})
