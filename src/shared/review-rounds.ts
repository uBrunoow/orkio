/**
 * "Revisão até ficar limpo" (Fase 3): o revisor (outro agente, só leitura) responde com achados de
 * ID estável em três seções (Bloqueios / Detalhes / Evidência); o Orkio grava a resposta em
 * `.orkio/revisao/rodada-N.md`, conta os bloqueios e decide a próxima volta:
 *
 * - sem bloqueios → **limpo** (segue para o seu gate do diff);
 * - os mesmos IDs de bloqueio da rodada anterior → **travado** (as voltas pararam de avançar);
 * - chegou ao limite de rodadas com bloqueios → **esgotado**;
 * - senão → **corrigir** (quem implementou corrige e o revisor olha de novo).
 *
 * O diff da revisão também é do Orkio (`.orkio/revisao/diff.md`, escrito antes de cada rodada): o
 * revisor lê arquivos, não precisa pedir para rodar `git diff`.
 *
 * Puro (main e renderer). O main faz o disco (`main/flows/review-round-actions.ts`).
 */
import { SCRATCH_DIR } from './orkio-scratch'
import { normalizeLabel } from './text'

export const REVIEW_ROUNDS_DIR = `${SCRATCH_DIR}/revisao`
/** Diff da branch contra a base, commits e arquivos novos (o Orkio escreve antes de cada rodada). */
export const REVIEW_DIFF_PATH = `${REVIEW_ROUNDS_DIR}/diff.md`

export function reviewRoundPath(round: number): string {
  return `${REVIEW_ROUNDS_DIR}/rodada-${round}.md`
}

/** Rodadas de revisão no máximo (a 1ª e mais duas depois de correções). */
export const REVIEW_MAX_ROUNDS = 3

/** Variáveis do fluxo gravadas pelas ações de revisão (`shared/orkio-actions.ts` declara). */
export const REVIEW_VARS = {
  round: 'revisao.rodada',
  file: 'revisao.arquivo',
  previous: 'revisao.anterior',
  blockers: 'revisao.bloqueios',
  details: 'revisao.detalhes',
  ids: 'revisao.ids',
  verdict: 'revisao.veredito'
} as const

export const REVIEW_VERDICTS = ['limpo', 'corrigir', 'esgotado', 'travado'] as const
export type ReviewVerdict = (typeof REVIEW_VERDICTS)[number]

export interface ReviewFinding {
  /** Estável entre rodadas (`B-1`, `D-2`...); sem ID no texto = derivado do conteúdo. */
  id: string
  text: string
}

export interface ParsedReview {
  blockers: ReviewFinding[]
  details: ReviewFinding[]
  evidence: string
}

const ID = /^(?:\[|\*\*|`)?([A-Z]{1,3}-?\d{1,4})(?:\]|\*\*|`)?\s*(?:[:—–-]\s*)?/
const ITEM = /^\s*(?:[-*+]|\d{1,3}[.)])\s+(.*)$/

type Section = 'blockers' | 'details' | 'evidence' | null

function sectionOf(heading: string): Section {
  const h = normalizeLabel(heading.replace(/[#*_`:]/g, ' '))
  if (/^bloque/.test(h) || /^blocker/.test(h)) return 'blockers'
  if (/^detalhe/.test(h) || /^nit/.test(h) || /^sugest/.test(h)) return 'details'
  if (/^evidenc/.test(h) || /^evidence/.test(h)) return 'evidence'
  return null
}

/** ID curto do texto (achado sem ID): o mesmo texto dá o mesmo ID. */
function textId(prefix: string, text: string): string {
  let h = 0x811c9dc5
  for (const ch of normalizeLabel(text)) {
    h ^= ch.codePointAt(0)!
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return `${prefix}-${h.toString(36).slice(0, 6)}`
}

/**
 * Lê a resposta do revisor. `null` = não achou a seção de bloqueios (a resposta não seguiu o
 * formato combinado). Uma linha "Nenhum." não é achado: só itens de lista contam.
 */
export function parseReviewRound(text: string): ParsedReview | null {
  const out: ParsedReview = { blockers: [], details: [], evidence: '' }
  let section: Section = null
  let sawBlockers = false
  const evidence: string[] = []
  for (const raw of text.replace(/\r\n/g, '\n').split('\n')) {
    const heading = /^\s{0,3}#{1,6}\s+(.*)$/.exec(raw) ?? /^\s*\*\*([^*]+)\*\*\s*:?\s*$/.exec(raw)
    if (heading) {
      const next = sectionOf(heading[1]!)
      if (next === 'blockers') sawBlockers = true
      section = next
      continue
    }
    if (section === 'evidence') {
      evidence.push(raw)
      continue
    }
    if (section !== 'blockers' && section !== 'details') continue
    const item = ITEM.exec(raw)
    if (!item) {
      // Continuação do item anterior (linha indentada).
      const list = out[section]
      if (/^\s{2,}\S/.test(raw) && list.length > 0) {
        list[list.length - 1]!.text += ` ${raw.trim()}`
      }
      continue
    }
    const body = item[1]!.trim()
    if (!body || /^(nenhum|nenhuma|nada|none|n\/a)\b/i.test(normalizeLabel(body))) continue
    const m = ID.exec(body)
    const textPart = m ? body.slice(m[0].length).trim() : body
    const prefix = section === 'blockers' ? 'B' : 'D'
    const id = m ? m[1]!.replace(/^([A-Z]+)(\d)/, '$1-$2') : textId(prefix, textPart)
    out[section].push({ id, text: textPart || body })
  }
  out.evidence = evidence.join('\n').trim()
  return sawBlockers ? out : null
}

/** Conjunto ordenado de IDs (para comparar rodadas). */
export function idSet(ids: readonly string[]): string {
  return [...new Set(ids)].sort().join(',')
}

export function decideRound(input: {
  round: number
  max: number
  blockerIds: readonly string[]
  /** IDs de bloqueio da rodada anterior (`''` = primeira rodada). */
  previousIds: string
}): ReviewVerdict {
  if (input.blockerIds.length === 0) return 'limpo'
  if (input.previousIds !== '' && idSet(input.blockerIds) === input.previousIds) return 'travado'
  if (input.round >= input.max) return 'esgotado'
  return 'corrigir'
}

export const REVIEW_VERDICT_TEXT: Record<ReviewVerdict, string> = {
  limpo: 'sem bloqueios',
  corrigir: 'volta para correção',
  esgotado: 'limite de rodadas atingido',
  travado: 'os mesmos bloqueios voltaram'
}

/** Linha que fica no passo do fluxo (ex.: "Rodada 2: 1 bloqueio (B-1), 2 detalhes · volta para correção"). */
export function roundSummary(round: number, parsed: ParsedReview, verdict: ReviewVerdict): string {
  const b = parsed.blockers.length
  const d = parsed.details.length
  const ids = b > 0 ? ` (${parsed.blockers.map((f) => f.id).join(', ')})` : ''
  return `Rodada ${round}: ${b} ${b === 1 ? 'bloqueio' : 'bloqueios'}${ids}, ${d} ${d === 1 ? 'detalhe' : 'detalhes'} · ${REVIEW_VERDICT_TEXT[verdict]}`
}

/** Conteúdo do `rodada-N.md`: cabeçalho do Orkio + a resposta do revisor como veio (já redigida). */
export function roundFile(round: number, reviewer: string | null, text: string): string {
  const by = reviewer ? ` · ${reviewer}` : ''
  return `<!-- Gravado pelo Orkio: revisão, rodada ${round}${by}. -->\n\n${text.trim()}\n`
}
