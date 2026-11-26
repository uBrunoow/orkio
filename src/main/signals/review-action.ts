/**
 * Ação de fluxo `review_snapshot` (Task 15): o Orkio lê as threads não resolvidas da PR da tarefa
 * e grava `<worktree>/.orkio/revisao.md` para o agente (que não lê comentários da PR sozinho).
 * Variáveis: as saídas declaradas em `ORKIO_ACTIONS.review_snapshot` (pendentes e número da PR).
 */
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ACTION_VARS, ORKIO_ACTIONS } from '../../shared/orkio-actions'
import { WorktreeError } from '../claude/worktree.service'
import { ensureScratch } from '../claude/scratch'
import { REVIEW_PATH } from '../../shared/orkio-scratch'
import type { OrkioAction } from '../flows/flow-runner'
import { DomainError, errorName } from '../errors'
import { actionableCount } from '../../shared/review'
import { buildReviewMarkdown, REVIEW_MESSAGES, type ReviewThreadsService } from './review-threads'

export interface ReviewActionDeps {
  reviews: Pick<ReviewThreadsService, 'get'>
  /**
   * Garante o ambiente da tarefa (cria ou recria o worktree) e devolve o caminho. Falha lançando
   * erro; `WorktreeError` e `DomainError` trazem a mensagem pt-BR que vai para o passo.
   */
  ensureWorktree(projectId: string, taskId: string): Promise<string>
}

export function createReviewActions(deps: ReviewActionDeps): OrkioAction[] {
  const noWorktree = { code: 'no_worktree', message: REVIEW_MESSAGES.noWorktree }
  const snapshot: OrkioAction = {
    ...ORKIO_ACTIONS.review_snapshot,
    async run({ projectId, taskId }) {
      const result = await deps.reviews.get(projectId, taskId, true)
      if (!result.ok) return { ok: false, code: result.code, message: result.message }
      let root: string
      try {
        root = await deps.ensureWorktree(projectId, taskId)
      } catch (error) {
        if (error instanceof WorktreeError) {
          return { ok: false, code: `worktree_${error.code}`, message: error.message }
        }
        if (error instanceof DomainError) {
          return { ok: false, code: error.code, message: error.message }
        }
        return { ok: false, ...noWorktree }
      }
      const { pr, threads, reviews, truncated, unreadThreads } = result.value
      try {
        await ensureScratch(root)
        await writeFile(
          join(root, REVIEW_PATH),
          buildReviewMarkdown(pr.number, threads, { reviews, truncated, unreadThreads }),
          'utf8'
        )
      } catch (error) {
        console.error(`[orkio] review_snapshot: ${errorName(error)}`)
        return { ok: false, code: 'failed', message: REVIEW_MESSAGES.failed }
      }
      return {
        ok: true,
        vars: {
          [ACTION_VARS.reviewCount]: String(actionableCount(result.value)),
          [ACTION_VARS.reviewPr]: String(pr.number)
        }
      }
    }
  }
  return [snapshot]
}
