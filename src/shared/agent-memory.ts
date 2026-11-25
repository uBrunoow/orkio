/**
 * Memória por agente (Fase 3): notas curtas que o agente (ferramenta "lembrar") ou você (tela
 * Agentes › Memória) guardam e que voltam no início das próximas execuções do agente. Modelo
 * puro: formato do arquivo, parse (nunca lança), serialize canônico, orçamento, vencidas, resumo
 * para o prompt e validação da entrada. O disco (pastas, histórico, digest, redação) é do main
 * (`main/agents/agent-memory.store.ts`). Sem Node nem DOM.
 *
 * Formato do `MEMORY.md` (uma nota por linha, legível e editável à mão):
 *
 * ```
 * # Memória
 * <!-- orkio: agent-memory/v1 … -->
 *
 * - [2026-11-24 · geral] Mantenha as atualizações curtas
 * - [2026-11-24 · projeto:p-123 · até 2027-01-31] O deploy de sexta está congelado
 * ```
 *
 * Dentro dos colchetes, separados por " · ": a data (AAAA-MM-DD, opcional), o escopo (`geral` ou
 * `projeto:<id do projeto onde foi anotada>`) e a validade opcional (`até AAAA-MM-DD`, inclusive).
 * Linha sem colchetes (editada à mão) = nota sem data, geral. Cabeçalhos (`#`), comentários
 * (`<!--`) e linhas vazias são ignorados.
 */

export const MEMORY_FORMAT = 'agent-memory/v1'

export const MEMORY_LIMITS = {
  /** Caracteres do texto de uma nota (sem data, escopo e validade). */
  noteMax: 1000,
  /** Caracteres do `MEMORY.md` só com as notas (linhas): acima disso, as datadas mais antigas são arquivadas. */
  budget: 8000,
  /** Caracteres do resumo que vai no início da conversa do agente. */
  summaryMax: 2000,
  /** Fotos do `MEMORY.md` guardadas no histórico. */
  historyKeep: 50,
  /** Notas guardadas no arquivo de arquivadas (as mais antigas saem). */
  archiveMax: 500
} as const

/** Escopo como a tela e a ferramenta escolhem: `projeto` = o projeto onde a nota foi anotada. */
export const MEMORY_SCOPES = ['geral', 'projeto'] as const
export type MemoryScopeChoice = (typeof MEMORY_SCOPES)[number]

export interface MemoryNote {
  text: string
  /** Dia em que foi anotada (AAAA-MM-DD); `null` = sem data (editada à mão, nunca sai pelo orçamento). */
  date: string | null
  /** `null` = geral; senão, o id do projeto onde foi anotada. */
  projectId: string | null
  /** Vale até este dia, inclusive; `null` = sem validade. */
  until: string | null
}

export interface MemoryNoteView extends MemoryNote {
  /** Hash curto da linha canônica: muda quando a nota muda. */
  id: string
  /** Passou da validade: sai do resumo e vai para as arquivadas na próxima escrita. */
  expired: boolean
}

export interface MemoryHistoryEntry {
  /** Id da foto (para "Voltar para esta versão"). */
  id: string
  /** Quando a foto foi tirada (ISO). */
  at: string
  /** Notas na foto. */
  count: number
}

/** O que a tela vê (nunca caminhos). */
export interface AgentMemoryView {
  agentKey: string
  /** Digest do `MEMORY.md` lido: toda edição da tela manda de volta (memória mudou = recusa). */
  digest: string
  notes: MemoryNoteView[]
  archived: MemoryNoteView[]
  /** Mais recentes primeiro. */
  history: MemoryHistoryEntry[]
  /** Caracteres usados e o orçamento (o cartão "% cheio"). */
  used: number
  budget: number
}

/** Nota escrita pela tela ou pela ferramenta. */
export interface MemoryNoteInput {
  text: string
  scope: MemoryScopeChoice
  until: string | null
}

export const MEMORY_MESSAGES = {
  empty: 'Escreva a nota.',
  tooLong: `A nota pode ter até ${MEMORY_LIMITS.noteMax} caracteres.`,
  badDate: 'Data de validade inválida (use AAAA-MM-DD).',
  pastDate: 'A validade já passou: escolha hoje ou um dia depois.',
  stale: 'A memória mudou; recarregue.',
  notFound: 'Essa nota não existe mais; recarregue.',
  full: 'A memória está cheia: apague ou arquive notas antes de adicionar outra.',
  noAgent: 'Esta execução não tem agente: não há memória para anotar.',
  snapshotMissing: 'Essa versão não está mais no histórico; recarregue.'
} as const

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/
const PROJECT_ID = /^[A-Za-z0-9-]{1,100}$/

/** Dia real no formato AAAA-MM-DD. */
export function isMemoryDate(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const m = DATE.exec(value)
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const dt = new Date(Date.UTC(y, mo - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d
}

/** Dia local (AAAA-MM-DD) de um instante: a data das notas e a régua das validades. */
export function localDate(now: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
}

// eslint-disable-next-line no-control-regex
const CONTROLS = /[\u0000-\u001f\u007f\u2028\u2029]+/g

/** Uma linha só: quebras (e controles) viram espaço, espaços repetidos se juntam. */
export function normalizeNoteText(text: string): string {
  return text.replace(CONTROLS, ' ').replace(/\s+/g, ' ').trim()
}

/** Hash curto (FNV-1a, 32 bits) em hexadecimal: id estável da nota pela linha canônica. */
function shortHash(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

/** Linha canônica da nota (sem a quebra). */
export function serializeNote(note: MemoryNote): string {
  const meta = [
    ...(note.date ? [note.date] : []),
    note.projectId ? `projeto:${note.projectId}` : 'geral',
    ...(note.until ? [`até ${note.until}`] : [])
  ]
  return `- [${meta.join(' · ')}] ${note.text}`
}

export function noteId(note: MemoryNote): string {
  return shortHash(serializeNote(note))
}

/** Uma linha do arquivo → nota; `null` = linha que não é nota (vazia, cabeçalho, comentário). */
function parseLine(raw: string): MemoryNote | null {
  const line = raw.trim()
  if (!line || line.startsWith('#') || line.startsWith('<!--')) return null
  let body = line.replace(/^[-*]\s+/, '')
  const note: MemoryNote = { text: '', date: null, projectId: null, until: null }
  const meta = /^\[([^\]]*)\]\s*/.exec(body)
  if (meta) {
    const tokens = meta[1]!.split('·').map((t) => t.trim())
    const known = tokens.every(
      (t) =>
        isMemoryDate(t) ||
        t === 'geral' ||
        /^projeto:[A-Za-z0-9-]{1,100}$/.test(t) ||
        /^até\s+\d{4}-\d{2}-\d{2}$/.test(t)
    )
    // Colchetes que não são do formato fazem parte do texto (ex.: "[x] tarefa").
    if (known) {
      body = body.slice(meta[0].length)
      for (const t of tokens as string[]) {
        if (DATE.test(t) && isMemoryDate(t)) note.date = t
        else if (t.startsWith('projeto:')) note.projectId = t.slice('projeto:'.length)
        else if (t.startsWith('até')) {
          const d = t.replace(/^até\s+/, '')
          if (isMemoryDate(d)) note.until = d
        }
      }
    }
  }
  note.text = normalizeNoteText(body).slice(0, MEMORY_LIMITS.noteMax)
  return note.text ? note : null
}

/** Arquivo → notas, na ordem do arquivo, sem repetidas. Nunca lança. */
export function parseMemory(text: string): MemoryNote[] {
  const seen = new Set<string>()
  const notes: MemoryNote[] = []
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const note = parseLine(raw)
    if (!note) continue
    const line = serializeNote(note)
    if (seen.has(line)) continue
    seen.add(line)
    notes.push(note)
  }
  return notes
}

const HEADER_COMMENT = `<!-- orkio: ${MEMORY_FORMAT}. Uma nota por linha: - [AAAA-MM-DD · geral|projeto:<id> · até AAAA-MM-DD] texto -->`

/** Notas → arquivo canônico (`title`: "Memória" ou "Memória arquivada"). */
export function serializeMemory(notes: readonly MemoryNote[], title = 'Memória'): string {
  const lines = notes.map(serializeNote)
  return `# ${title}\n${HEADER_COMMENT}\n${lines.length ? `\n${lines.join('\n')}\n` : ''}`
}

/** Caracteres das notas (linhas + quebra): é o que o orçamento conta. */
export function memoryUsed(notes: readonly MemoryNote[]): number {
  return notes.reduce((n, note) => n + serializeNote(note).length + 1, 0)
}

export function isExpired(note: MemoryNote, today: string): boolean {
  return note.until !== null && note.until < today
}

export function toNoteView(note: MemoryNote, today: string): MemoryNoteView {
  return { ...note, id: noteId(note), expired: isExpired(note, today) }
}

/**
 * Aplica as regras da escrita: vencidas saem; acima do orçamento, as datadas mais antigas saem
 * (as sem data ficam). `overflow` = mesmo assim acima do orçamento (só sobraram notas sem data).
 */
export function fitMemory(
  notes: readonly MemoryNote[],
  today: string,
  budget: number = MEMORY_LIMITS.budget
): { notes: MemoryNote[]; archived: MemoryNote[]; overflow: boolean } {
  const archived: MemoryNote[] = []
  const kept: MemoryNote[] = []
  for (const n of notes) (isExpired(n, today) ? archived : kept).push(n)
  let used = memoryUsed(kept)
  while (used > budget) {
    let oldest = -1
    kept.forEach((n, i) => {
      if (n.date !== null && (oldest < 0 || n.date < kept[oldest]!.date!)) oldest = i
    })
    if (oldest < 0) return { notes: kept, archived, overflow: true }
    const [out] = kept.splice(oldest, 1)
    archived.push(out!)
    used = memoryUsed(kept)
  }
  return { notes: kept, archived, overflow: false }
}

/**
 * Texto para o início da conversa: notas válidas, gerais ou deste projeto, as mais recentes
 * primeiro (sem data por último), até `max` caracteres. Vazio = nenhuma nota.
 */
export function memorySummary(
  notes: readonly MemoryNote[],
  options: { projectId: string | null; now: Date; max?: number }
): string {
  const today = localDate(options.now)
  const max = options.max ?? MEMORY_LIMITS.summaryMax
  const usable = notes
    .map((n, i) => ({ n, i }))
    .filter(
      ({ n }) => !isExpired(n, today) && (n.projectId === null || n.projectId === options.projectId)
    )
    .sort((a, b) => {
      if (a.n.date === b.n.date) return b.i - a.i
      if (a.n.date === null) return 1
      if (b.n.date === null) return -1
      return a.n.date < b.n.date ? 1 : -1
    })
  const out: string[] = []
  let size = 0
  for (const { n } of usable) {
    const line = `- ${n.text}${n.until ? ` (vale até ${n.until})` : ''}`
    if (size + line.length + 1 > max) break
    out.push(line)
    size += line.length + 1
  }
  return out.join('\n')
}

/**
 * Bloco da memória no `--append-system-prompt`: as notas (se houver) e como guardar uma nova com a
 * ferramenta `toolName` (o nome completo do CLI, ex.: `mcp__orkio__lembrar`).
 */
export function memoryPrompt(summary: string, toolName: string): string {
  const parts = ['## Sua memória']
  if (summary) {
    parts.push(
      'Notas que você guardou em tarefas anteriores (as mais recentes primeiro). Use como contexto; se alguma contradiz o pedido atual, vale o pedido.',
      summary
    )
  } else parts.push('Você ainda não guardou nenhuma nota.')
  parts.push(
    `Para guardar algo útil nas próximas tarefas, use a ferramenta \`${toolName}\` com \`texto\` (uma frase curta, até ${MEMORY_LIMITS.noteMax} caracteres), \`escopo\` ("geral" ou "projeto", só este projeto) e \`ate\` opcional (AAAA-MM-DD, quando a nota deixa de valer). Guarde só o que vai servir de novo (preferências do usuário, convenções do projeto, armadilhas que custaram tempo). Nunca guarde segredos (tokens, senhas, chaves) nem coisas que só valem nesta tarefa.`
  )
  return parts.join('\n\n')
}

/** Regras do texto e da validade (tela e ferramenta). `null` = válido. */
export function validateNoteInput(input: MemoryNoteInput, today: string): string | null {
  const text = normalizeNoteText(input.text)
  if (!text) return MEMORY_MESSAGES.empty
  if (text.length > MEMORY_LIMITS.noteMax) return MEMORY_MESSAGES.tooLong
  if (input.until !== null) {
    if (!isMemoryDate(input.until)) return MEMORY_MESSAGES.badDate
    if (input.until < today) return MEMORY_MESSAGES.pastDate
  }
  return null
}

/**
 * Entrada da ferramenta `lembrar` (`{ texto, escopo?, ate? }`, vinda do agente: `unknown`) →
 * nota válida ou o motivo, que volta ao agente.
 */
export function parseRememberInput(
  input: Record<string, unknown>,
  today: string
): { ok: true; value: MemoryNoteInput } | { ok: false; message: string } {
  const texto = input['texto']
  if (typeof texto !== 'string') return { ok: false, message: MEMORY_MESSAGES.empty }
  const escopo = input['escopo'] ?? 'geral'
  if (escopo !== 'geral' && escopo !== 'projeto') {
    return { ok: false, message: 'Escopo inválido: use "geral" ou "projeto".' }
  }
  const ate = input['ate'] ?? null
  if (ate !== null && typeof ate !== 'string')
    return { ok: false, message: MEMORY_MESSAGES.badDate }
  const value: MemoryNoteInput = { text: texto, scope: escopo, until: ate || null }
  const problem = validateNoteInput(value, today)
  return problem ? { ok: false, message: problem } : { ok: true, value }
}

/** Forma da nota vinda da tela (o main confere as regras de novo). */
export function isMemoryNoteInput(value: unknown): value is MemoryNoteInput {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const v = value as Record<string, unknown>
  return (
    typeof v['text'] === 'string' &&
    v['text'].length <= MEMORY_LIMITS.noteMax * 4 &&
    (v['scope'] === 'geral' || v['scope'] === 'projeto') &&
    (v['until'] === null || isMemoryDate(v['until']))
  )
}

/** Id de nota (hash curto) e de foto do histórico, como o main gera. */
export function isMemoryNoteId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}$/.test(value)
}

export const MEMORY_SNAPSHOT_ID = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[0-9a-f]{6}$/

export function isMemorySnapshotId(value: unknown): value is string {
  return typeof value === 'string' && MEMORY_SNAPSHOT_ID.test(value)
}

/** Digest do arquivo (sha256 em hexadecimal). */
export function isMemoryDigest(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
}

/** Id do projeto guardado na nota (o mesmo formato dos ids do Orkio). */
export function isMemoryProjectId(value: unknown): value is string {
  return typeof value === 'string' && PROJECT_ID.test(value)
}

/** % do orçamento usado (0–100, arredondado para baixo; algo usado = pelo menos 1). */
export function memoryPercent(view: Pick<AgentMemoryView, 'used' | 'budget'>): number {
  if (view.used <= 0) return 0
  return Math.max(1, Math.min(100, Math.floor((view.used / view.budget) * 100)))
}

/** O que a tela faz com uma nota além de editar (`agents.changeMemory`). */
export const MEMORY_ACTIONS = ['remove', 'archive', 'unarchive'] as const
export type MemoryAction = (typeof MEMORY_ACTIONS)[number]

/** Sugestões do estado vazio da tela Memória (viram nota com um clique). */
export const MEMORY_SUGGESTIONS = [
  'Mantenha as atualizações curtas e diretas.',
  'Responda sempre em português do Brasil.',
  'Rode a suíte de testes antes de dar a tarefa por concluída.',
  'Prefira mudanças pequenas, uma por commit.'
] as const
