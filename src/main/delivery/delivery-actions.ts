/**
 * Ações de entrega dos fluxos de tarefa (Etapa 5C), registradas no `FlowRunner`:
 *
 * - `push`: gate com commits, `diff --stat` e destino (se "Exigir minha aprovação para push"
 *   estiver ligado) → `git push` só da branch da tarefa, sem força.
 * - `verify_pushed`: confere se a PR já tem o commit atual (`head.sha` == HEAD do worktree);
 *   grava `pr.exists`, `pr.pushed` e `pr.number`.
 * - `request_review`: gate com os revisores (quem já revisou ou foi pedido; senão, você escolhe)
 *   → POST requested_reviewers pelo conector → a 3B vê o pedido e move a tarefa para Revisando.
 *
 * Cada ação feita vira um evento `delivery` no histórico, com link (branch ou PR).
 */
import type { TaskEventDetailInput } from '../../shared/task-events'
import type { ActionConfirm } from '../../shared/task-flow'
import type { BoardStore } from '../board/board.store'
import { GitHubApiError } from '../connectors/github/github.client'
import { errorName } from '../errors'
import type { OrkioAction } from '../flows/flow-runner'
import { DeliveryError, type DeliveryService } from './delivery.service'
import type { Result } from '../../shared/result'
import type { TaskSignalsResult } from '../../shared/task-signals'

export interface DeliveryActionsDeps {
  delivery: DeliveryService
  signals(projectId: string, force: boolean): Promise<Result<TaskSignalsResult>>
  github: {
    requestReviewers(
      owner: string,
      repo: string,
      pull: number,
      reviewers: { users: string[]; teams: string[] }
    ): Promise<void>
    listCollaborators(owner: string, repo: string): Promise<string[]>
  }
  store: Pick<BoardStore, 'addEvent'>
  /** Depois de pedir review: roda as automações já (a 3B move para Revisando). */
  runAutomation?(projectId: string): void
  now?: () => Date
}

export const DELIVERY_ACTION_MESSAGES = {
  noPr: 'Esta tarefa não tem PR aberta no GitHub. Rode o /pr antes de pedir review.',
  noReviewers: 'Escolha pelo menos um revisor.',
  signals: 'Não deu para conferir a PR no GitHub agora. Tente de novo em instantes.',
  generic: 'A ação de entrega falhou. Tente de novo.',
  github: 'O GitHub recusou o pedido de review. Tente de novo em instantes.'
} as const

const STAT_LIMIT = 4_000

export function createDeliveryActions(deps: DeliveryActionsDeps): OrkioAction[] {
  const now = (): string => (deps.now?.() ?? new Date()).toISOString()
  const event = (
    projectId: string,
    taskId: string,
    detail: Omit<TaskEventDetailInput<'delivery'>, 'by'>
  ): void =>
    deps.store.addEvent({
      taskPageId: taskId,
      projectId,
      at: now(),
      kind: 'delivery',
      detail: { by: 'orkio', ...detail }
    })

  /** PR aberta da tarefa, lida agora do GitHub (sinais da 2D com `force`). */
  async function openPull(projectId: string, taskId: string) {
    const r = await deps.signals(projectId, true)
    if (!r.ok) return { error: DELIVERY_ACTION_MESSAGES.signals } as const
    const pr = r.value.signals[taskId]?.pr ?? null
    return { pr: pr && (pr.state === 'open' || pr.state === 'draft') ? pr : null } as const
  }

  const push: OrkioAction = {
    id: 'push',
    label: 'Push da branch da tarefa',
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
        if (error instanceof DeliveryError) return { problem: error.message }
        throw error
      }
    },
    async run({ projectId, taskId }) {
      try {
        const r = await deps.delivery.push(projectId, taskId)
        event(projectId, taskId, {
          action: 'push',
          owner: r.target.owner,
          repo: r.target.repo,
          branch: r.target.branch,
          commits: r.commits
        })
        return { ok: true, vars: { 'delivery.pushed': 'sim' } }
      } catch (error) {
        if (error instanceof DeliveryError) return { ok: false, message: error.message }
        console.error(`[orkio] push: ${errorName(error)}`)
        return { ok: false, message: DELIVERY_ACTION_MESSAGES.generic }
      }
    }
  }

  const verify: OrkioAction = {
    id: 'verify_pushed',
    label: 'Conferir se a PR tem o commit atual',
    async run({ projectId, taskId }) {
      const head = await deps.delivery.head(taskId)
      const found = await openPull(projectId, taskId)
      if ('error' in found)
        return { ok: false, message: found.error ?? DELIVERY_ACTION_MESSAGES.signals }
      const pr = found.pr
      return {
        ok: true,
        vars: {
          'pr.exists': pr ? 'sim' : 'nao',
          'pr.number': pr ? String(pr.number) : '',
          'pr.pushed': pr && head && pr.headSha === head ? 'sim' : 'nao'
        }
      }
    }
  }

  async function reviewers(projectId: string, taskId: string) {
    const found = await openPull(projectId, taskId)
    if ('error' in found)
      return { problem: found.error ?? DELIVERY_ACTION_MESSAGES.signals } as const
    if (!found.pr) return { problem: DELIVERY_ACTION_MESSAGES.noPr } as const
    const pr = found.pr
    const known = [
      ...(pr.reviews ?? []).map((r) => r.author ?? null),
      ...(pr.reviewRequests ?? []).map((r) => r.reviewer ?? null)
    ].filter((x): x is string => !!x)
    return { pr, known: [...new Set(known)] } as const
  }

  const requestReview: OrkioAction = {
    id: 'request_review',
    label: 'Pedir review',
    async confirm({ projectId, taskId }) {
      const r = await reviewers(projectId, taskId)
      if ('problem' in r) return { problem: r.problem ?? DELIVERY_ACTION_MESSAGES.noPr }
      let target
      try {
        target = deps.delivery.target(projectId, taskId)
      } catch (error) {
        if (error instanceof DeliveryError) return { problem: error.message }
        throw error
      }
      const collaborators = await deps.github
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
      if ('problem' in r) return { ok: false, message: r.problem ?? DELIVERY_ACTION_MESSAGES.noPr }
      const chosen = [...new Set(input ?? r.known)]
      if (chosen.length === 0) return { ok: false, message: DELIVERY_ACTION_MESSAGES.noReviewers }
      let target
      try {
        target = deps.delivery.target(projectId, taskId)
      } catch (error) {
        if (error instanceof DeliveryError) return { ok: false, message: error.message }
        throw error
      }
      try {
        await deps.github.requestReviewers(target.owner, target.repo, r.pr.number, {
          users: chosen.filter((c) => !c.startsWith('team:')),
          teams: chosen.filter((c) => c.startsWith('team:')).map((c) => c.slice(5))
        })
      } catch (error) {
        if (error instanceof GitHubApiError) return { ok: false, message: error.message }
        console.error(`[orkio] pedir review: ${errorName(error)}`)
        return { ok: false, message: DELIVERY_ACTION_MESSAGES.github }
      }
      event(projectId, taskId, {
        action: 'review_request',
        owner: target.owner,
        repo: target.repo,
        branch: target.branch,
        reviewers: chosen.length,
        pr: { number: r.pr.number, owner: target.owner, repo: target.repo }
      })
      deps.runAutomation?.(projectId)
      return { ok: true, vars: { 'review.requested': 'sim' } }
    }
  }

  return [push, verify, requestReview]
}
