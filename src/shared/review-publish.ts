/**
 * Revisão publicada como `orkio[bot]` (Task 18), parte pura: o texto final da execução do Claude
 * Code que converteu a revisão vira `{ event, summary, comments }`, validado antes do gate.
 *
 * O passo de conversão é só leitura (não grava arquivo): o agente responde só com o JSON, num bloco
 * ```json ou como o texto inteiro. Inválido → o passo `publish_review` falha com explicação e nada é
 * publicado. A redação de segredos e os limites finais ficam no `GitHubReviewPoster` (main).
 */
import type { RunLogEvent } from './agent-run'

export type PublishReviewEvent = 'COMMENT' | 'REQUEST_CHANGES'

export interface PublishReviewComment {
  path: string
  line: number
  body: string
}

export interface PublishReviewAnswer {
  event: PublishReviewEvent
  summary: string
  comments: PublishReviewComment[]
}

/**
 * Limites da revisão publicada: o parser (antes do gate), o `GitHubReviewPoster` (main, antes do
 * site) e o prompt de conversão usam estes. O site revalida com os mesmos (`site/lib/contract.ts`;
 * `test/site-contract.test.ts` confere).
 */
export const REVIEW_SUMMARY_MAX = 20_000
export const REVIEW_COMMENTS_MAX = 50
export const REVIEW_COMMENT_MAX = 4_000
export const REVIEW_PATH_MAX = 1_000
/** Texto final lido no máximo (o resto não é JSON de revisão razoável). */
const ANSWER_MAX = 400_000

/** Mensagens gravadas no passo (a tela de problema reconhece por trechos: ver `flow-problem.ts`). */
export const PUBLISH_REVIEW_MESSAGES = {
  noAnswer:
    'A revisão em JSON não foi encontrada: nenhuma resposta do Claude Code neste fluxo para publicar.',
  notJson:
    'A revisão em JSON é inválida: a resposta do passo anterior não é um JSON {event, summary, comments}.',
  badEvent:
    'A revisão em JSON é inválida: "event" precisa ser REQUEST_CHANGES ou COMMENT (o Orkio nunca aprova PRs).',
  badSummary: `A revisão em JSON é inválida: "summary" precisa ser um texto de até ${REVIEW_SUMMARY_MAX.toLocaleString('pt-BR')} caracteres.`,
  tooManyComments: `A revisão em JSON é inválida: no máximo ${REVIEW_COMMENTS_MAX} comentários de linha.`,
  badComment:
    'A revisão em JSON é inválida: cada comentário precisa de "path" (arquivo), "line" (número da linha) e "body" (texto).'
} as const

/**
 * Texto da revisão sem nada que o gate não mostre como vai aparecer na PR: comentários HTML
 * (`<!-- -->`), tags HTML (elementos conhecidos e qualquer tag com atributos: `<img src>`,
 * `<details>`…) e imagens markdown (`![alt](url)` → `[imagem: alt]`, que o GitHub buscaria ao abrir
 * a PR); o `![` que sobrar é escapado (`!\[`) e caracteres invisíveis de formato (`\p{Cf}`, menos
 * o ZWJ) saem. Links ficam: o gate mostra o texto exato, com o endereço. Vale também dentro de código (um
 * tokenizador de código que divergisse do GitHub abriria brecha); tipos como `Array<string>` ficam,
 * porque não são elementos HTML nem têm atributos. Idempotente.
 */
export function sanitizeReviewText(text: string): string {
  let out = text
  let previous: string
  do {
    previous = out
    out = out
      // Caracteres invisíveis de formato (zero-width, bidi), menos o ZWJ (emojis compostos).
      .replace(/(?!\u200D)\p{Cf}/gu, '')
      .replace(/<!--[\s\S]*?(?:-->|$)/g, '')
      .replace(/<(\/?)([A-Za-z][A-Za-z0-9-]*)(\s[^<>]*)?(\/?)>/g, (tag, _c, name: string, attrs) =>
        attrs !== undefined || HTML_ELEMENTS.has(name.toLowerCase()) ? '' : tag
      )
      // URL com parênteses balanceados (um nível), para não sobrar `.png)` no texto.
      .replace(/!\[([^\]]*)\]\((?:[^()]|\([^()]*\))*\)?/g, (_m, alt: string) => imageText(alt))
      .replace(/!\[([^\]]*)\]\[[^\]]*\]/g, (_m, alt: string) => imageText(alt))
  } while (out !== previous)
  // Garantia sem parser: qualquer `![` que sobrou (referência curta `![a]` + `[a]: url`, alt com
  // colchetes…) vira `!\[`, que o GitHub mostra como texto, nunca como imagem.
  return out.replace(/!\[/g, '!\\[')
}

/** Elementos HTML (o que o GitHub renderiza ou poderia carregar); outros nomes ficam como texto. */
const HTML_ELEMENTS = new Set(
  (
    'a abbr address area article aside audio b base bdi bdo blockquote body br button canvas ' +
    'caption center cite code col colgroup data datalist dd del details dfn dialog div dl dt em ' +
    'embed fieldset figcaption figure font footer form frame frameset h1 h2 h3 h4 h5 h6 head ' +
    'header hr html i iframe image img input ins kbd label legend li link main map mark marquee ' +
    'math meta meter nav noscript object ol optgroup option output p param picture pre progress q ' +
    'rp rt ruby s samp script section select slot small source span strike strong style sub ' +
    'summary sup svg table tbody td template textarea tfoot th thead time title tr track tt u ul ' +
    'var video wbr'
  ).split(' ')
)

function imageText(alt: string): string {
  const label = alt.trim()
  return label ? `[imagem: ${label}]` : '[imagem]'
}

/** Texto final de uma execução (evento `result`); sem ele, a última mensagem do Claude. */
export function finalText(events: readonly RunLogEvent[]): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!
    if (e.kind === 'result' && e.text.trim()) return e.text
  }
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!
    if (e.kind === 'text' && e.text.trim()) return e.text
  }
  return null
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** JSON do texto: o último bloco ```json (ou ``` sem linguagem com objeto); senão o texto inteiro. */
function jsonCandidate(text: string): string {
  const blocks = [...text.matchAll(/```(json)?[ \t]*\r?\n([\s\S]*?)```/gi)]
  const tagged = blocks.filter((b) => b[1])
  const pick = (tagged.length > 0 ? tagged : blocks.filter((b) => b[2]!.trim().startsWith('{')))
    .map((b) => b[2]!)
    .at(-1)
  return (pick ?? text).trim()
}

/** Lê e valida a resposta do agente. Nunca lança. */
export function parseReviewAnswer(
  text: string | null
): { ok: true; review: PublishReviewAnswer } | { ok: false; message: string } {
  if (!text || !text.trim()) return { ok: false, message: PUBLISH_REVIEW_MESSAGES.noAnswer }
  let data: unknown
  try {
    data = JSON.parse(jsonCandidate(text.slice(0, ANSWER_MAX)))
  } catch {
    return { ok: false, message: PUBLISH_REVIEW_MESSAGES.notJson }
  }
  if (!isRecord(data)) return { ok: false, message: PUBLISH_REVIEW_MESSAGES.notJson }
  const event = data['event']
  if (event !== 'COMMENT' && event !== 'REQUEST_CHANGES') {
    return { ok: false, message: PUBLISH_REVIEW_MESSAGES.badEvent }
  }
  const summary = data['summary']
  if (typeof summary !== 'string' || !summary.trim() || summary.length > REVIEW_SUMMARY_MAX) {
    return { ok: false, message: PUBLISH_REVIEW_MESSAGES.badSummary }
  }
  const raw = data['comments'] ?? []
  if (!Array.isArray(raw)) return { ok: false, message: PUBLISH_REVIEW_MESSAGES.badComment }
  if (raw.length > REVIEW_COMMENTS_MAX) {
    return { ok: false, message: PUBLISH_REVIEW_MESSAGES.tooManyComments }
  }
  const comments: PublishReviewComment[] = []
  for (const c of raw) {
    if (
      !isRecord(c) ||
      typeof c['path'] !== 'string' ||
      !c['path'].trim() ||
      typeof c['line'] !== 'number' ||
      !Number.isSafeInteger(c['line']) ||
      c['line'] < 1 ||
      typeof c['body'] !== 'string' ||
      !c['body'].trim()
    ) {
      return { ok: false, message: PUBLISH_REVIEW_MESSAGES.badComment }
    }
    comments.push({ path: c['path'].trim(), line: c['line'], body: c['body'] })
  }
  // Comentário por linha = algo a corrigir: a revisão pede alterações (a regra "Alterações
  // pedidas → Revisado" e o fluxo de comentários dependem disso), mesmo que o agente diga COMMENT.
  return {
    ok: true,
    review: { event: comments.length > 0 ? 'REQUEST_CHANGES' : event, summary, comments }
  }
}
