/**
 * Ações da "revisão até ficar limpo" (Fase 3, `shared/review-rounds.ts`):
 *
 * - `review_prepare`: grava `.orkio/revisao/diff.md` (commits, arquivos, arquivos novos e o diff da
 *   branch contra a base, redigido e com limite) para o revisor ler com a ferramenta Read, sem
 *   pedir para rodar `git diff` (num passo só de leitura, cada comando pedia sua aprovação), e conta
 *   a rodada. Depois de uma rodada limpa (ex.: "Pedir mudanças" no gate do diff), começa outra
 *   série na rodada 1.
 * - `review_record`: lê a resposta do revisor (texto final da execução mais recente do fluxo),
 *   grava `.orkio/revisao/rodada-N.md` e decide: limpo, corrigir, esgotado ou travado.
 *
 * O worktree é o da tarefa (o main resolve). Nada vai para o git (`.orkio/` é rascunho).
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ORKIO_ACTIONS } from '../../shared/orkio-actions'
import {
  REVIEW_DIFF_PATH,
  REVIEW_MAX_ROUNDS,
  REVIEW_ROUNDS_DIR,
  REVIEW_VARS,
  decideRound,
  idSet,
  parseReviewRound,
  reviewRoundPath,
  roundFile,
  roundSummary
} from '../../shared/review-rounds'
import { isScratchPath } from '../../shared/orkio-scratch'
import { ensureScratch } from '../claude/scratch'
import { redactSecrets } from '../platform/redact'
import { errorName } from '../errors'
import type { ActionResult, OrkioAction } from './flow-runner'

/** Tamanho máximo do diff gravado para o revisor (o resto vira aviso no arquivo). */
export const REVIEW_DIFF_MAX = 400_000

export const REVIEW_ROUND_MESSAGES = {
  noWorktree: 'A tarefa não tem pasta de trabalho para revisar. Rode a implementação antes.',
  diffFailed: 'Não foi possível ler o diff da branch para a revisão.',
  noReview: 'O revisor não deixou resposta nesta rodada. Retome o passo de revisão.',
  badFormat:
    'A resposta do revisor não tem a seção “Bloqueios”. Peça para ele refazer no formato combinado (Retomar a revisão).',
  writeFailed: 'Não foi possível gravar a rodada de revisão na pasta da tarefa.'
} as const

export interface ReviewRoundDeps {
  /** Pasta e base do worktree da tarefa; `null` = sem ambiente. */
  worktree(taskId: string): { path: string; baseRef: string } | null
  git: {
    diffText(dir: string, base: string): Promise<string>
    diffStat(dir: string, base: string): Promise<{ stat: string; files: string[] }>
    commitsSince(dir: string, base: string): Promise<{ hash: string; subject: string }[]>
    statusPorcelain(dir: string): Promise<string[]>
  }
  /** Texto final de uma execução do Claude Code (`null` = sem texto). */
  finalText(runId: string): Promise<string | null>
  /** Nome de quem revisou (para o cabeçalho do arquivo), se souber. */
  reviewerName?(taskId: string): string | null
}

const fail = (code: string, message: string): ActionResult => ({ ok: false, code, message })

function num(value: string | undefined): number {
  const n = Number(value)
  return Number.isInteger(n) && n > 0 ? n : 0
}

/** Conteúdo do `diff.md` (puro, para testar). */
export function reviewDiffMarkdown(input: {
  base: string
  commits: { hash: string; subject: string }[]
  stat: string
  untracked: string[]
  diff: string
}): string {
  const cut = input.diff.length > REVIEW_DIFF_MAX
  const diff = cut ? input.diff.slice(0, REVIEW_DIFF_MAX) : input.diff
  const lines = [
    '<!-- Gravado pelo Orkio para a revisão: o diff da branch contra a base. -->',
    '',
    `# Diff da tarefa (contra ${input.base})`,
    '',
    '## Commits',
    '',
    ...(input.commits.length > 0
      ? input.commits.map((c) => `- ${c.hash} ${c.subject}`)
      : ['- (nenhum commit ainda; o diff abaixo é do que está na pasta)']),
    '',
    '## Arquivos',
    '',
    '```',
    input.stat.trim() || '(sem mudanças em arquivos versionados)',
    '```',
    ''
  ]
  if (input.untracked.length > 0) {
    lines.push(
      '## Arquivos novos (ainda fora do git)',
      '',
      ...input.untracked.map((f) => `- ${f}`),
      ''
    )
  }
  lines.push('## Diff', '', '```diff', redactSecrets(diff).replace(/```/g, '`​``'), '```', '')
  if (cut)
    lines.push(`(Diff cortado em ${REVIEW_DIFF_MAX.toLocaleString('pt-BR')} caracteres.)`, '')
  return lines.join('\n')
}

export function createReviewRoundActions(deps: ReviewRoundDeps): OrkioAction[] {
  const prepare: OrkioAction = {
    ...ORKIO_ACTIONS.review_prepare,
    async run({ taskId, vars }) {
      const wt = deps.worktree(taskId)
      if (!wt) return fail('no_worktree', REVIEW_ROUND_MESSAGES.noWorktree)
      // Rodada limpa antes (ex.: "Pedir mudanças" no gate do diff): começa outra série.
      const fresh = vars[REVIEW_VARS.verdict] === 'limpo'
      const previous = fresh ? 0 : num(vars[REVIEW_VARS.round])
      const round = previous + 1
      let content: string
      try {
        const [diff, stat, commits, status] = await Promise.all([
          deps.git.diffText(wt.path, wt.baseRef),
          deps.git.diffStat(wt.path, wt.baseRef),
          deps.git.commitsSince(wt.path, wt.baseRef).catch(() => []),
          deps.git.statusPorcelain(wt.path).catch(() => [])
        ])
        const untracked = status
          .filter((l) => l.startsWith('??'))
          .map((l) => l.slice(3).trim())
          .filter((p) => p && !isScratchPath(p))
        content = reviewDiffMarkdown({
          base: wt.baseRef,
          commits,
          stat: stat.stat,
          untracked,
          diff
        })
      } catch (error) {
        console.error(`[orkio] review_prepare (diff): ${errorName(error)}`)
        return fail('diff_failed', REVIEW_ROUND_MESSAGES.diffFailed)
      }
      try {
        await ensureScratch(wt.path)
        await mkdir(join(wt.path, REVIEW_ROUNDS_DIR), { recursive: true })
        await writeFile(join(wt.path, REVIEW_DIFF_PATH), content, 'utf8')
      } catch (error) {
        console.error(`[orkio] review_prepare (gravar): ${errorName(error)}`)
        return fail('write_failed', REVIEW_ROUND_MESSAGES.writeFailed)
      }
      return {
        ok: true,
        vars: {
          [REVIEW_VARS.round]: String(round),
          [REVIEW_VARS.file]: reviewRoundPath(round),
          [REVIEW_VARS.previous]:
            previous > 0 ? reviewRoundPath(previous) : 'nenhuma (esta é a primeira)',
          // Série nova: os bloqueios da série anterior não contam para "travado".
          ...(fresh ? { [REVIEW_VARS.ids]: '' } : {})
        },
        message: `Rodada ${round}: diff gravado em ${REVIEW_DIFF_PATH}`
      }
    }
  }

  const record: OrkioAction = {
    ...ORKIO_ACTIONS.review_record,
    async run({ taskId, vars, lastRunId }) {
      const wt = deps.worktree(taskId)
      if (!wt) return fail('no_worktree', REVIEW_ROUND_MESSAGES.noWorktree)
      const raw = lastRunId ? await deps.finalText(lastRunId).catch(() => null) : null
      if (!raw?.trim()) return fail('no_review', REVIEW_ROUND_MESSAGES.noReview)
      const text = redactSecrets(raw)
      const parsed = parseReviewRound(text)
      if (!parsed) return fail('bad_review_format', REVIEW_ROUND_MESSAGES.badFormat)
      const round = Math.max(1, num(vars[REVIEW_VARS.round]))
      const ids = parsed.blockers.map((f) => f.id)
      const verdict = decideRound({
        round,
        max: REVIEW_MAX_ROUNDS,
        blockerIds: ids,
        previousIds: vars[REVIEW_VARS.ids] ?? ''
      })
      try {
        await ensureScratch(wt.path)
        await mkdir(join(wt.path, REVIEW_ROUNDS_DIR), { recursive: true })
        await writeFile(
          join(wt.path, reviewRoundPath(round)),
          roundFile(round, deps.reviewerName?.(taskId) ?? null, text),
          'utf8'
        )
      } catch (error) {
        console.error(`[orkio] review_record: ${errorName(error)}`)
        return fail('write_failed', REVIEW_ROUND_MESSAGES.writeFailed)
      }
      return {
        ok: true,
        vars: {
          [REVIEW_VARS.blockers]: String(parsed.blockers.length),
          [REVIEW_VARS.details]: String(parsed.details.length),
          [REVIEW_VARS.ids]: idSet(ids),
          [REVIEW_VARS.verdict]: verdict
        },
        message: roundSummary(round, parsed, verdict)
      }
    }
  }
  return [prepare, record]
}
