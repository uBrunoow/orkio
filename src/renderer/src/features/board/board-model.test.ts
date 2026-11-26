import { describe, expect, it } from 'vitest'
import {
  DEFAULT_STAGE_TEMPLATE,
  stageWithRole,
  type BoardCard,
  type BoardStage
} from '../../../../shared/board'
import type { PersonalTask } from '../../../../shared/task-lanes'
import {
  NO_STAGE,
  OTHER_STAGES,
  attentionCount,
  boardEntries,
  boardSelection,
  collapsedBoardProject,
  dropStageFor,
  roleBoardColumns,
  singleBoardColumns,
  taskKey,
  visibleEntries,
  type BoardEntry,
  type ProjectBoardInput
} from './board-model'

const card = (
  taskId: string,
  stageId: string | null,
  extra: Partial<BoardCard> = {}
): BoardCard => ({
  taskId,
  displayId: taskId.toUpperCase(),
  title: `Tarefa ${taskId}`,
  url: null,
  status: null,
  priority: null,
  assignees: [],
  stageId,
  blocked: false,
  automationPaused: false,
  gitStage: null,
  sync: { state: 'synced' },
  ...extra
})

const stage = (id: string, name: string, order: number, role?: BoardStage['role']): BoardStage => ({
  id,
  name,
  order,
  ...(role ? { role } : {}),
  notionStatus: { id: null, name }
})

const A: ProjectBoardInput = {
  projectId: 'pa',
  projectName: 'site',
  stages: DEFAULT_STAGE_TEMPLATE.map((t, i) => stage(`st-${i + 1}`, t.name, i, t.role)),
  cards: [card('a1', 'st-1'), card('a2', 'st-2')]
}
const B: ProjectBoardInput = {
  projectId: 'pb',
  projectName: 'api',
  stages: [
    stage('prio', 'Prioridades', 0, 'queue'),
    stage('fazendo', 'Fazendo', 1, 'work'),
    stage('fin', 'Finalizada', 2)
  ],
  cards: [card('b-work', 'fazendo'), card('b-done', 'fin'), card('b-none', null)]
}
const C: ProjectBoardInput = {
  projectId: 'pc',
  projectName: 'sem-quadro',
  stages: null,
  cards: [card('c1', null)]
}

describe('board-model', () => {
  it('roles: colunas na ordem dos papéis, sem as que nenhum projeto tem, e "Outras etapas"', () => {
    const entries = boardEntries([A, B, C], 'roles', new Map(), new Map())
    expect(roleBoardColumns([A, B, C], entries).map((c) => c.name)).toEqual([
      'A fazer',
      'Trabalhando',
      'Em revisão',
      'Revisada',
      'Concluída',
      'Outras etapas'
    ])
  })

  it('roles: dicas e etapa da cor', () => {
    const entries = boardEntries([A, B], 'roles', new Map(), new Map())
    const cols = roleBoardColumns([A, B], entries)
    expect(cols.find((c) => c.id === 'work')).toMatchObject({
      hint: 'Etapas: Em andamento, Fazendo',
      aside: '',
      role: 'work'
    })
    expect(cols.find((c) => c.id === 'work')?.stage?.id).toBe('st-2')
    expect(cols.at(-1)).toMatchObject({
      id: OTHER_STAGES,
      hint: 'Etapas sem papel; não dá para soltar aqui',
      stage: null,
      role: null
    })
  })

  it('roles: sem entrada em "Outras etapas", a coluna não aparece', () => {
    const entries = boardEntries([A], 'roles', new Map(), new Map())
    expect(roleBoardColumns([A], entries).map((c) => c.id)).not.toContain(OTHER_STAGES)
  })

  it('roles: etapa sem papel e card sem etapa vão para Outras etapas com o nome', () => {
    const e = boardEntries([B], 'roles', new Map(), new Map())
    expect(e.find((x) => x.card.taskId === 'b-done')).toMatchObject({
      columnId: OTHER_STAGES,
      stageName: 'Finalizada'
    })
    expect(e.find((x) => x.card.taskId === 'b-none')).toMatchObject({
      columnId: OTHER_STAGES,
      stageName: 'Sem etapa'
    })
    expect(e.find((x) => x.card.taskId === 'b-work')).toMatchObject({
      columnId: 'work',
      stageName: null
    })
  })

  it('projeto sem quadro fica fora; a mesma tarefa em dois projetos tem duas chaves', () => {
    const same = { ...B, cards: [{ ...A.cards[0]! }] }
    const e = boardEntries([A, same, C], 'roles', new Map(), new Map())
    expect(e.some((x) => x.projectId === C.projectId)).toBe(false)
    const keys = e.filter((x) => x.card.taskId === A.cards[0]!.taskId).map((x) => x.key)
    expect(new Set(keys).size).toBe(2)
  })

  it('liga PersonalTask e sinais pela chave do projeto', () => {
    const p = { lane: 'working' } as PersonalTask
    const sig = { a1: { branch: null } } as never
    const [first, second] = boardEntries(
      [A],
      'single',
      new Map([[taskKey('pa', 'a1'), p]]),
      new Map([['pa', sig]])
    )
    expect(first?.personal).toBe(p)
    expect(first?.signals).toBe((sig as Record<string, unknown>).a1)
    expect(second?.personal).toBeNull()
    expect(second?.signals).toBeUndefined()
  })

  it('dropStageFor: etapa do papel no projeto do card; sem papel ou Outras etapas = null', () => {
    const [a] = boardEntries([A], 'roles', new Map(), new Map())
    const [b] = boardEntries([B], 'roles', new Map(), new Map())
    expect(dropStageFor(a!, 'done', 'roles')).toBe(stageWithRole(A.stages!, 'done'))
    expect(dropStageFor(b!, 'done', 'roles')).toBeNull()
    expect(dropStageFor(b!, OTHER_STAGES, 'roles')).toBeNull()
    expect(dropStageFor(a!, NO_STAGE, 'single')).toBeNull()
    expect(dropStageFor(a!, 'st-2', 'single')).toBe('st-2')
  })

  it('single: etapas reais e "Sem etapa" só quando há card', () => {
    const e = boardEntries([A], 'single', new Map(), new Map())
    const cols = singleBoardColumns(A.stages!, e)
    expect(cols.map((c) => c.name)).toEqual(A.stages!.map((s) => s.name))
    expect(cols[0]).toMatchObject({
      hint: 'Status no Notion: Prioridades',
      aside: 'Notion: Prioridades'
    })
    const loose = { ...A, cards: [...A.cards, { ...A.cards[0]!, taskId: 'a-x', stageId: null }] }
    const e2 = boardEntries([loose], 'single', new Map(), new Map())
    expect(singleBoardColumns(A.stages!, e2).at(-1)).toMatchObject({
      id: NO_STAGE,
      name: 'Sem etapa',
      hint: 'Status do Notion que nenhuma etapa usa',
      aside: 'Sem etapa'
    })
    expect(e2.find((x) => x.card.taskId === 'a-x')).toMatchObject({
      columnId: NO_STAGE,
      stageName: null
    })
  })

  describe('visibleEntries/attentionCount', () => {
    const personal = (
      lane: PersonalTask['lane'],
      chips: PersonalTask['chips'] = []
    ): PersonalTask => ({ lane, chips }) as PersonalTask
    const P = new Map<string, PersonalTask>([
      [taskKey('pa', 'a1'), personal('needs_you')],
      [taskKey('pa', 'a2'), personal('working')],
      [taskKey('pb', 'b1'), personal('in_review', ['ci_failed'])]
    ])
    const site: ProjectBoardInput = A
    const api: ProjectBoardInput = {
      ...B,
      cards: [
        card('b1', 'fazendo', { priority: { name: 'Alta', color: 'red' } }),
        card('b2', 'fazendo')
      ]
    }
    const entries = boardEntries([site, api], 'roles', P, new Map())
    const k = (e: BoardEntry): string => e.card.taskId
    const none = { filter: 'all' as const, query: '', priority: null, onlyBlocked: false }

    it('filtra pela situação', () => {
      expect(visibleEntries(entries, 'roles', { ...none, filter: 'attention' }).map(k)).toEqual([
        'a1',
        'b1'
      ])
      expect(visibleEntries(entries, 'roles', { ...none, filter: 'active' }).map(k)).toEqual(['a2'])
      expect(visibleEntries(entries, 'roles', { ...none, filter: 'review' }).map(k)).toEqual(['b1'])
    })
    it('busca no projeto, no título e no ID; prioridade e bloqueadas', () => {
      expect(visibleEntries(entries, 'roles', { ...none, query: 'SITE' }).map(k)).toEqual([
        'a1',
        'a2'
      ])
      expect(visibleEntries(entries, 'roles', { ...none, query: 'tarefa b2' }).map(k)).toEqual([
        'b2'
      ])
      expect(visibleEntries(entries, 'roles', { ...none, query: 'a1' }).map(k)).toEqual(['a1'])
      expect(visibleEntries(entries, 'roles', { ...none, priority: 'Alta' }).map(k)).toEqual(['b1'])
      expect(visibleEntries(entries, 'roles', { ...none, onlyBlocked: true })).toEqual([])
    })
    it('com um projeto, a busca não casa pelo nome do projeto', () => {
      const single = boardEntries([site], 'single', P, new Map())
      expect(visibleEntries(single, 'single', { ...none, query: 'SITE' })).toEqual([])
      expect(visibleEntries(single, 'single', { ...none, query: 'a1' }).map(k)).toEqual(['a1'])
    })
    it('conta atenção sem filtro de busca', () => {
      expect(attentionCount(entries)).toBe(2)
    })
  })

  it('boardSelection: todos, lista filtrada, um só, nenhum', () => {
    expect(boardSelection({ projectIds: 'all' }, ['a', 'b'], 'a')).toEqual({
      kind: 'many',
      projectIds: ['a', 'b']
    })
    expect(boardSelection({ projectIds: 'all' }, ['a'], 'a')).toEqual({
      kind: 'one',
      projectId: 'a'
    })
    expect(boardSelection({ projectIds: ['b', 'x', 'b', 'a'] }, ['a', 'b'], 'a')).toEqual({
      kind: 'many',
      projectIds: ['b', 'a']
    })
    expect(boardSelection({ projectIds: ['x', 'b'] }, ['a', 'b'], 'a')).toEqual({
      kind: 'one',
      projectId: 'b'
    })
    expect(boardSelection({ projectIds: ['x'] }, ['a', 'b'], 'a')).toEqual({
      kind: 'one',
      projectId: 'a'
    })
    expect(boardSelection({}, ['a', 'b'], null)).toEqual({ kind: 'one', projectId: null })
  })

  it('collapsedBoardProject: lista que sobrou com um projeto vira o Quadro dele', () => {
    expect(collapsedBoardProject({ projectIds: ['a', 'apagado'] }, ['a', 'b'])).toBe('a')
    expect(collapsedBoardProject({ projectIds: ['a', 'b'] }, ['a', 'b'])).toBeNull()
    expect(collapsedBoardProject({ projectIds: ['apagado'] }, ['a', 'b'])).toBeNull()
    expect(collapsedBoardProject({ projectIds: 'all' }, ['a'])).toBeNull()
    expect(collapsedBoardProject({}, ['a'])).toBeNull()
  })
})
