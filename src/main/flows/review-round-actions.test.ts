import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { REVIEW_VARS } from '../../shared/review-rounds'
import {
  REVIEW_DIFF_MAX,
  REVIEW_ROUND_MESSAGES,
  createReviewRoundActions,
  reviewDiffMarkdown
} from './review-round-actions'

let wt: string
beforeEach(() => {
  wt = mkdtempSync(join(tmpdir(), 'orkio-rr-'))
})
afterEach(() => rmSync(wt, { recursive: true, force: true }))

function actions(final: string | null, status: string[] = []) {
  const [prepare, record] = createReviewRoundActions({
    worktree: () => ({ path: wt, baseRef: 'origin/main' }),
    git: {
      diffText: async () => '+const token = "ghp_' + 'a'.repeat(36) + '"\n',
      diffStat: async () => ({ stat: ' a.ts | 1 +', files: ['a.ts'] }),
      commitsSince: async () => [],
      statusPorcelain: async () => status
    },
    finalText: async () => final
  })
  const ctx = (vars: Record<string, string>) =>
    ({ projectId: 'p1', taskId: 't1', vars, lastRunId: 'run-1' }) as never
  return { prepare: prepare!, record: record!, ctx }
}

describe('ações da revisão até ficar limpo', () => {
  it('o diff para o revisor: commits, arquivos novos (sem .orkio), corte e segredo redigido', async () => {
    const { prepare, ctx } = actions(null, ['?? novo.ts', '?? .orkio/briefing.md', ' M a.ts'])
    const r = await prepare.run(ctx({}))
    expect(r).toMatchObject({ ok: true, vars: { [REVIEW_VARS.round]: '1' } })
    const text = readFileSync(join(wt, '.orkio/revisao/diff.md'), 'utf8')
    expect(text).toContain('- novo.ts')
    expect(text).not.toContain('.orkio/briefing.md')
    expect(text).not.toContain('ghp_aaaa')
    const long = reviewDiffMarkdown({
      base: 'origin/main',
      commits: [],
      stat: '',
      untracked: [],
      diff: 'x'.repeat(REVIEW_DIFF_MAX + 10)
    })
    expect(long).toContain('Diff cortado')
  })

  it('rodadas seguem a contagem; depois de uma rodada limpa começa outra série', async () => {
    const { prepare, ctx } = actions(null)
    expect(
      await prepare.run(ctx({ [REVIEW_VARS.round]: '2', [REVIEW_VARS.verdict]: 'corrigir' }))
    ).toMatchObject({
      vars: { [REVIEW_VARS.round]: '3', [REVIEW_VARS.previous]: '.orkio/revisao/rodada-2.md' }
    })
    expect(
      await prepare.run(ctx({ [REVIEW_VARS.round]: '2', [REVIEW_VARS.verdict]: 'limpo' }))
    ).toMatchObject({ vars: { [REVIEW_VARS.round]: '1', [REVIEW_VARS.ids]: '' } })
  })

  it('registra a rodada no arquivo e decide; fora do formato o passo falha com motivo', async () => {
    const ok = actions('## Bloqueios\n- [B-1] a.ts:1 — quebra\n\n## Detalhes\n- Nenhum')
    expect(await ok.record.run(ok.ctx({ [REVIEW_VARS.round]: '1' }))).toMatchObject({
      ok: true,
      vars: { [REVIEW_VARS.verdict]: 'corrigir', [REVIEW_VARS.ids]: 'B-1' }
    })
    expect(readFileSync(join(wt, '.orkio/revisao/rodada-1.md'), 'utf8')).toContain('[B-1]')
    const bad = actions('Tudo certo!')
    expect(await bad.record.run(bad.ctx({}))).toEqual({
      ok: false,
      code: 'bad_review_format',
      message: REVIEW_ROUND_MESSAGES.badFormat
    })
  })
})
