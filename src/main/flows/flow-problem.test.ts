import { describe, expect, it } from 'vitest'
import { DELIVERY_MESSAGES } from '../../shared/delivery'
import { classifyMessage } from '../../shared/flow-problem'
import { ALVA_MESSAGES } from '../alva/alva.service'
import { RUN_MESSAGES } from '../claude/run.service'
import { toGitError } from '../git/git'
import { FLOW_MESSAGES } from './flow-runner'

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
    expect(classifyMessage('O Claude Code terminou com erro: algo')).toBe('claude_error')
    const credentials = toGitError({ stderr: 'fatal: could not read Username for https://x' })
    expect(classifyMessage(credentials.message)).toBe('credentials')
    const rejected = toGitError({ stderr: ' ! [rejected] main -> main (non-fast-forward)' })
    expect(classifyMessage(rejected.message)).toBe('push_rejected')
  })
})
