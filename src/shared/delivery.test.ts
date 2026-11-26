import { describe, expect, it } from 'vitest'
import {
  checkPrBase,
  checkPushBranch,
  isProtectedBranch,
  parseDeliverySettingsValue,
  parsePrBases,
  type DeliveryTarget
} from './delivery'

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

describe('entrega: branch de destino da PR', () => {
  it('com a lista, a PR só vai para ela (sem base = a padrão do GitHub = recusa)', () => {
    expect(checkPrBase('dev', ['dev'])).toBeNull()
    expect(checkPrBase('DEV', ['dev'])).toBeNull()
    expect(checkPrBase('refs/heads/dev', ['dev'])).toBeNull()
    expect(checkPrBase('main', ['dev'])).toMatch(/dev/)
    expect(checkPrBase(null, ['dev'])).toMatch(/--base dev/)
  })
  it('main e master nunca, mesmo se estiverem na lista', () => {
    expect(checkPrBase('main', ['main', 'dev'])).toMatch(/main/)
    expect(checkPrBase('Master', ['master'])).toMatch(/master/i)
  })
  it('lista da tela: limpa, sem main/master, nomes válidos, até 5', () => {
    expect(parsePrBases([' dev ', '', 'develop'])).toEqual({ ok: true, value: ['dev', 'develop'] })
    expect(parsePrBases(['main'])).toMatchObject({ ok: false })
    expect(parsePrBases(['dev', 'dev'])).toEqual({ ok: true, value: ['dev'] })
    expect(parsePrBases(['a b'])).toMatchObject({ ok: false })
    expect(parsePrBases([])).toMatchObject({ ok: false })
    expect(parsePrBases(['a', 'b', 'c', 'd', 'e', 'f'])).toMatchObject({ ok: false })
  })
})

describe('entrega: ajustes do projeto', () => {
  it('lê aprovação, agentes entregando e destinos; destino ruim cai sem derrubar o resto', () => {
    expect(parseDeliverySettingsValue({ requirePushApproval: true })).toEqual({
      requirePushApproval: true
    })
    expect(
      parseDeliverySettingsValue({
        requirePushApproval: false,
        agentsDeliver: true,
        prBases: ['dev']
      })
    ).toEqual({ requirePushApproval: false, agentsDeliver: true, prBases: ['dev'] })
    expect(
      parseDeliverySettingsValue({
        requirePushApproval: true,
        agentsDeliver: true,
        prBases: ['main']
      })
    ).toEqual({ requirePushApproval: true, agentsDeliver: true })
    expect(parseDeliverySettingsValue({ requirePushApproval: 'sim' })).toBeNull()
    expect(parseDeliverySettingsValue({ requirePushApproval: true, agentsDeliver: 'x' })).toEqual({
      requirePushApproval: true
    })
  })
})
