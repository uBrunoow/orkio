import { describe, expect, it } from 'vitest'
import {
  findOption,
  moveNeedsStatusWrite,
  reconcile,
  suggestStages,
  validateStages,
  type BoardStage,
  type LocalTaskState,
  type ReconcileTask,
  type StatusOption
} from './board'

const OPTIONS: StatusOption[] = [
  { id: 'o-prio', name: 'Prioridades', color: 'gray' },
  { id: 'o-and', name: 'Em andamento', color: 'blue' },
  { id: 'o-fin', name: 'Finalizadas', color: 'green' },
  { id: 'o-back', name: 'Backlog', color: 'default' }
]

const STAGES = suggestStages(OPTIONS)
const [PRIO, AND, REV, REVD, FIN] = STAGES as [
  BoardStage,
  BoardStage,
  BoardStage,
  BoardStage,
  BoardStage
]

describe('suggestStages / findOption', () => {
  it('template padrão casa com as opções reais (acentos/maiúsculas ignorados)', () => {
    expect(STAGES.map((s) => [s.name, s.notionStatus.name, s.notionStatus.id])).toEqual([
      ['Prioridades', 'Prioridades', 'o-prio'],
      ['Em andamento', 'Em andamento', 'o-and'],
      ['Revisando', 'Em andamento', 'o-and'],
      ['Revisado', 'Em andamento', 'o-and'],
      ['Finalizada', 'Finalizadas', 'o-fin']
    ])
    expect(
      findOption([{ id: 'x', name: 'EM ANDAMENTO', color: 'blue' }], { name: 'em andamento' })?.id
    ).toBe('x')
    expect(
      findOption([{ id: 'x', name: 'Finalizada', color: 'blue' }], { name: 'Finalizadas' })?.id
    ).toBe('x')
    expect(
      findOption([{ id: 'x', name: 'Prioridade alta', color: 'red' }], { name: 'Prioridades' })
    ).toBeNull()
  })

  it('opção que não existe → id null (a validação bloqueia)', () => {
    const stages = suggestStages(OPTIONS.filter((o) => o.id !== 'o-fin'))
    expect(stages[4]?.notionStatus).toEqual({ id: null, name: 'Finalizadas' })
  })
})

describe('validateStages', () => {
  it('tudo certo → sem problemas; order normalizado', () => {
    const { issues, stages } = validateStages([...STAGES].reverse(), OPTIONS)
    expect(issues).toEqual([])
    expect(stages.map((s) => s.order)).toEqual([0, 1, 2, 3, 4])
  })

  it('opção inexistente → erro na etapa', () => {
    const { issues } = validateStages(
      suggestStages(OPTIONS.filter((o) => o.id !== 'o-fin')),
      OPTIONS.filter((o) => o.id !== 'o-fin')
    )
    expect(issues).toEqual([
      expect.objectContaining({
        stageId: 'stage-5',
        level: 'error',
        message: expect.stringContaining('“Finalizadas” não existe')
      })
    ])
  })

  it('opção renomeada (mesmo id) → aviso e nome atualizado', () => {
    const renamed = OPTIONS.map((o) => (o.id === 'o-fin' ? { ...o, name: 'Concluídas' } : o))
    const { issues, stages } = validateStages(STAGES, renamed)
    expect(issues).toEqual([expect.objectContaining({ level: 'warning', stageId: 'stage-5' })])
    expect(stages[4]?.notionStatus).toEqual({ id: 'o-fin', name: 'Concluídas' })
  })

  it('opção apagada no Notion (id some) → erro, mesmo com nome parecido em outra', () => {
    const { issues } = validateStages(
      STAGES,
      OPTIONS.filter((o) => o.id !== 'o-and')
    )
    expect(issues.filter((i) => i.level === 'error')).toHaveLength(3)
  })

  it('nomes vazios ou repetidos e quadro vazio', () => {
    const { issues } = validateStages(
      [
        { ...PRIO, name: ' ' },
        { ...AND, name: 'X' },
        { ...REV, name: 'x' }
      ],
      OPTIONS
    )
    expect(issues.map((i) => i.message)).toEqual([
      'Dê um nome à etapa.',
      'Já existe uma etapa “x”.'
    ])
    expect(validateStages([], OPTIONS).issues[0]?.level).toBe('error')
  })
})

describe('reconcile', () => {
  const task = (
    id: string,
    status: string | null,
    over: Partial<ReconcileTask> = {}
  ): ReconcileTask => {
    const option = OPTIONS.find((o) => o.name === status)
    return {
      id,
      status: status === null ? null : { id: option?.id ?? null, name: status },
      orkioStage: null,
      blocked: null,
      ...over
    }
  }
  const states = (entries: Record<string, Partial<LocalTaskState>>) =>
    new Map(Object.entries(entries).map(([k, v]) => [k, { stageId: null, blocked: false, ...v }]))

  it('status compatível com a etapa salva → mantém (etapa fina preservada)', () => {
    const [d] = reconcile([task('t', 'Em andamento')], states({ t: { stageId: REV.id } }), STAGES)
    expect(d).toMatchObject({ stageId: REV.id, reason: 'kept', changed: false })
  })

  it('status mudou no Notion → primeira etapa com aquele status', () => {
    const [d] = reconcile([task('t', 'Finalizadas')], states({ t: { stageId: REV.id } }), STAGES)
    expect(d).toMatchObject({
      stageId: FIN.id,
      from: REV.id,
      reason: 'moved_by_notion',
      changed: true
    })
    const [back] = reconcile(
      [task('t', 'Em andamento')],
      states({ t: { stageId: FIN.id } }),
      STAGES
    )
    expect(back).toMatchObject({ stageId: AND.id, reason: 'moved_by_notion' })
  })

  it('tarefa nova → primeira etapa com o status; "Etapa Orkio" compatível tem preferência', () => {
    const [a, b, c] = reconcile(
      [
        task('a', 'Em andamento'),
        task('b', 'Em andamento', { orkioStage: 'Revisado' }),
        task('c', 'Em andamento', { orkioStage: 'Finalizada' })
      ],
      new Map(),
      STAGES
    )
    expect(a).toMatchObject({ stageId: AND.id, reason: 'new', changed: true, from: undefined })
    expect(b).toMatchObject({ stageId: REVD.id, reason: 'new' })
    // Etapa Orkio incompatível com o status atual é ignorada.
    expect(c).toMatchObject({ stageId: AND.id })
  })

  it('status sem etapa (ou vazio) → "Sem etapa" (null)', () => {
    const [a, b, c] = reconcile(
      [task('a', 'Backlog'), task('b', null), task('c', 'Backlog')],
      states({ c: { stageId: PRIO.id } }),
      STAGES
    )
    expect(a).toMatchObject({ stageId: null, reason: 'no_stage', changed: true })
    expect(b).toMatchObject({ stageId: null, reason: 'no_stage' })
    expect(c).toMatchObject({ stageId: null, reason: 'no_stage', from: PRIO.id, changed: true })
  })

  it('saindo de "Sem etapa" quando o status passa a ter etapa', () => {
    const [d] = reconcile([task('t', 'Prioridades')], states({ t: { stageId: null } }), STAGES)
    expect(d).toMatchObject({ stageId: PRIO.id, reason: 'moved_by_notion', changed: true })
  })

  it('escrita pendente → fica onde está, mesmo com status diferente no Notion', () => {
    const [d] = reconcile(
      [task('t', 'Em andamento')],
      states({ t: { stageId: FIN.id } }),
      STAGES,
      new Set(['t'])
    )
    expect(d).toMatchObject({ stageId: FIN.id, reason: 'pending', changed: false })
  })

  it('pendente sem estado local (não deveria acontecer) → trata como nova', () => {
    const [d] = reconcile([task('t', 'Em andamento')], new Map(), STAGES, new Set(['t']))
    expect(d).toMatchObject({ stageId: AND.id, reason: 'new' })
  })

  it('etapa salva foi removida do quadro → reposiciona', () => {
    const [d] = reconcile(
      [task('t', 'Em andamento')],
      states({ t: { stageId: 'apagada' } }),
      STAGES
    )
    expect(d).toMatchObject({ stageId: AND.id, reason: 'moved_by_notion' })
  })

  it('opção renomeada no Notion (mesmo id) continua compatível', () => {
    const [d] = reconcile(
      [{ id: 't', status: { id: 'o-fin', name: 'Concluídas' }, orkioStage: null, blocked: null }],
      states({ t: { stageId: FIN.id } }),
      STAGES
    )
    expect(d).toMatchObject({ stageId: FIN.id, reason: 'kept' })
  })

  it('bloqueada: Notion manda quando mapeado; local quando não; pendente mantém local', () => {
    const [a] = reconcile(
      [task('t', 'Em andamento', { blocked: true })],
      states({ t: { stageId: AND.id } }),
      STAGES
    )
    expect(a).toMatchObject({ blocked: true, blockedChanged: true, changed: true, reason: 'kept' })
    const [b] = reconcile(
      [task('t', 'Em andamento')],
      states({ t: { stageId: AND.id, blocked: true } }),
      STAGES
    )
    expect(b).toMatchObject({ blocked: true, blockedChanged: false, changed: false })
    const [c] = reconcile(
      [task('t', 'Em andamento', { blocked: false })],
      states({ t: { stageId: AND.id, blocked: true } }),
      STAGES,
      new Set(['t'])
    )
    expect(c).toMatchObject({ blocked: true, blockedChanged: false })
  })
})

describe('moveNeedsStatusWrite', () => {
  it('só escreve quando o status do destino é diferente do atual', () => {
    expect(moveNeedsStatusWrite(REV, { id: 'o-and', name: 'Em andamento' })).toBe(false)
    expect(moveNeedsStatusWrite(FIN, { id: 'o-and', name: 'Em andamento' })).toBe(true)
    expect(moveNeedsStatusWrite(PRIO, null)).toBe(true)
  })
})
