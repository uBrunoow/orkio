/**
 * Ação de fluxo `review_snapshot` (Task 15): o Orkio lê as threads não resolvidas da PR da tarefa
 * e grava `<worktree>/.orkio/revisao.md` para o agente (que não lê comentários da PR sozinho).
 * Variáveis: `review.count` (threads não resolvidas) e `review.pr` (número da PR).
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { OrkioAction } from '../flows/flow-runner'
import { errorName } from '../errors'
import {
  buildReviewMarkdown,
  pendingCount,
  REVIEW_MESSAGES,
  type ReviewThreadsService
} from './review-threads'

export interface ReviewActionDeps {
  reviews: Pick<ReviewThreadsService, 'get'>
  /** Garante o ambiente da tarefa (cria ou recria o worktree) e devolve o caminho.
   * Falha lançando erro; `WorktreeError` traz a mensagem pt-BR que vai para o passo. */
  ensureWorktree(projectId: string, taskId: string): Promise<string | null>
}

export function createReviewActions(deps: ReviewActionDeps): OrkioAction[] {
  const snapshot: OrkioAction = {
    id: 'review_snapshot',
    label: 'Ler os comentários da PR',
    async run({ projectId, taskId }) {
      const result = await deps.reviews.get(projectId, taskId, true)
      if (!result.ok) return { ok: false, message: result.message }
      let root: string | null
      try {
        root = await deps.ensureWorktree(projectId, taskId)
      } catch (error) {
        // Só a mensagem pt-BR do WorktreeService (pasta em uso, branch em checkout...).
        const known = error instanceof Error && error.name === 'WorktreeError'
        return { ok: false, message: known ? error.message : REVIEW_MESSAGES.noWorktree }
      }
      if (!root) return { ok: false, message: REVIEW_MESSAGES.noWorktree }
      const { pr, threads, reviews, truncated, unreadThreads } = result.value
      try {
        const dir = join(root, '.orkio')
        await mkdir(dir, { recursive: true })
        // O briefing já cria este .gitignore; garante o mesmo se o worktree for anterior a ele.
        await writeFile(join(dir, '.gitignore'), '*\n', { flag: 'wx' }).catch(() => undefined)
        await writeFile(
          join(dir, 'revisao.md'),
          buildReviewMarkdown(pr.number, threads, { reviews, truncated, unreadThreads }),
          'utf8'
        )
      } catch (error) {
        console.error(`[orkio] review_snapshot: ${errorName(error)}`)
        return { ok: false, message: REVIEW_MESSAGES.failed }
      }
      return {
        ok: true,
        vars: {
          'review.count': String(pendingCount(result.value)),
          'review.pr': String(pr.number)
        }
      }
    }
  }
  return [snapshot]
}
