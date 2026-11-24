import { describe, expect, it } from 'vitest'
import type { DeliveryTarget } from '../../shared/delivery'
import { topLevelFields, type DeliveryKind } from './delivery-policy'
import {
  DELIVERY_ALLOWED,
  GH_READ_ALLOWED,
  POLICY_MESSAGES,
  evaluatePermission,
  type PolicyContext
} from './policy'

const WT = '/home/u/.config/orkio/worktrees/p1/ORK-7'
const BRANCH = 'ORK-7/exportar-csv'
const target: DeliveryTarget = {
  owner: 'acme',
  repo: 'app',
  remote: 'origin',
  branch: BRANCH,
  defaultBranch: 'trunk-x',
  displayId: 'ORK-7'
}

function ctx(
  over: {
    granted?: DeliveryKind[]
    requirePushApproval?: boolean
    currentBranch?: string | null
    pushDefault?: string | null
    aliases?: PolicyContext['aliases']
    delivery?: boolean
  } = {}
): PolicyContext {
  return {
    worktree: WT,
    allowRules: [{ tool: 'Bash', pattern: 'git' }],
    aliases: over.aliases ?? {},
    delivery:
      over.delivery === false
        ? null
        : {
            target,
            requirePushApproval: over.requirePushApproval ?? false,
            granted: new Set(over.granted ?? ['push', 'github']),
            pushDefault: over.pushDefault ?? null,
            currentBranch: over.currentBranch === undefined ? BRANCH : over.currentBranch
          }
  }
}
const bash = (command: string, c: PolicyContext = ctx()) =>
  evaluatePermission({ tool: 'Bash', input: { command } }, c)
const denied = (command: string, c?: PolicyContext) => {
  const d = bash(command, c)
  expect(d.decision, command).toBe('deny')
  return d.decision === 'deny' ? d.reason : ''
}
const allowed = (command: string, c?: PolicyContext) => {
  const d = bash(command, c)
  expect(d.decision, command).toBe('allow')
  return d
}

describe('modo entrega: git push', () => {
  it('push da branch da tarefa: liberado (com o registro do evento)', () => {
    for (const cmd of [
      `git push -u origin ${BRANCH}`,
      `git push origin ${BRANCH}:${BRANCH}`,
      `git push origin HEAD:${BRANCH}`,
      `git push origin refs/heads/${BRANCH}:refs/heads/${BRANCH}`,
      'git push',
      'git push origin HEAD',
      'git push -u origin HEAD',
      'git push --set-upstream origin HEAD --no-verify',
      `env GIT_TRACE=1 git push origin ${BRANCH}`,
      `git -C . push origin ${BRANCH}`,
      `git -C ${WT} push origin ${BRANCH}`
    ]) {
      expect(allowed(cmd)).toEqual({
        decision: 'allow',
        reason: DELIVERY_ALLOWED,
        delivery: [{ kind: 'push', event: 'push' }]
      })
    }
  })

  it('outra branch, main e refspec para main: bloqueados', () => {
    expect(denied('git push origin main')).toMatch(/protegida/)
    expect(denied('git push origin HEAD:main')).toMatch(/protegida/)
    expect(denied(`git push origin ${BRANCH}:main`)).toMatch(/protegida/)
    expect(denied(`git push origin ${BRANCH}:refs/heads/master`)).toMatch(/protegida/)
    expect(denied('git push origin ORK-8/outra')).toMatch(/Só a branch da tarefa/)
    expect(denied(`git push origin ${BRANCH} main`)).toMatch(/protegida/)
    expect(denied('git push origin HEAD:refs/tags/v1')).toMatch(/tags/)
    expect(denied('git push origin --tags')).toMatch(/--tags/)
    expect(denied('git push origin --all')).toMatch(/--all/)
    expect(denied('git push --mirror')).toMatch(/--mirror/)
    expect(denied(`git push origin 'refs/heads/*:refs/heads/*'`)).toMatch(/tags e outros refs/)
  })

  it('força em todas as formas: bloqueada', () => {
    for (const cmd of [
      `git push -f origin ${BRANCH}`,
      `git push --force origin ${BRANCH}`,
      `git push --force-with-lease origin ${BRANCH}`,
      `git push --force-with-lease=${BRANCH}:abc origin ${BRANCH}`,
      `git push --force-if-includes origin ${BRANCH}`,
      `git push origin +${BRANCH}`,
      `git push origin +HEAD:${BRANCH}`,
      `git push -uf origin ${BRANCH}`,
      `git push -fu origin ${BRANCH}`
    ]) {
      expect(denied(cmd), cmd).toMatch(/força/)
    }
  })

  it('remover branch remota: bloqueado', () => {
    expect(denied(`git push origin --delete ${BRANCH}`)).toMatch(/apagar/)
    expect(denied(`git push origin -d ${BRANCH}`)).toMatch(/apagar/)
    expect(denied(`git push origin :${BRANCH}`)).toMatch(/apagar/)
    expect(denied('git push --prune origin')).toMatch(/apagar/)
  })

  it('outro remote, URL, opções globais e troca de branch na mesma linha: bloqueados', () => {
    expect(denied(`git push upstream ${BRANCH}`)).toMatch(/remote do projeto/)
    expect(denied(`git push https://github.com/acme/app.git ${BRANCH}`)).toMatch(
      /remote do projeto/
    )
    expect(denied(`git -c remote.origin.push=refs/heads/main push origin`)).toBeTruthy()
    expect(denied(`git -c push.default=matching push`)).toMatch(/opção “-c”/)
    expect(denied(`git --git-dir=/x/.git push origin ${BRANCH}`)).toBeTruthy()
    expect(denied('git checkout main && git push')).toMatch(/linha separada/)
    expect(denied('git branch -m main && git push origin HEAD')).toMatch(/linha separada/)
    expect(denied('git push', ctx({ currentBranch: 'main' }))).toMatch(/protegida/)
    expect(denied('git push', ctx({ currentBranch: null }))).toMatch(/branch atual/)
    expect(denied('git push', ctx({ pushDefault: 'matching' }))).toMatch(/matching/)
    expect(denied(`git -C ../outro push origin ${BRANCH}`)).toBe(POLICY_MESSAGES.outside)
    expect(denied(`git push --receive-pack=x origin ${BRANCH}`)).toMatch(/receive-pack/)
  })

  it('aliases do git (de config e na linha de comando)', () => {
    const aliases = {
      git: { p: 'push', pf: 'push --force', sh: '!git push origin main', st: 'status' }
    }
    expect(allowed(`git p origin ${BRANCH}`, ctx({ aliases })).decision).toBe('allow')
    expect(denied(`git pf origin ${BRANCH}`, ctx({ aliases }))).toMatch(/força/)
    expect(denied('git sh', ctx({ aliases }))).toMatch(/protegida/)
    expect(denied('git -c alias.x=push x origin main', ctx({ aliases }))).toBe(
      POLICY_MESSAGES.alias
    )
    // Fora do modo entrega, o alias de push também é bloqueado.
    expect(denied(`git p origin ${BRANCH}`, ctx({ aliases, delivery: false }))).toBe(
      POLICY_MESSAGES.push
    )
    // Alias com o nome de um comando do git é ignorado pelo git: não expande.
    expect(bash('git status', ctx({ aliases: { git: { status: 'push' } } })).decision).toBe('allow')
  })

  it('aprovação: primeira vez na execução pergunta; com o ajuste, todo push pergunta', () => {
    expect(bash(`git push origin ${BRANCH}`, ctx({ granted: [] }))).toEqual({
      decision: 'ask',
      suggestion: '',
      delivery: [{ kind: 'push', event: 'push' }]
    })
    expect(bash(`git push origin ${BRANCH}`, ctx({ requirePushApproval: true })).decision).toBe(
      'ask'
    )
    expect(bash('gh pr view', ctx({ requirePushApproval: true })).decision).toBe('allow')
    // Outro trecho sem regra "sempre" na mesma linha: pergunta.
    expect(
      bash(`npm test && git push origin ${BRANCH}`, {
        ...ctx(),
        allowRules: []
      }).decision
    ).toBe('ask')
  })

  it('fora do modo entrega: tudo continua bloqueado (passo sem a marca)', () => {
    const c = ctx({ delivery: false })
    expect(denied(`git push origin ${BRANCH}`, c)).toBe(POLICY_MESSAGES.push)
    expect(denied('gh pr create --fill', c)).toBe(POLICY_MESSAGES.gh)
    expect(denied('gh api repos/acme/app/pulls', c)).toBe(POLICY_MESSAGES.gh)
  })

  it('fora do modo entrega, com o repositório do projeto: ler a PR passa, escrever não', () => {
    const c: PolicyContext = { ...ctx({ delivery: false }), allowRules: [], repo: target }
    // O caso real (alva-hub #14): ler revisões e comentários numa linha só.
    expect(
      allowed(
        "gh pr view 14 --json reviews,comments,state --jq '{state, reviews: [.reviews[] | {state}]}'; gh api repos/acme/app/pulls/14/comments --paginate",
        c
      )
    ).toEqual({ decision: 'allow', reason: GH_READ_ALLOWED })
    for (const cmd of [
      'gh pr diff 14',
      'gh pr checks 14',
      'gh pr list --state open',
      'gh run view 123 --log-failed',
      'gh api repos/{owner}/{repo}/pulls/14/reviews',
      'gh api -X GET repos/acme/app/pulls/14/comments?per_page=100',
      `gh api graphql -f query='query { repository(owner: "acme", name: "app") { pullRequest(number: 14) { reviewThreads(first: 50) { nodes { isResolved } } } } }'`
    ]) {
      allowed(cmd, c)
    }
    for (const cmd of [
      'gh pr create --fill',
      'gh pr comment 14 --body ok',
      'gh pr review 14 --approve',
      'gh pr merge 14',
      'gh api repos/acme/app/pulls/14/comments -f body=oi',
      // GET com campos: o CLI nega (não há como distinguir de um POST com campos); vai na URL.
      'gh api -X GET repos/acme/app/pulls/14/comments -f per_page=100',
      'gh api -X PATCH repos/acme/app/pulls/14 -f state=closed',
      'gh api --input body.json repos/acme/app/pulls/14/reviews',
      `gh api graphql -f query='mutation { resolveReviewThread(input: {threadId: "x"}) { clientMutationId } }'`,
      `gh api graphql -f query='mutation { unresolveReviewThread(input: {threadId: "x"}) { clientMutationId } }'`,
      'gh api repos/evil/app/pulls/14/comments',
      'gh pr view -R evil/app 14',
      'gh api graphql -f query=@q.graphql'
    ]) {
      expect(denied(cmd, c), cmd).toBe(POLICY_MESSAGES.gh)
    }
    // Leitura junto com outro comando: não bloqueia, mas pergunta (sem regra "sempre").
    expect(bash('gh pr view 14; npm test', c).decision).toBe('ask')
    // Sem repositório verificado: continua bloqueado.
    expect(denied('gh pr view 14', { ...c, repo: null })).toBe(POLICY_MESSAGES.gh)
    // No modo entrega, a regra é a da entrega (o `repo` é ignorado).
    expect(bash('gh pr view 14', ctx()).decision).toBe('allow')
  })
})

describe('modo entrega: GitHub CLI', () => {
  it('pr create/view/edit/checks/comment, run view, label list: liberados', () => {
    const cases: [string, string | null][] = [
      ['gh pr create --fill --base main', 'pr_create'],
      [`gh pr create --head ${BRANCH} --title x`, 'pr_create'],
      ['gh pr view 12 --json headRefOid', null],
      ['gh pr edit 12 --add-label bug', 'pr_edit'],
      ['gh pr checks 12 --watch', null],
      ['gh pr comment 12 --body ok', 'pr_comment'],
      ['gh run view 99 --log-failed', null],
      ['gh label list', null],
      ['gh pr view -R acme/app 12', null],
      ['gh pr view --repo=github.com/acme/app 12', null],
      ['gh pr view https://github.com/acme/app/pull/12', null]
    ]
    for (const [cmd, event] of cases) {
      expect(allowed(cmd), cmd).toMatchObject({ delivery: [{ kind: 'github', event }] })
    }
  })

  it('merge, fechar, revisar, release, repo e outro repositório: bloqueados', () => {
    expect(denied('gh pr merge 12 --squash')).toMatch(/gh pr merge/)
    expect(denied('gh pr close 12')).toMatch(/gh pr close/)
    expect(denied('gh pr review 12 --approve')).toMatch(/gh pr review/)
    expect(denied('gh pr checkout 12')).toMatch(/gh pr checkout/)
    expect(denied('gh release create v1')).toMatch(/gh release/)
    expect(denied('gh repo delete acme/app --yes')).toMatch(/gh repo/)
    expect(denied('gh run rerun 99')).toMatch(/gh run rerun/)
    expect(denied('gh label create x')).toMatch(/gh label create/)
    expect(denied('gh pr view -R evil/app 12')).toMatch(/repositório do projeto/)
    expect(denied('gh pr comment -Revil/app 12 --body x')).toMatch(/repositório do projeto/)
    expect(denied('gh pr view https://github.com/evil/app/pull/1')).toMatch(
      /repositório do projeto/
    )
    expect(denied('gh pr create --head main --fill')).toMatch(/branch da tarefa/)
    expect(denied('gh pr create --head evil:ORK-7/x --fill')).toMatch(/branch da tarefa/)
    expect(denied('gh pr comment 12 --delete-last')).toMatch(/DELETE/)
  })

  it('aliases do gh: expandidos antes da regra', () => {
    const aliases = {
      gh: {
        m: 'pr merge',
        co: 'pr checkout $1',
        v: 'pr view',
        bad: '!gh api -X DELETE repos/acme/app/git/refs/heads/x'
      }
    }
    expect(denied('gh m 12', ctx({ aliases }))).toMatch(/gh pr merge/)
    expect(denied('gh co 12', ctx({ aliases }))).toMatch(/gh pr checkout/)
    expect(denied('gh bad', ctx({ aliases }))).toMatch(/DELETE/)
    expect(allowed('gh v 12', ctx({ aliases })).decision).toBe('allow')
    expect(denied('gh m 12', ctx({ aliases, delivery: false }))).toBe(POLICY_MESSAGES.gh)
  })

  it('gh api REST: só o próprio repositório, sem DELETE, escrita só em PR/comentários', () => {
    for (const cmd of [
      'gh api repos/acme/app/pulls/12',
      'gh api /repos/acme/app/pulls/12/comments --paginate',
      'gh api repos/{owner}/{repo}/pulls/12/reviews',
      'gh api repos/acme/app/pulls/12/comments/5/replies -f body=feito',
      'gh api -X POST repos/acme/app/issues/12/comments -f body=ok',
      'gh api --method PATCH repos/acme/app/pulls/12 -f title=novo',
      'gh api repos/Acme/App/pulls/12/requested_reviewers -f "reviewers[]=ana"'
    ]) {
      expect(allowed(cmd).decision, cmd).toBe('allow')
    }
    expect(denied('gh api -X DELETE repos/acme/app/git/refs/heads/x')).toMatch(/DELETE/)
    expect(denied('gh api --method=delete repos/acme/app/issues/comments/1')).toMatch(/DELETE/)
    expect(denied('gh api repos/evil/app/pulls')).toMatch(/repositório do projeto/)
    expect(denied('gh api /repos/acme/app2/pulls')).toMatch(/repositório do projeto/)
    expect(denied('gh api user')).toMatch(/repositório do projeto/)
    expect(denied('gh api --hostname ghe.corp.com repos/acme/app/pulls')).toMatch(/github.com/)
    expect(denied('gh api -X PUT repos/acme/app/pulls/12/merge')).toMatch(/só escreve/)
    expect(denied('gh api repos/acme/app/git/refs -f ref=refs/heads/main -f sha=abc')).toMatch(
      /só escreve/
    )
    expect(denied('gh api -X PUT repos/acme/app/contents/README.md -f message=x')).toMatch(
      /só escreve/
    )
    expect(denied('gh api -X PATCH repos/acme/app/pulls/12 -f state=closed')).toMatch(
      /state=closed/
    )
    expect(denied('gh api repos/acme/app/pulls/12/reviews -f event=APPROVE')).toMatch(/event/)
    expect(denied('gh api repos/acme/app/pulls -f head=main -f base=x -f title=t')).toMatch(
      /branch da tarefa/
    )
  })

  it('gh api GraphQL: mesmo repositório e só mutations da allowlist', () => {
    expect(
      allowed(
        `gh api graphql -f query='query { repository(owner: "acme", name: "app") { pullRequest(number: 12) { reviewThreads(first: 50) { nodes { id isResolved } } } } }'`
      ).decision
    ).toBe('allow')
    expect(
      allowed(
        `gh api graphql -F owner=acme -F name=app -f query='query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { id } }'`
      ).decision
    ).toBe('allow')
    expect(
      allowed(
        `gh api graphql -f query='mutation { resolveReviewThread(input: {threadId: "T_1"}) { thread { isResolved } } }'`
      )
    ).toMatchObject({ delivery: [{ kind: 'github', event: 'thread_resolve' }] })
    expect(
      allowed(
        `gh api graphql -f query='mutation Reply($id: ID!) { a: addPullRequestReviewThreadReply(input: {pullRequestReviewThreadId: $id, body: "ok"}) { comment { id } } }'`
      )
    ).toMatchObject({ delivery: [{ event: 'thread_reply' }] })
    expect(
      denied(
        `gh api graphql -f query='mutation { mergePullRequest(input: {pullRequestId: "P"}) { clientMutationId } }'`
      )
    ).toMatch(/mergePullRequest/)
    expect(
      denied(
        `gh api graphql -f query='mutation { resolveReviewThread(input: {threadId: "T"}) { clientMutationId } deleteRef(input: {refId: "R"}) { clientMutationId } }'`
      )
    ).toMatch(/deleteRef/)
    expect(
      denied(`gh api graphql -f query='{ repository(owner: "evil", name: "app") { id } }'`)
    ).toMatch(/repositório do projeto/)
    expect(denied(`gh api graphql -F owner=evil -f query='query { viewer { login } }'`)).toMatch(
      /repositório do projeto/
    )
    expect(denied('gh api graphql -F query=@q.graphql')).toMatch(/arquivo/)
    expect(denied('gh api graphql --input q.json')).toMatch(/arquivo/)
  })

  it('campos do primeiro nível de uma mutation (com apelidos e strings)', () => {
    expect(
      topLevelFields(
        '{ a: addComment(input: {body: "x { y("}) { c } resolveReviewThread(input: {}) { t } }'
      )
    ).toEqual(['addComment', 'resolveReviewThread'])
  })
})
