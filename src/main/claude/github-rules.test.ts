import { describe, expect, it } from 'vitest'
import type { DeliveryTarget } from '../../shared/delivery'
import { evaluatePermission, type PolicyContext } from './policy'
import {
  GH_COMMANDS,
  GH_NEVER_FAMILIES,
  PUSH_OPTIONS,
  PUSH_SHORT,
  cliDenyInDelivery,
  cliDenyOutsideDelivery
} from './github-rules'
import { DELIVERY_RUN_SETTINGS, RUN_SETTINGS } from './runner'

const WT = '/home/u/.config/orkio/worktrees/p1/ORK-7'
const target: DeliveryTarget = {
  owner: 'acme',
  repo: 'app',
  remote: 'origin',
  branch: 'feat/ORK-7-x',
  defaultBranch: 'main',
  displayId: 'ORK-7'
}

/** `Bash(padrão)` do Claude Code: `*` casa qualquer coisa; o resto é literal, linha inteira. */
function denies(rules: readonly string[], command: string): string | null {
  for (const rule of rules) {
    const m = /^Bash\((.*)\)$/.exec(rule)
    if (!m) continue
    const re = new RegExp(
      `^${m[1]!
        .split('*')
        .map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
        .join('.*')}$`
    )
    if (re.test(command)) return rule
  }
  return null
}

const outsideCtx: PolicyContext = { worktree: WT, allowRules: [], repo: target }
const deliveryCtx: PolicyContext = {
  worktree: WT,
  allowRules: [],
  delivery: {
    target,
    requirePushApproval: false,
    granted: new Set(['push', 'github']),
    pushDefault: null,
    currentBranch: target.branch
  }
}
const decide = (command: string, ctx: PolicyContext) =>
  evaluatePermission({ tool: 'Bash', input: { command } }, ctx).decision

/** Leituras do GitHub que a política libera fora da entrega (sem perguntar). */
const READS = [
  'gh pr view 14 --json comments',
  'gh pr diff 14',
  'gh pr checks 14',
  'gh pr list',
  'gh pr status',
  'gh run view 99',
  'gh run list',
  'gh run view 99 --log-failed',
  'gh label list',
  'gh api repos/acme/app/pulls/14/comments',
  'gh api /repos/acme/app/pulls?state=open',
  'gh api repos/acme/app/pulls -X GET',
  'gh api --method GET repos/acme/app/pulls/14',
  'gh api -X HEAD repos/acme/app',
  'gh api repos/{owner}/{repo}/pulls/14/reviews --jq .[].state',
  'gh api graphql -f query=\'query { repository(owner:"acme", name:"app") { id } }\''
]

/** Formas de escrita que o modo entrega libera (a política decide; o CLI deixa passar). */
const DELIVERY_WRITES = [
  'git push',
  'git push -u origin feat/ORK-7-x',
  'git push origin HEAD:feat/ORK-7-x',
  'git push --porcelain -u origin refs/heads/feat/ORK-7-x:refs/heads/feat/ORK-7-x',
  'gh pr create --title t --body b',
  'gh pr comment 14 --body ok',
  'gh pr ready 14',
  'gh api repos/acme/app/issues/14/comments -f body=ok',
  'gh api -X PATCH repos/acme/app/pulls/14 -f title=x',
  'gh api graphql -f query=\'mutation { resolveReviewThread(input:{threadId:"T"}) { thread { id } } }\''
]

describe('tabela do GitHub/push: CLI e política dizem o mesmo', () => {
  it('nenhuma leitura cai num deny do CLI, dentro ou fora do modo entrega', () => {
    for (const cmd of READS) {
      expect(decide(cmd, outsideCtx), cmd).toBe('allow')
      expect(denies(RUN_SETTINGS.permissions.deny, cmd), cmd).toBeNull()
      expect(denies(DELIVERY_RUN_SETTINGS.permissions.deny, cmd), cmd).toBeNull()
    }
  })

  it('o que o modo entrega libera não cai no deny da entrega (e cai no de fora dela)', () => {
    for (const cmd of DELIVERY_WRITES) {
      expect(decide(cmd, deliveryCtx), cmd).toBe('allow')
      expect(denies(DELIVERY_RUN_SETTINGS.permissions.deny, cmd), cmd).toBeNull()
      expect(decide(cmd, outsideCtx), cmd).toBe('deny')
      expect(denies(RUN_SETTINGS.permissions.deny, cmd), cmd).not.toBeNull()
    }
  })

  it('todo `never` da tabela está nos dois deny do CLI (e a política nega)', () => {
    const never: string[] = []
    for (const [family, actions] of Object.entries(GH_COMMANDS)) {
      for (const [action, rule] of Object.entries(actions)) {
        if (rule.access === 'never') never.push(`gh ${family} ${action} 14`)
      }
    }
    for (const family of GH_NEVER_FAMILIES) never.push(`gh ${family} view acme/app`)
    never.push('gh api -X DELETE repos/acme/app/git/refs/heads/x')
    for (const cmd of never) {
      expect(denies(cliDenyOutsideDelivery(), cmd), cmd).not.toBeNull()
      expect(denies(cliDenyInDelivery(), cmd), cmd).not.toBeNull()
      expect(decide(cmd, deliveryCtx), cmd).toBe('deny')
      expect(decide(cmd, outsideCtx), cmd).toBe('deny')
    }
    // `git push` nunca: cada opção `never`, também na forma curta, e os refspecs `+x`/`:x`.
    const pushes = [
      ...Object.entries(PUSH_OPTIONS)
        .filter(([, r]) => r.access === 'never')
        .map(([opt]) => `git push ${opt} origin feat/ORK-7-x`),
      ...Object.entries(PUSH_SHORT)
        .filter(([, long]) => PUSH_OPTIONS[long]?.access === 'never')
        .flatMap(([c]) => [
          `git push -${c} origin feat/ORK-7-x`,
          `git push origin feat/ORK-7-x -${c}`
        ]),
      'git push --force-with-lease=main origin feat/ORK-7-x',
      'git push origin +feat/ORK-7-x',
      'git push origin :feat/ORK-7-x'
    ]
    for (const cmd of pushes) {
      expect(denies(cliDenyInDelivery(), cmd), cmd).not.toBeNull()
      expect(decide(cmd, deliveryCtx), cmd).toBe('deny')
    }
  })

  it('bug: gh api -X GET (leitura) era negado pelo CLI fora da entrega', () => {
    expect(denies(RUN_SETTINGS.permissions.deny, 'gh api repos/acme/app/pulls -X GET')).toBeNull()
    expect(
      denies(RUN_SETTINGS.permissions.deny, 'gh api repos/acme/app/pulls --method GET')
    ).toBeNull()
  })

  it('bug: a cópia do modo entrega não negava --force-if-includes, --all, --tags, +x, gh pr review|checkout', () => {
    const deny = DELIVERY_RUN_SETTINGS.permissions.deny
    for (const cmd of [
      'git push --force-if-includes origin feat/ORK-7-x',
      'git push --all origin',
      'git push --tags origin',
      'git push origin +feat/ORK-7-x',
      'gh pr review 14 --approve',
      'gh pr checkout 14'
    ]) {
      expect(denies(deny, cmd), cmd).not.toBeNull()
    }
  })

  it('GET com campos não é leitura (o gh manda POST; o CLI nega também)', () => {
    const cmd = 'gh api repos/acme/app/pulls -X GET -f state=open'
    expect(decide(cmd, outsideCtx)).toBe('deny')
    expect(denies(RUN_SETTINGS.permissions.deny, cmd)).not.toBeNull()
  })
})
