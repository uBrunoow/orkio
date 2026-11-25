import { describe, expect, it } from 'vitest'
import { DECLARED_FLOW_VARS } from './flow-outputs'
import {
  LINES_EXTRACTOR,
  NATIVE_FLOW_IDS,
  isNativeFlowId,
  nativeFlow,
  nativePrCommentsFlow
} from './native-flows'
import { ORKIO_ACTIONS } from './orkio-actions'
import { afterStep, startFlow, validateTaskFlow, type Flow, type FlowDecision } from './task-flow'
import { RUN_MODES } from './task-setup'

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
function walk(flow: Flow, answer: (stepId: string, visit: number) => string, max = 60): string[] {
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
    expect(walk(flow, () => '@orkio bloqueios=0')).toEqual([
      'implementar',
      'revisar',
      'ver-diff',
      'push',
      'abrir-pr',
      'fim:done'
    ])
    const review = flow.steps.find((s) => s.id === 'revisar')!
    expect(review).toMatchObject({ agent: 'reviewer', readOnly: true })
    expect(flow.steps.find((s) => s.id === 'abrir-pr')).toMatchObject({ delivery: true })
  })

  it('revisão com bloqueios corrige no máximo 2 vezes e segue para o diff', () => {
    const flow = nativeFlow('quick', { review: true, evidence: false })!
    const path = walk(flow, () => '@orkio bloqueios=3')
    expect(path.filter((s) => s === 'corrigir')).toHaveLength(2)
    expect(path.filter((s) => s === 'revisar')).toHaveLength(3)
    expect(path.slice(-4)).toEqual(['ver-diff', 'push', 'abrir-pr', 'fim:done'])
  })

  it('sem revisor: sem passo de revisão; com evidência: gate antes do diff', () => {
    const flow = nativeFlow('quick', { review: false, evidence: true })!
    expect(walk(flow, () => '')).toEqual([
      'implementar',
      'conferir-evidencia',
      'ver-diff',
      'push',
      'abrir-pr',
      'fim:done'
    ])
  })

  it('Com aprovação: spec e plano passam por você antes de implementar', () => {
    const flow = nativeFlow('approval', { review: true, evidence: false })!
    expect(walk(flow, () => '@orkio bloqueios=0').slice(0, 6)).toEqual([
      'spec',
      'aprovar-spec',
      'plano',
      'aprovar-plano',
      'implementar',
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

  it('comentários da PR: "Rodar uma vez" corrige direto; os outros pedem sua aprovação', () => {
    const ids = (f: Flow): string[] => f.steps.map((s) => s.id)
    expect(ids(nativePrCommentsFlow('quick'))).not.toContain('aprovar-correcoes')
    expect(ids(nativePrCommentsFlow('approval'))).toContain('aprovar-correcoes')
  })
})
