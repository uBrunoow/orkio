import { describe, expect, it } from 'vitest'
import type { ActivityItem } from '../../../shared/overview'
import { flowExecutions, ruleExecutions } from './executions'

const task = (taskId: string): ActivityItem['task'] => ({
  projectId: 'p',
  projectName: 'p',
  taskId,
  displayId: taskId.toUpperCase(),
  title: null
})
const item = (
  id: number,
  group: ActivityItem['group'],
  text: string,
  taskId = 't1'
): ActivityItem => ({
  id,
  at: `2026-11-20T10:${String(id).padStart(2, '0')}:00Z`,
  group,
  task: task(taskId),
  text,
  link: null,
  section: 'history'
})

describe('ruleExecutions', () => {
  it('pega só os eventos que citam a regra pelo nome, com o resultado', () => {
    const items = [
      item(3, 'automation', 'PR mergeada (PR #7) → regra “Merge finaliza”: Revisando → Finalizada'),
      item(2, 'automation', 'PR aberta (PR #7): regra “Merge finaliza” ignorada (bloqueada)'),
      item(1, 'automation', 'PR aberta (PR #7) → regra “Outra”: A → B'),
      item(0, 'board', 'regra “Merge finaliza” citada fora de automação')
    ]
    expect(ruleExecutions(items, 'Merge finaliza').map((e) => [e.id, e.outcome, e.tone])).toEqual([
      [3, 'Moveu a tarefa', 'success'],
      [2, 'Ignorada', 'neutral']
    ])
  })
})

describe('flowExecutions', () => {
  it('pareia o início com o primeiro fim da mesma tarefa', () => {
    const items = [
      item(9, 'flow', 'Fluxo iniciado: Entregar', 't2'),
      item(8, 'flow', 'Fluxo encerrado (recusado)', 't1'),
      item(7, 'flow', 'Fluxo iniciado: Entregar por Ana', 't1'),
      item(6, 'flow', 'Fluxo concluído', 't1'),
      item(5, 'flow', 'Passo do fluxo concluído (x)', 't1'),
      item(4, 'flow', 'Fluxo iniciado: Entregar', 't1'),
      item(3, 'flow', 'Fluxo iniciado: Outro', 't1')
    ]
    expect(flowExecutions(items, 'Entregar').map((e) => [e.id, e.outcome, e.tone])).toEqual([
      [9, 'Em andamento', 'running'],
      [7, 'Recusado', 'danger'],
      [4, 'Concluído', 'success']
    ])
  })

  it('não confunde fluxos com prefixo parecido', () => {
    const items = [
      item(2, 'flow', 'Fluxo iniciado: Entregar rápido'),
      item(1, 'flow', 'Fluxo concluído')
    ]
    expect(flowExecutions(items, 'Entregar')).toEqual([])
  })
})
