import { describe, expect, it } from 'vitest'
import { ALVA_FAILURES } from '../../shared/alva'
import { classifyFailure, type FailureProblemKind } from '../../shared/flow-problem'
import type { RunEndCode } from '../claude/run.service'
import type { DeliveryErrorCode } from '../delivery/delivery.service'
import { PUBLISH_FAILURES } from '../delivery/review-publish'

/**
 * A tela de problema (shared/flow-problem.ts) decide a causa pelo código que o main grava no passo.
 * Os códigos aqui são os dos produtores (tipos e constantes do main): renomear um deles quebra o
 * tipo ou este teste, nunca a tela em silêncio.
 */
describe('códigos de falha do main reconhecidos pela tela de problema', () => {
  it('entrega, execução e alva-flow', () => {
    const delivery: [DeliveryErrorCode, FailureProblemKind][] = [
      ['dirty', 'uncommitted'],
      ['credentials', 'credentials'],
      ['rejected', 'push_rejected'],
      ['git', 'generic']
    ]
    for (const [code, kind] of delivery) expect(classifyFailure(code)).toBe(kind)
    const run: [RunEndCode, FailureProblemKind][] = [
      ['timed_out', 'timed_out'],
      ['claude_error', 'claude_error'],
      ['start_failed', 'generic']
    ]
    for (const [code, kind] of run) expect(classifyFailure(code)).toBe(kind)
    expect(classifyFailure(ALVA_FAILURES.noTaskCreated)).toBe('no_task')
    expect(classifyFailure(ALVA_FAILURES.notLinked)).toBe('no_link')
    // ClaudeService.flowContext (`fail('no_description', …)`).
    expect(classifyFailure('no_description')).toBe('no_description')
  })

  it('revisão como orkio[bot] (Task 18)', () => {
    expect(classifyFailure(PUBLISH_FAILURES.invalid)).toBe('review_invalid')
    expect(classifyFailure(PUBLISH_FAILURES.notInstalled)).toBe('review_not_installed')
    expect(classifyFailure(PUBLISH_FAILURES.notConfigured)).toBe('review_not_configured')
    expect(classifyFailure(PUBLISH_FAILURES.noSite)).toBe('review_no_site')
    expect(classifyFailure(PUBLISH_FAILURES.maybePosted)).toBe('review_maybe_posted')
    expect(classifyFailure(PUBLISH_FAILURES.noPr)).toBe('generic')
  })

  it('código desconhecido ou ausente (linhas antigas do banco) = genérico', () => {
    expect(classifyFailure('qualquer_coisa')).toBe('generic')
    expect(classifyFailure(null)).toBe('generic')
  })
})
