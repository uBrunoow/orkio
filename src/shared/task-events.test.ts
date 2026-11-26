import { describe, expect, it } from 'vitest'
import {
  ACTIVITY_KINDS,
  STAGE_ENTRY_KINDS,
  STAGE_EVENT_KINDS,
  TASK_EVENT_KINDS,
  activityGroup,
  eventActor,
  isSessionEvent,
  parseTaskEvent,
  type TaskEvent
} from './task-events'
import { describeEvent } from './task-history'

const ev = (kind: string, source: string, detail: unknown = null) =>
  parseTaskEvent({ kind, source, fromStage: 'a', toStage: 'b', detail })

describe('parseTaskEvent (linhas do banco, tolerante)', () => {
  it('tipo desconhecido (ex.: o antigo sync_failed) fica de fora', () => {
    expect(ev('sync_failed', 'notion')).toBeNull()
    expect(ev('qualquer', 'manual')).toBeNull()
  })

  it('campo com tipo errado ou que não existe no tipo some; o resto fica', () => {
    expect(
      ev('delivery', 'system', {
        by: 'orkio',
        action: 'push',
        owner: 'acme',
        repo: 7,
        pr: { number: 'x' },
        token: 'nunca'
      })?.detail
    ).toEqual({ by: 'orkio', action: 'push', owner: 'acme' })
    expect(ev('flow_paused', 'system', { reason: 'motivo-novo', step: null })?.detail).toEqual({
      step: null
    })
    expect(ev('moved', 'manual', 'não é objeto')?.detail).toEqual({})
  })

  it('origem fora da lista vira a do catálogo', () => {
    expect(ev('sync_ok', 'estranha')?.source).toBe('notion')
    expect(ev('moved', 'estranha')?.source).toBe('manual')
  })

  it('evento lido de linha antiga sem campos ainda tem texto', () => {
    for (const kind of TASK_EVENT_KINDS) {
      const e = ev(kind, 'manual', {})!
      expect(describeEvent(e, () => 'X')).not.toBe(kind)
    }
  })
})

describe('classificações derivadas do catálogo', () => {
  it('grupos da atividade: automação sem efeito e sync_ok ficam de fora', () => {
    const group = (kind: string, source: string, detail: unknown = {}) =>
      activityGroup(ev(kind, source, detail)!)
    expect(group('moved', 'manual')).toBe('board')
    expect(group('moved', 'system')).toBe('board')
    expect(group('moved', 'automation')).toBe('automation')
    expect(group('automation', 'automation', { outcome: 'noop' })).toBeNull()
    expect(group('automation', 'automation', { outcome: 'skipped' })).toBe('automation')
    expect(group('sync_ok', 'notion')).toBeNull()
    expect(group('delivery', 'system')).toBe('delivery')
    expect(group('gate_waiting', 'system')).toBe('flow')
    // O filtro por grupo acha o que `activityGroup` põe nele: "moved" cai em quadro ou automação.
    expect(ACTIVITY_KINDS.board).toContain('moved')
    expect(ACTIVITY_KINDS.automation).toContain('moved')
    expect(Object.values(ACTIVITY_KINDS).flat()).not.toContain('sync_ok')
  })

  it('etapas: toda entrada muda a etapa; a volta pela recusa do Notion muda sem ser entrada', () => {
    expect(STAGE_ENTRY_KINDS.every((k) => STAGE_EVENT_KINDS.includes(k))).toBe(true)
    expect(STAGE_EVENT_KINDS).toContain('rolled_back')
    expect(STAGE_ENTRY_KINDS).not.toContain('rolled_back')
  })

  it('a sessão esconde o que a execução já conta', () => {
    expect(TASK_EVENT_KINDS.filter((kind) => !isSessionEvent({ kind }))).toEqual([
      'sync_ok',
      'git_flow',
      'run_started',
      'run_finished',
      'run_cancelled',
      'run_failed',
      'run_blocked',
      'step_started',
      'step_finished'
    ])
  })

  it('autor: agente vence; depois o tipo; depois a origem', () => {
    const actor = (e: TaskEvent | null) => eventActor(e!)
    expect(actor(ev('run_started', 'system', { agent: 'Ana' }))).toEqual({
      kind: 'agent',
      name: 'Ana'
    })
    expect(actor(ev('run_failed', 'system'))).toEqual({ kind: 'claude' })
    expect(actor(ev('gate_revised', 'manual'))).toEqual({ kind: 'you' })
    expect(actor(ev('delivery', 'system'))).toEqual({ kind: 'github' })
    expect(actor(ev('artifact_published', 'manual'))).toEqual({ kind: 'notion' })
    expect(actor(ev('step_failed', 'system'))).toEqual({ kind: 'flow' })
    // Antes era um caso especial no renderer (sync_ok gravado como 'manual').
    expect(actor(ev('sync_ok', 'notion'))).toEqual({ kind: 'notion' })
    expect(actor(ev('moved', 'automation'))).toEqual({ kind: 'automation' })
    expect(actor(ev('moved', 'system'))).toEqual({ kind: 'orkio' })
    expect(actor(ev('moved', 'manual'))).toEqual({ kind: 'you' })
  })
})

describe('describeEvent', () => {
  it('motivo da pausa vem da mesma tabela do fluxo (FLOW_PAUSE_LABEL)', () => {
    expect(describeEvent(ev('flow_paused', 'system', { reason: 'gate_timeout' })!, () => '')).toBe(
      'Fluxo parado: A aprovação expirou'
    )
    expect(describeEvent(ev('flow_paused', 'system', {})!, () => '')).toBe(
      'Fluxo parado: motivo desconhecido'
    )
  })
})
