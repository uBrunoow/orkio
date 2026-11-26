import { describe, expect, it } from 'vitest'
import { DECLARED_FLOW_VARS } from './flow-outputs'
import {
  LINES_EXTRACTOR,
  NATIVE_FLOW_IDS,
  isNativeFlowId,
  nativeFlow,
  nativePrCommentsFlow
} from './native-flows'
import { ACTION_VARS, ORKIO_ACTIONS } from './orkio-actions'
import { afterStep, startFlow, validateTaskFlow, type Flow, type FlowDecision } from './task-flow'
import { RUN_MODES } from './task-setup'
import { REVIEW_VARS } from './review-rounds'

const CTX = {
  commands: null,
  extractors: [LINES_EXTRACTOR],
  actions: Object.keys(ORKIO_ACTIONS),
  declaredVars: DECLARED_FLOW_VARS
}

const OPTION_SETS = [
  { review: true, evidence: true },
  { review: true, evidence: false },
  { review: false, evidence: true },
  { review: false, evidence: false }
]

/** Roda o motor puro: cada passo do Claude Code termina com o texto dado por `answer`. */
function walk(
  flow: Flow,
  answer: (stepId: string, visit: number) => string,
  max = 60,
  act: (stepId: string, visit: number) => Record<string, string> = (id) =>
    id === 'registrar-revisao' ? { [REVIEW_VARS.verdict]: 'limpo' } : {}
): string[] {
  // A PR é mergeada logo na primeira espera (a menos que o teste diga outra coisa).
  const base = act
  act = (id, visit) =>
    id === 'esperar-pr' ? { [ACTION_VARS.prEvent]: 'merge', ...base(id, visit) } : base(id, visit)
  const path: string[] = []
  const visits: Record<string, number> = {}
  let d: FlowDecision = startFlow(flow)
  while (d.kind === 'run' && path.length < max) {
    const at = d.stepId
    const step = flow.steps.find((s) => s.id === at)!
    path.push(step.id)
    visits[step.id] = (visits[step.id] ?? 0) + 1
    if (step.type === 'gate') {
      d = afterStep(flow, d.state, step.id, { outcome: 'approved' })
    } else if (step.type === 'claude_command' && step.extract) {
      const vars: Record<string, string> = {}
      for (const m of answer(step.id, visits[step.id]!).matchAll(/@orkio (\w+)=(\S+)/g)) {
        vars[m[1]!] = m[2]!
      }
      d = afterStep(flow, d.state, step.id, { outcome: 'ok', vars })
    } else if (step.type === 'orkio_action') {
      d = afterStep(flow, d.state, step.id, { outcome: 'ok', vars: act(step.id, visits[step.id]!) })
    } else {
      d = afterStep(flow, d.state, step.id, { outcome: 'ok' })
    }
  }
  if (d.kind === 'finished') path.push(`fim:${d.result}`)
  return path
}

describe('fluxos nativos', () => {
  it('todos validam sem erro nem aviso e não dependem do alva-flow', () => {
    for (const mode of RUN_MODES) {
      for (const opts of OPTION_SETS) {
        for (const role of [null, 'work', 'plan', 'reviewed'] as const) {
          const flow = nativeFlow(mode, opts, role)!
          expect(validateTaskFlow(flow, CTX), `${mode} ${JSON.stringify(opts)} ${role}`).toEqual([])
          expect(flow.tags).toBeUndefined()
          for (const s of flow.steps) {
            if (s.type === 'claude_command') {
              expect(s.command).toBe('')
              expect(s.prompt).toBeTruthy()
            }
          }
          expect(isNativeFlowId(flow.id)).toBe(true)
        }
      }
    }
  })

  it('fila, revisão e concluída não rodam nada; Revisado corrige os comentários da PR', () => {
    const opts = { review: true, evidence: false }
    for (const role of ['queue', 'review', 'done'] as const) {
      expect(nativeFlow('quick', opts, role)).toBeNull()
    }
    expect(nativeFlow('approval', opts, 'reviewed')!.id).toBe(NATIVE_FLOW_IDS.prComments)
  })

  it('Rodar uma vez: implementa → revisão (outro agente) → diff → push → PR', () => {
    const flow = nativeFlow('quick', { review: true, evidence: false })!
    expect(walk(flow, () => '')).toEqual([
      'implementar',
      'preparar-revisao',
      'revisar',
      'registrar-revisao',
      'ver-diff',
      'push',
      'abrir-pr',
      'esperar-pr',
      'concluir-tarefa',
      'fim:done'
    ])
    const review = flow.steps.find((s) => s.id === 'revisar')!
    expect(review).toMatchObject({ agent: 'reviewer', readOnly: true })
    expect(flow.steps.find((s) => s.id === 'abrir-pr')).toMatchObject({ delivery: true })
  })

  it('revisão até ficar limpo: corrige e revisa de novo; limpo segue para o diff', () => {
    const flow = nativeFlow('quick', { review: true, evidence: false })!
    const verdicts = ['corrigir', 'limpo']
    const path = walk(
      flow,
      () => '',
      60,
      (id, visit) =>
        id === 'registrar-revisao' ? { [REVIEW_VARS.verdict]: verdicts[visit - 1]! } : {}
    )
    expect(path.filter((s) => s === 'corrigir')).toHaveLength(1)
    expect(path.filter((s) => s === 'revisar')).toHaveLength(2)
    expect(path.slice(-6)).toEqual([
      'ver-diff',
      'push',
      'abrir-pr',
      'esperar-pr',
      'concluir-tarefa',
      'fim:done'
    ])
  })

  it('finais honestos da revisão: esgotado no limite de rodadas, travado com os mesmos bloqueios', () => {
    const flow = nativeFlow('quick', { review: true, evidence: false })!
    const verdicts = ['corrigir', 'corrigir', 'esgotado']
    const exhausted = walk(
      flow,
      () => '',
      60,
      (id, visit) =>
        id === 'registrar-revisao' ? { [REVIEW_VARS.verdict]: verdicts[visit - 1]! } : {}
    )
    expect(exhausted.filter((s) => s === 'revisar')).toHaveLength(3)
    expect(exhausted.at(-1)).toBe('fim:exhausted')
    expect(exhausted).not.toContain('push')
    const stuck = walk(
      flow,
      () => '',
      60,
      (id) => (id === 'registrar-revisao' ? { [REVIEW_VARS.verdict]: 'travado' } : {})
    )
    expect(stuck.at(-1)).toBe('fim:stuck')
    expect(stuck).not.toContain('ver-diff')
  })

  it('o gate do diff aceita "Pedir mudanças" (volta para quem implementa)', () => {
    const flow = nativeFlow('quick', { review: true, evidence: false })!
    expect(flow.steps.find((s) => s.id === 'ver-diff')).toMatchObject({
      revise: { step: 'implementar' }
    })
  })

  it('sem revisor: sem passo de revisão; com evidência: gate antes do diff', () => {
    const flow = nativeFlow('quick', { review: false, evidence: true })!
    expect(walk(flow, () => '')).toEqual([
      'implementar',
      'conferir-evidencia',
      'ver-diff',
      'push',
      'abrir-pr',
      'esperar-pr',
      'concluir-tarefa',
      'fim:done'
    ])
  })

  it('Com aprovação: spec e plano passam por você antes de implementar', () => {
    const flow = nativeFlow('approval', { review: true, evidence: false })!
    expect(walk(flow, () => '').slice(0, 7)).toEqual([
      'spec',
      'aprovar-spec',
      'plano',
      'aprovar-plano',
      'implementar',
      'preparar-revisao',
      'revisar'
    ])
    expect(flow.steps.find((s) => s.id === 'aprovar-spec')).toMatchObject({
      show: 'result',
      revise: { step: 'spec' }
    })
  })

  it('Quebrar em passos: uma fatia por vez até não restar nenhuma (com trava)', () => {
    const flow = nativeFlow('steps', { review: false, evidence: false })!
    const path = walk(flow, (id, visit) =>
      id === 'fatia' ? `@orkio restam=${3 - visit}` : '@orkio fatias=3'
    )
    expect(path.filter((s) => s === 'fatia')).toHaveLength(3)
    expect(path.at(-1)).toBe('fim:done')
    const forever = walk(flow, (id) => (id === 'fatia' ? '@orkio restam=9' : ''))
    expect(forever.filter((s) => s === 'fatia')).toHaveLength(12)
  })

  it('a PR acorda o fluxo: CI falhou e comentários corrigem e voltam a esperar; merge conclui', () => {
    const flow = nativeFlow('quick', { review: false, evidence: false })!
    const events = ['ci_falhou', 'comentarios', 'merge']
    const path = walk(
      flow,
      () => '',
      80,
      (id, visit) => {
        if (id === 'esperar-pr') return { [ACTION_VARS.prEvent]: events[visit - 1]! }
        if (id === 'ler-comentarios-pr') return { [ACTION_VARS.reviewCount]: '2' }
        if (id === 'conferir-envio') return { [ACTION_VARS.prPushed]: 'nao' }
        return {}
      }
    )
    expect(path.slice(path.indexOf('abrir-pr'))).toEqual([
      'abrir-pr',
      'esperar-pr',
      'corrigir-ci',
      'conferir-envio',
      'enviar-correcoes',
      'esperar-pr',
      'ler-comentarios-pr',
      'corrigir-comentarios',
      'conferir-envio',
      'enviar-correcoes',
      'esperar-pr',
      'concluir-tarefa',
      'fim:done'
    ])
    expect(flow.steps.find((s) => s.id === 'corrigir-comentarios')).toMatchObject({
      delivery: true
    })
    const closed = walk(
      flow,
      () => '',
      80,
      (id) => (id === 'esperar-pr' ? { [ACTION_VARS.prEvent]: 'fechada' } : {})
    )
    expect(closed.at(-1)).toBe('fim:nothing')
    // Trava: o executor zera a contagem de passos a cada despertar (evento de fora, não laço);
    // quem limita as voltas é a visita à espera.
    expect(flow.steps.find((s) => s.id === 'voltar-a-esperar')).toMatchObject({
      when: { of: [{ type: 'visits', step: 'esperar-pr', lt: 20 }] },
      then: 'esperar-pr',
      else: '$fim:esgotado'
    })
  })

  it('comentários da PR: o resumo vem antes para aprovar, em qualquer modo, e pede nova revisão sem outro gate', () => {
    const flow = nativePrCommentsFlow()
    const ids = flow.steps.map((s) => s.id)
    expect(ids.indexOf('plano-correcoes')).toBeLessThan(ids.indexOf('aprovar-correcoes'))
    expect(ids.indexOf('aprovar-correcoes')).toBeLessThan(ids.indexOf('aplicar-correcoes'))
    expect(flow.steps.at(-1)).toMatchObject({ action: 'rerequest_review' })
    for (const mode of ['quick', 'approval', 'steps'] as const) {
      expect(
        nativeFlow(mode, { review: false, evidence: false }, 'reviewed')?.steps.map((s) => s.id)
      ).toContain('aprovar-correcoes')
    }
  })
})
