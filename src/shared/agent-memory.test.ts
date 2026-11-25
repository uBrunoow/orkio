import { describe, expect, it } from 'vitest'
import {
  MEMORY_LIMITS,
  MEMORY_MESSAGES,
  fitMemory,
  isMemoryDate,
  localDate,
  memoryPercent,
  memoryPrompt,
  memorySummary,
  memoryUsed,
  noteId,
  normalizeNoteText,
  parseMemory,
  parseRememberInput,
  serializeMemory,
  serializeNote,
  validateNoteInput,
  type MemoryNote
} from './agent-memory'

const note = (text: string, over: Partial<MemoryNote> = {}): MemoryNote => ({
  text,
  date: '2026-11-24',
  projectId: null,
  until: null,
  ...over
})

describe('formato do MEMORY.md', () => {
  it('serializa uma linha por nota com data, escopo e validade', () => {
    expect(serializeNote(note('Atualizações curtas'))).toBe(
      '- [2026-11-24 · geral] Atualizações curtas'
    )
    expect(serializeNote(note('Deploy congelado', { projectId: 'p-1', until: '2027-01-31' }))).toBe(
      '- [2026-11-24 · projeto:p-1 · até 2027-01-31] Deploy congelado'
    )
    expect(serializeNote(note('Sem data', { date: null }))).toBe('- [geral] Sem data')
  })

  it('round-trip: parse(serialize(notas)) devolve as mesmas notas e o texto canônico', () => {
    const notes = [
      note('Um'),
      note('Dois', { projectId: 'abc', until: '2027-02-01' }),
      note('Três', { date: null })
    ]
    const text = serializeMemory(notes)
    expect(parseMemory(text)).toEqual(notes)
    expect(serializeMemory(parseMemory(text))).toBe(text)
  })

  it('parse nunca lança: linhas à mão, colchetes que não são do formato, lixo', () => {
    const text = [
      '# Memória',
      '<!-- comentário -->',
      '',
      'Linha solta editada à mão',
      '* [x] tarefa com colchete',
      '- [2026-13-40 · geral] data impossível',
      '- [2026-11-01 · geral] repetida',
      '- [2026-11-01 · geral] repetida',
      '-    ',
      `- [2026-11-01 · geral] ${'a'.repeat(1500)}`
    ].join('\r\n')
    const notes = parseMemory(text)
    expect(notes[0]).toEqual(note('Linha solta editada à mão', { date: null }))
    expect(notes[1]!.text).toBe('[x] tarefa com colchete')
    expect(notes[2]!.text).toBe('[2026-13-40 · geral] data impossível')
    expect(notes.filter((n) => n.text === 'repetida')).toHaveLength(1)
    expect(notes.at(-1)!.text).toHaveLength(MEMORY_LIMITS.noteMax)
    expect(() => parseMemory(undefined as unknown as string)).not.toThrow()
  })

  it('id estável pelo conteúdo: muda quando a nota muda', () => {
    expect(noteId(note('Um'))).toBe(noteId(note('Um')))
    expect(noteId(note('Um'))).not.toBe(noteId(note('Um', { until: '2027-01-01' })))
    expect(noteId(note('Um'))).toMatch(/^[0-9a-f]{8}$/)
  })

  it('texto: quebras viram espaço', () => {
    expect(normalizeNoteText('  a\nb\r\n\tc  ')).toBe('a b c')
  })
})

describe('orçamento e vencidas', () => {
  it('vencidas (até < hoje) saem; a do dia ainda vale', () => {
    const r = fitMemory(
      [note('velha', { until: '2026-11-23' }), note('hoje', { until: '2026-11-24' })],
      '2026-11-24'
    )
    expect(r.notes.map((n) => n.text)).toEqual(['hoje'])
    expect(r.archived.map((n) => n.text)).toEqual(['velha'])
  })

  it('acima do orçamento, as datadas mais antigas vão para as arquivadas; sem data fica', () => {
    const notes = [
      note('sem data', { date: null }),
      note('nova', { date: '2026-11-20' }),
      note('antiga', { date: '2026-01-01' }),
      note('meio', { date: '2026-06-01' })
    ]
    const budget = memoryUsed(notes) - 1
    const r = fitMemory(notes, '2026-11-24', budget)
    expect(r.archived.map((n) => n.text)).toEqual(['antiga'])
    expect(r.overflow).toBe(false)
    const tight = fitMemory(notes, '2026-11-24', 10)
    expect(tight.notes.map((n) => n.text)).toEqual(['sem data'])
    expect(tight.overflow).toBe(true)
  })

  it('% cheio', () => {
    expect(memoryPercent({ used: 0, budget: 8000 })).toBe(0)
    expect(memoryPercent({ used: 10, budget: 8000 })).toBe(1)
    expect(memoryPercent({ used: 4000, budget: 8000 })).toBe(50)
    expect(memoryPercent({ used: 9000, budget: 8000 })).toBe(100)
  })
})

describe('resumo para o prompt', () => {
  const now = new Date(2026, 10, 24, 12)

  it('só válidas e do escopo, mais recentes primeiro, sem data por último', () => {
    const s = memorySummary(
      [
        note('sem data', { date: null }),
        note('antiga', { date: '2026-01-01' }),
        note('de outro projeto', { projectId: 'p2' }),
        note('deste projeto', { projectId: 'p1', date: '2026-11-20', until: '2026-12-01' }),
        note('vencida', { until: '2026-11-01' }),
        note('recente')
      ],
      { projectId: 'p1', now }
    )
    expect(s.split('\n')).toEqual([
      '- recente',
      '- deste projeto (vale até 2026-12-01)',
      '- antiga',
      '- sem data'
    ])
  })

  it('limitado em caracteres', () => {
    const notes = Array.from({ length: 50 }, (_, i) => note(`nota ${i} ${'x'.repeat(80)}`))
    const s = memorySummary(notes, { projectId: null, now, max: 500 })
    expect(s.length).toBeLessThanOrEqual(500)
    expect(s).toContain('nota 49')
  })

  it('texto fixo da ferramenta: sem segredos, curtas, o nome da ferramenta', () => {
    const p = memoryPrompt('', 'mcp__orkio__lembrar')
    expect(p).toContain('mcp__orkio__lembrar')
    expect(p).toContain('Nunca guarde segredos')
    expect(p).toContain('nenhuma nota')
    expect(memoryPrompt('- a', 'x')).toContain('- a')
  })
})

describe('entrada', () => {
  it('datas reais', () => {
    expect(isMemoryDate('2026-02-28')).toBe(true)
    expect(isMemoryDate('2026-02-30')).toBe(false)
    expect(isMemoryDate('26-1-1')).toBe(false)
    expect(localDate(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05')
  })

  it('valida texto e validade', () => {
    const today = '2026-11-24'
    expect(validateNoteInput({ text: ' \n ', scope: 'geral', until: null }, today)).toBe(
      MEMORY_MESSAGES.empty
    )
    expect(validateNoteInput({ text: 'a'.repeat(1001), scope: 'geral', until: null }, today)).toBe(
      MEMORY_MESSAGES.tooLong
    )
    expect(validateNoteInput({ text: 'a', scope: 'geral', until: '2026-11-23' }, today)).toBe(
      MEMORY_MESSAGES.pastDate
    )
    expect(validateNoteInput({ text: 'a', scope: 'projeto', until: '2026-11-24' }, today)).toBe(
      null
    )
  })

  it('ferramenta lembrar: { texto, escopo?, ate? }', () => {
    const today = '2026-11-24'
    expect(parseRememberInput({ texto: 'Use pnpm' }, today)).toEqual({
      ok: true,
      value: { text: 'Use pnpm', scope: 'geral', until: null }
    })
    expect(parseRememberInput({ texto: 'x', escopo: 'projeto', ate: '2027-01-01' }, today)).toEqual(
      { ok: true, value: { text: 'x', scope: 'projeto', until: '2027-01-01' } }
    )
    expect(parseRememberInput({ texto: 'x', escopo: 'tudo' }, today).ok).toBe(false)
    expect(parseRememberInput({ texto: 'x', ate: 'amanhã' }, today).ok).toBe(false)
    expect(parseRememberInput({}, today).ok).toBe(false)
  })
})
