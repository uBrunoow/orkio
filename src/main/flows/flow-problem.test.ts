import { describe, expect, it } from 'vitest'
import { DELIVERY_MESSAGES } from '../../shared/delivery'
import { classifyMessage } from '../../shared/flow-problem'
import { ALVA_MESSAGES } from '../alva/alva.service'
import { CLAUDE_MESSAGES } from '../claude/claude.service'
import { RUN_MESSAGES } from '../claude/run.service'
import { toGitError } from '../git/git'
import { FLOW_MESSAGES } from './flow-runner'
import { ORKIO_SITE_TIMEOUT_MESSAGE } from '../connectors/github/github.connector'
import { REVIEW_MESSAGES } from '../connectors/github/review-poster'
import { PUBLISH_ACTION_MESSAGES } from '../delivery/review-publish'
import { PUBLISH_REVIEW_MESSAGES } from '../../shared/review-publish'

/**
 * O reconhecimento da causa (shared/flow-problem.ts) lê trechos das mensagens que o main grava nos
 * passos. Este teste usa os textos reais: se alguém mudar uma mensagem, ele avisa.
 */
describe('mensagens do main reconhecidas pela tela de problema', () => {
  it('entrega, execução, alva-flow e git', () => {
    expect(classifyMessage(DELIVERY_MESSAGES.dirty)).toBe('uncommitted')
    expect(classifyMessage(RUN_MESSAGES.timedOut)).toBe('timed_out')
    expect(classifyMessage(ALVA_MESSAGES.noTaskCreated)).toBe('no_task')
    expect(classifyMessage(ALVA_MESSAGES.noTaskFile)).toBe('no_task')
    expect(classifyMessage(FLOW_MESSAGES.noBacklogTask)).toBe('no_link')
    expect(classifyMessage(CLAUDE_MESSAGES.noDescription)).toBe('no_description')
    expect(classifyMessage('O Claude Code terminou com erro: algo')).toBe('claude_error')
    const credentials = toGitError({ stderr: 'fatal: could not read Username for https://x' })
    expect(classifyMessage(credentials.message)).toBe('credentials')
    const rejected = toGitError({ stderr: ' ! [rejected] main -> main (non-fast-forward)' })
    expect(classifyMessage(rejected.message)).toBe('push_rejected')
  })

  it('revisão como orkio[bot] (Task 18)', () => {
    for (const m of Object.values(PUBLISH_REVIEW_MESSAGES)) {
      expect(classifyMessage(m)).toBe('review_invalid')
    }
    expect(
      classifyMessage(`${PUBLISH_ACTION_MESSAGES.invalidPrefix} ${REVIEW_MESSAGES.badComment}`)
    ).toBe('review_invalid')
    expect(classifyMessage(REVIEW_MESSAGES.notInstalled)).toBe('review_not_installed')
    expect(classifyMessage(PUBLISH_ACTION_MESSAGES.notConfigured)).toBe('review_not_configured')
    expect(classifyMessage(PUBLISH_ACTION_MESSAGES.noSite)).toBe('review_no_site')
    expect(classifyMessage(REVIEW_MESSAGES.noSite)).toBe('review_no_site')
    expect(classifyMessage(ORKIO_SITE_TIMEOUT_MESSAGE)).toBe('review_maybe_posted')
  })
})
