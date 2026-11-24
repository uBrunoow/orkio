import { describe, expect, it } from 'vitest'
import { ALVA_FAILURES } from './alva'
import { DELIVERY_MESSAGES } from './delivery'
import { MAX_EXECUTED_STEPS, type FlowRunView, type FlowStepView, type Step } from './task-flow'
import { describeFlowProblem } from './flow-problem'

const STEPS: Step[] = [
  {
    id: 'commit',
    name: 'Commit (/commit)',
    type: 'claude_command',
    command: 'alva-flow:commit',
    args: '',
    timeoutMin: 15
  },
  { id: 'push', name: 'Push da branch (Orkio)', type: 'orkio_action', action: 'push' }
]

const entry = (over: Partial<FlowStepView>): FlowStepView => ({
  seq: 1,
  stepId: 'push',
  runId: null,
  status: 'failed',
  startedAt: '2026-11-21T10:00:00Z',
  endedAt: '2026-11-21T10:00:01Z',
  message: null,
  code: null,
  costUsd: null,
  ...over
})

function run(over: Partial<FlowRunView>): FlowRunView {
  return {
    id: 'fr-1',
    projectId: 'p',
    taskId: 't',
    flowId: 'f',
    flowName: 'Alva',
    steps: STEPS,
    status: 'paused',
    currentStep: 'push',
    pauseReason: 'step_failed',
    result: null,
    startedAt: '2026-11-21T10:00:00Z',
    endedAt: null,
    vars: {},
    history: [],
    choice: null,
    confirm: null,
    agent: null,
    revise: null,
    ...over
  }
}

describe('describeFlowProblem', () => {
  it('push recusado por mudanças não commitadas: causa, motivo e "rodar o /commit de novo"', () => {
    const p = describeFlowProblem(
      run({ history: [entry({ code: 'dirty', message: DELIVERY_MESSAGES.dirty })] })
    )
    expect(p).toMatchObject({
      kind: 'uncommitted',
      title: 'Um passo falhou — Push da branch (Orkio)',
      reason: DELIVERY_MESSAGES.dirty,
      stepName: 'Push da branch (Orkio)',
      rerun: { stepId: 'commit', label: 'Rodar /commit de novo' }
    })
    expect(p?.hint).toContain('commit')
  })

  it('falha de comando: guarda a execução para abrir a sessão; não sugere rodar outro passo', () => {
    const p = describeFlowProblem(
      run({
        currentStep: 'commit',
        history: [
          entry({
            stepId: 'commit',
            runId: 'run-9',
            code: 'claude_error',
            message: 'O Claude Code terminou com erro.'
          })
        ]
      })
    )
    expect(p).toMatchObject({ kind: 'claude_error', runId: 'run-9', rerun: null })
  })

  it('usa a falha mais recente do passo atual', () => {
    const p = describeFlowProblem(
      run({
        history: [
          entry({ seq: 1, code: 'dirty', message: DELIVERY_MESSAGES.dirty }),
          entry({ seq: 2, code: 'credentials', message: 'O git pediu credenciais.' })
        ]
      })
    )
    expect(p?.kind).toBe('credentials')
  })

  it('passo que usa a task do Backlog sem vínculo: explica e oferece rodar o /spec de novo', () => {
    const spec: Step = {
      id: 'spec',
      name: 'Especificar (/spec)',
      type: 'claude_command',
      command: 'alva-flow:spec',
      args: '{{alva.spec_arg}}',
      timeoutMin: 120
    }
    const plan: Step = {
      id: 'plan',
      name: 'Planejar (/plan)',
      type: 'claude_command',
      command: 'alva-flow:plan',
      args: '{{alva.task_id}}',
      timeoutMin: 60
    }
    const p = describeFlowProblem(
      run({
        steps: [spec, plan],
        currentStep: 'plan',
        history: [
          entry({
            stepId: 'plan',
            code: ALVA_FAILURES.notLinked,
            message:
              'Este passo usa a task do Backlog, mas o fluxo ainda não sabe qual é a desta tarefa.'
          })
        ]
      })
    )
    expect(p).toMatchObject({
      kind: 'no_link',
      rerun: { stepId: 'spec', label: 'Rodar /spec de novo' }
    })
    expect(p?.hint).toContain('/spec')
  })

  it('interrupção, limite de passos, prazo do gate e limite do agente', () => {
    expect(describeFlowProblem(run({ pauseReason: 'interrupted' }))?.kind).toBe('interrupted')
    expect(describeFlowProblem(run({ pauseReason: 'loop_guard' }))?.kind).toBe('loop_guard')
    expect(describeFlowProblem(run({ pauseReason: 'gate_timeout' }))?.kind).toBe('gate_timeout')
    expect(describeFlowProblem(run({ pauseReason: 'agent_daily_limit' }))?.kind).toBe(
      'agent_daily_limit'
    )
    // A dica do limite de passos vem do limite real (MAX_EXECUTED_STEPS).
    expect(describeFlowProblem(run({ pauseReason: 'loop_guard' }))?.hint).toContain(
      `${MAX_EXECUTED_STEPS} passos`
    )
  })

  it('a causa vem do código, não do texto: mensagem antiga sem código = genérico', () => {
    const old = describeFlowProblem(run({ history: [entry({ message: DELIVERY_MESSAGES.dirty })] }))
    expect(old).toMatchObject({ kind: 'generic', reason: DELIVERY_MESSAGES.dirty, rerun: null })
    const reworded = describeFlowProblem(
      run({ history: [entry({ code: 'dirty', message: 'Texto reescrito qualquer.' })] })
    )
    expect(reworded?.kind).toBe('uncommitted')
  })

  it('espera por vaga ou por escolha, e fluxos que não estão pausados, não são problema', () => {
    for (const pauseReason of ['waiting_slot', 'waiting_agent', 'needs_choice'] as const) {
      expect(describeFlowProblem(run({ pauseReason }))).toBeNull()
    }
    expect(describeFlowProblem(run({ status: 'running', pauseReason: null }))).toBeNull()
  })
})

describe('publicar revisão como orkio[bot] (Task 18)', () => {
  const PUBLISH: Step[] = [
    {
      id: 'json',
      name: 'Converter a revisão em JSON (só leitura)',
      type: 'claude_command',
      command: '',
      args: '',
      prompt: 'Converta',
      readOnly: true,
      timeoutMin: 15
    },
    { id: 'pub', name: 'Publicar revisão', type: 'orkio_action', action: 'publish_review' }
  ]
  const at = (code: string, message: string): FlowRunView =>
    run({ steps: PUBLISH, currentStep: 'pub', history: [entry({ stepId: 'pub', code, message })] })

  it('JSON inválido: explica e oferece rodar a conversão de novo', () => {
    const p = describeFlowProblem(
      at('review_invalid', 'A revisão em JSON é inválida: "event" precisa ser …')
    )
    expect(p).toMatchObject({
      kind: 'review_invalid',
      rerun: { stepId: 'json', label: 'Rodar “Converter a revisão em JSON (só leitura)” de novo' },
      link: null
    })
  })

  it('App não instalado: link de instalação só no formato conhecido', () => {
    const msg =
      'O GitHub App do Orkio não está instalado neste repositório (ou não tem acesso às PRs). Instale o App neste link e retome: https://github.com/apps/orkio/installations/new'
    expect(describeFlowProblem(at('review_not_installed', msg))).toMatchObject({
      kind: 'review_not_installed',
      link: {
        label: 'Instalar o GitHub App do Orkio',
        url: 'https://github.com/apps/orkio/installations/new'
      }
    })
    const evil = msg.replace(
      'https://github.com/apps/orkio/installations/new',
      'https://evil.example/apps/orkio/installations/new'
    )
    expect(describeFlowProblem(at('review_not_installed', evil))?.link).toBeNull()
    expect(
      describeFlowProblem(
        at(
          'review_not_installed',
          `${msg.split(' Instale')[0]} https://github.com/apps/orkio/installations/new/x`
        )
      )?.link
    ).toBeNull()
  })

  it('timeout do site e site sem App: causas próprias, sem link', () => {
    expect(
      describeFlowProblem(
        at(
          'review_maybe_posted',
          'O site do Orkio demorou para responder. Confira a PR antes de tentar de novo: a revisão pode ter sido publicada.'
        )
      )
    ).toMatchObject({ kind: 'review_maybe_posted', link: null })
    expect(
      describeFlowProblem(
        at(
          'review_not_configured',
          'Não dá para publicar a revisão como orkio[bot]: o GitHub App do Orkio ainda não está configurado no site do Orkio.'
        )
      )
    ).toMatchObject({ kind: 'review_not_configured' })
    const noSite = describeFlowProblem(
      at(
        'review_no_site',
        'Este app não sabe o endereço do site do Orkio (MAIN_VITE_SITE_URL não definido no build). Em dev, defina em .env.development e reinicie o pnpm dev.'
      )
    )
    expect(noSite).toMatchObject({ kind: 'review_no_site', link: null })
    expect(noSite?.hint).toContain('MAIN_VITE_SITE_URL')
  })
})
