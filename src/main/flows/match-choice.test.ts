import { describe, expect, it } from 'vitest'
import { matchChoice } from './flow-runner'

const options = [
  { value: 'TASK-1', label: 'TASK-1 — Antiga' },
  { value: 'TASK-5', label: 'TASK-5 — Pipeline CI/CD' },
  { value: 'TASK-50', label: 'TASK-50 — Outra' }
]

describe('matchChoice (mensagem do campo resolve a escolha do fluxo)', () => {
  it('acha a opção citada, sem diferenciar maiúsculas nem "task 5"/"task_5"', () => {
    expect(matchChoice('é a task-5 que já foi criada', options)).toBe('TASK-5')
    expect(matchChoice('TASK 5', options)).toBe('TASK-5')
    expect(matchChoice('task_50 por favor', options)).toBe('TASK-50')
  })

  it('TASK-5 não casa dentro de TASK-50; nenhuma ou várias citadas = null', () => {
    expect(matchChoice('a TASK-50', options)).toBe('TASK-50')
    expect(matchChoice('não sei qual', options)).toBeNull()
    expect(matchChoice('task-1 ou task-5?', options)).toBeNull()
  })
})
