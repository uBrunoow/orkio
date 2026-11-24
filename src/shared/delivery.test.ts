import { describe, expect, it } from 'vitest'
import { checkPushBranch, isProtectedBranch, type DeliveryTarget } from './delivery'

const BRANCH = 'ORK-7/exportar-csv'
const target: DeliveryTarget = {
  owner: 'acme',
  repo: 'app',
  remote: 'origin',
  branch: BRANCH,
  defaultBranch: 'trunk-x',
  displayId: 'ORK-7'
}

describe('entrega: branches protegidas', () => {
  it('padrão, main/master/develop/production/release* nunca; só a branch da tarefa', () => {
    for (const b of [
      'main',
      'MASTER',
      'develop',
      'production',
      'release/1.2',
      'hotfix-x',
      'trunk-x'
    ])
      expect(isProtectedBranch(b, 'trunk-x'), b).toBe(true)
    expect(checkPushBranch(BRANCH, target)).toBeNull()
    expect(checkPushBranch('ORK-7/outra', target)).toMatch(/Só a branch da tarefa/)
    expect(checkPushBranch('main', target)).toMatch(/protegida/)
    expect(checkPushBranch('-f', target)).toMatch(/inválido/)
    // A branch da tarefa vai mesmo sem o ID no nome (vinculada à mão, banco sem ID).
    expect(checkPushBranch('feature/x', { ...target, branch: 'feature/x' })).toBeNull()
    // hotfix/<nome> é tipo de branch de tarefa; hotfix sozinho, hotfix-x e release* não.
    expect(checkPushBranch('hotfix/login', { ...target, branch: 'hotfix/login' })).toBeNull()
    for (const b of ['hotfix', 'hotfix-1.2', 'hotfix_x', 'release/2.0'])
      expect(checkPushBranch(b, { ...target, branch: b }), b).toMatch(/protegida/)
  })
})
