import { describe, expect, it } from 'vitest'
import { evaluatePermission, isShellWait, POLICY_MESSAGES, type PolicyContext } from './policy'
import { DELIVERY_RUN_SETTINGS, RUN_SETTINGS } from './runner'

const WT = '/tmp/orkio-wt'
const repo = {
  owner: 'acme',
  repo: 'app',
  remote: 'origin',
  branch: 'feat/ORK-1-x',
  defaultBranch: 'main',
  displayId: 'ORK-1'
}
const ctx: PolicyContext = {
  worktree: WT,
  // "Sempre neste projeto" não pode liberar uma espera.
  allowRules: [
    { tool: 'Bash', pattern: 'sleep' },
    { tool: 'Bash', pattern: 'tail' }
  ],
  repo
}
const decide = (command: string) => evaluatePermission({ tool: 'Bash', input: { command } }, ctx)

describe('Fase 5: esperas no shell são negadas', () => {
  it.each([
    'gh pr checks --watch',
    'gh pr checks 12 --watch --interval 10',
    'gh run watch 99',
    'sleep 300',
    'sleep 1m',
    'sleep 45',
    'npm run build && sleep 120',
    'tail -f log.txt',
    'tail -n 50 -F log.txt',
    'tail --follow=name log.txt',
    'watch -n 5 git status',
    'env FOO=1 sleep 3600'
  ])('%s', (command) => {
    const d = decide(command)
    expect(d).toMatchObject({ decision: 'deny', code: 'wait', reason: POLICY_MESSAGES.wait })
  })

  it('o que não é espera segue as regras de sempre', () => {
    expect(decide('gh pr checks 12').decision).toBe('allow')
    expect(decide('sleep 2').decision).toBe('allow')
    expect(decide('tail -n 20 log.txt').decision).toBe('allow')
    expect(isShellWait({ name: 'npm', args: ['test', '--', '--watch=false'] })).toBe(false)
  })

  it('o CLI também nega as formas comuns, dentro e fora do modo entrega', () => {
    for (const deny of [RUN_SETTINGS.permissions.deny, DELIVERY_RUN_SETTINGS.permissions.deny]) {
      expect(deny).toContain('Bash(gh pr checks *--watch*)')
      expect(deny).toContain('Bash(gh run watch *)')
      expect(deny).toContain('Bash(tail -f *)')
    }
  })
})
