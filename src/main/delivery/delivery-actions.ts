/**
 * Ações de entrega dos fluxos de tarefa (Etapa 5C), registradas no `FlowRunner`:
 *
 * - `push`: gate com commits, `diff --stat` e destino (se "Exigir minha aprovação para push"
 *   estiver ligado) → `git push` só da branch da tarefa, sem força.
 * - `verify_pushed`: confere se a PR já tem o commit atual (`head.sha` == HEAD do worktree);
 *   grava as saídas declaradas em `ORKIO_ACTIONS.verify_pushed`.
 * - `request_review`: gate com os revisores (quem já revisou ou foi pedido; senão, você escolhe)
 *   → POST requested_reviewers pelo conector → a 3B vê o pedido e move a tarefa para Revisando.
 * - `rerequest_review` (corretor da PR): o mesmo, sem gate quando há quem já revisou.
 *
 * Cada ação feita vira um evento `delivery` no histórico, com link (branch ou PR).
 */
import { ACTION_VARS, ORKIO_ACTIONS } from '../../shared/orkio-actions'
import { FLOW_NO, FLOW_YES, type ActionConfirm, type StepFailure } from '../../shared/task-flow'
import type { BoardStore } from '../board/board.store'
import { errorName } from '../errors'
import type { OrkioAction } from '../flows/flow-runner'
import { deliveryEvent, openPullFor, type SignalsFetch } from './action-helpers'
import { DeliveryError, type DeliveryService } from './delivery.service'
import { isApiError } from '../net/http'
import { GIT_ONLY_REVIEW_MESSAGE } from '../../shared/delivery'

export interface DeliveryActionsDeps {
  delivery: DeliveryService
  signals: SignalsFetch
  github: DeliveryGitHub
  /** Projeto só com git local e o `gh` logado: a API do `gh` (pede review com o teu usuário). */
  githubFor?(projectId: string): DeliveryGitHub | null
  store: Pick<BoardStore, 'addEvent'>
  /** Depois de pedir review: roda as automações já (a 3B move para Revisando). */
  runAutomation?(projectId: string): void
  /** Projeto só com git local sem o `gh` disponível: não dá para pedir review. */
  gitOnly?(projectId: string): boolean | Promise<boolean>
  now?: () => Date
}

export interface DeliveryGitHub {
  requestReviewers(
    owner: string,
    repo: string,
    pull: number,
    reviewers: { users: string[]; teams: string[] }
  ): Promise<void>
  listCollaborators(owner: string, repo: string): Promise<string[]>
}

export const DELIVERY_ACTION_MESSAGES = {
  noPr: 'Esta tarefa não tem PR aberta no GitHub. Rode o /pr antes de pedir review.',
  noReviewers: 'Escolha pelo menos um revisor.',
  generic: 'A ação de entrega falhou. Tente de novo.',
  github: 'O GitHub recusou o pedido de review. Tente de novo em instantes.'
} as const

const NO_PR: StepFailure = { code: 'no_pr', message: DELIVERY_ACTION_MESSAGES.noPr }
const failure = (error: DeliveryError): StepFailure => ({
  code: error.code,
  message: error.message
})

const STAT_LIMIT = 4_000

export function createDeliveryActions(deps: DeliveryActionsDeps): OrkioAction[] {
  const push: OrkioAction = {
    ...ORKIO_ACTIONS.push,
    async confirm({ projectId, taskId }) {
      try {
        const p = await deps.delivery.preview(projectId, taskId)
        if (p.problem) return { problem: p.problem }
        if (!deps.delivery.settings(projectId).requirePushApproval) return null
        const t = p.target
        const info: ActionConfirm = {
          title: 'Enviar a branch para o GitHub?',
          message:
            'O Orkio vai fazer git push (sem força) só da branch da tarefa, com as suas credenciais do git.',
          details: [
            { label: 'Destino', value: `${t.remote} → ${t.branch}` },
            { label: 'Repositório', value: `${t.owner}/${t.repo}` },
            {
              label: 'Branch no GitHub',
              value: p.remoteExists ? 'já existe (só commits novos)' : 'nova'
            }
          ],
          commits: p.commits.slice(0, 50),
          stat: p.stat.slice(0, STAT_LIMIT),
          approveLabel: 'Fazer push',
          link: null
        }
        return info
      } catch (error) {
        if (error instanceof DeliveryError) return { problem: failure(error) }
        throw error
      }
    },
    async run({ projectId, taskId }) {
      try {
        const r = await deps.delivery.push(projectId, taskId)
        deliveryEvent(
          deps,
          { projectId, taskId },
          {
            action: 'push',
            owner: r.target.owner,
            repo: r.target.repo,
            branch: r.target.branch,
            commits: r.commits
          }
        )
        return { ok: true }
      } catch (error) {
        if (error instanceof DeliveryError) return { ok: false, ...failure(error) }
        console.error(`[orkio] push: ${errorName(error)}`)
        return { ok: false, code: 'push_failed', message: DELIVERY_ACTION_MESSAGES.generic }
      }
    }
  }

  const verify: OrkioAction = {
    ...ORKIO_ACTIONS.verify_pushed,
    async run({ projectId, taskId }) {
      const head = await deps.delivery.head(taskId)
      const found = await openPullFor(deps.signals, projectId, taskId)
      if ('failure' in found) return { ok: false, ...found.failure }
      const pr = found.pr
      return {
        ok: true,
        vars: {
          [ACTION_VARS.prExists]: pr ? FLOW_YES : FLOW_NO,
          [ACTION_VARS.prNumber]: pr ? String(pr.number) : '',
          [ACTION_VARS.prPushed]: pr && head && pr.headSha === head ? FLOW_YES : FLOW_NO
        }
      }
    }
  }

  async function reviewers(projectId: string, taskId: string) {
    const found = await openPullFor(deps.signals, projectId, taskId)
    if ('failure' in found) return { problem: found.failure } as const
    if (!found.pr) return { problem: NO_PR } as const
    const pr = found.pr
    const known = [
      ...(pr.reviews ?? []).map((r) => r.author ?? null),
      ...(pr.reviewRequests ?? []).map((r) => r.reviewer ?? null)
    ].filter((x): x is string => !!x && x !== pr.author)
    return { pr, known: [...new Set(known)] } as const
  }

  function reviewAction(again: boolean): OrkioAction {
    return {
      ...(again ? ORKIO_ACTIONS.rerequest_review : ORKIO_ACTIONS.request_review),
      async confirm({ projectId, taskId }) {
        if (await deps.gitOnly?.(projectId)) {
          return { problem: { code: 'git_only', message: GIT_ONLY_REVIEW_MESSAGE } }
        }
        const r = await reviewers(projectId, taskId)
        if ('problem' in r) return { problem: r.problem }
        // Corretor da PR: você já aprovou o resumo; com quem revisou conhecido, pede sem outro gate.
        if (again && r.known.length > 0) return null
        let target
        try {
          target = deps.delivery.target(projectId, taskId)
        } catch (error) {
          if (error instanceof DeliveryError) return { problem: failure(error) }
          throw error
        }
        const github = deps.githubFor?.(projectId) ?? deps.github
        const collaborators = await github
          .listCollaborators(target.owner, target.repo)
          .catch(() => [] as string[])
        const options = [...new Set([...r.known, ...collaborators])].slice(0, 30)
        const info: ActionConfirm = {
          title: `Pedir review da PR #${r.pr.number}?`,
          message: r.known.length
            ? 'O Orkio vai pedir review de novo a quem já revisou ou foi pedido nesta PR.'
            : 'Ninguém revisou nem foi pedido nesta PR ainda: escolha quem deve revisar.',
          details: [
            { label: 'PR', value: `#${r.pr.number}` },
            { label: 'Repositório', value: `${target.owner}/${target.repo}` }
          ],
          input: { label: 'Revisores', options, selected: [...r.known], allowOther: true },
          approveLabel: 'Pedir review',
          link: { label: `Abrir a PR #${r.pr.number} no GitHub`, url: r.pr.url }
        }
        return info
      },
      async run({ projectId, taskId, input }) {
        const r = await reviewers(projectId, taskId)
        if ('problem' in r) return { ok: false, ...r.problem }
        const chosen = [...new Set(input ?? r.known)]
        if (chosen.length === 0) {
          return { ok: false, code: 'no_reviewers', message: DELIVERY_ACTION_MESSAGES.noReviewers }
        }
        let target
        try {
          target = deps.delivery.target(projectId, taskId)
        } catch (error) {
          if (error instanceof DeliveryError) return { ok: false, ...failure(error) }
          throw error
        }
        try {
          const github = deps.githubFor?.(projectId) ?? deps.github
          await github.requestReviewers(target.owner, target.repo, r.pr.number, {
            users: chosen.filter((c) => !c.startsWith('team:')),
            teams: chosen.filter((c) => c.startsWith('team:')).map((c) => c.slice(5))
          })
        } catch (error) {
          if (isApiError(error, 'github')) {
            return { ok: false, code: `github_${error.code}`, message: error.message }
          }
          console.error(`[orkio] pedir review: ${errorName(error)}`)
          return { ok: false, code: 'github', message: DELIVERY_ACTION_MESSAGES.github }
        }
        deliveryEvent(
          deps,
          { projectId, taskId },
          {
            action: 'review_request',
            owner: target.owner,
            repo: target.repo,
            branch: target.branch,
            reviewers: chosen.length,
            pr: { number: r.pr.number, owner: target.owner, repo: target.repo }
          }
        )
        deps.runAutomation?.(projectId)
        return { ok: true }
      }
    }
  }

  return [push, verify, reviewAction(false), reviewAction(true)]
}
