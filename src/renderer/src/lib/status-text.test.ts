import { describe, expect, it } from 'vitest'
import {
  accountName,
  connectionStatusText,
  flowRunText,
  isUpdateReady,
  prPills,
  NOTION_COLOR_TONE,
  updatePhaseText,
  WORKSPACE_HEALTH
} from './status-text'
import type { UpdateStatus } from '../../../shared/updates'

describe('cores do Notion → tom', () => {
  it('nenhuma cor do Notion vira o tom de agente rodando (marrom/laranja viravam "running")', () => {
    expect(Object.values(NOTION_COLOR_TONE)).not.toContain('running')
    expect(NOTION_COLOR_TONE.brown).toBe('neutral')
    expect(NOTION_COLOR_TONE.orange).toBe('warning')
  })

  it('cada cor tem um tom escolhido (sem cair em neutro por omissão)', () => {
    expect(NOTION_COLOR_TONE).toEqual({
      default: 'neutral',
      gray: 'neutral',
      brown: 'neutral',
      orange: 'warning',
      yellow: 'warning',
      green: 'success',
      blue: 'neutral',
      purple: 'neutral',
      pink: 'neutral',
      red: 'danger'
    })
  })
})

describe('saúde dos bancos do Notion', () => {
  it('um rótulo por estado (antes "Revisar mapeamento" era broken numa tela e warning noutra)', () => {
    const labels = Object.values(WORKSPACE_HEALTH).map((h) => h.label)
    expect(new Set(labels).size).toBe(labels.length)
    expect(WORKSPACE_HEALTH.broken).toEqual({ label: 'Tarefas bloqueadas', tone: 'danger' })
    expect(WORKSPACE_HEALTH.warning.tone).toBe('warning')
  })
})

describe('conta conectada', () => {
  const notion = { userName: 'Grace Hopper', workspaceName: 'Acme Labs' }
  it('o card diz quem conectou; os Primeiros passos, onde', () => {
    const s = { state: 'connected', account: notion, connectedAt: '2026-11-24T00:00:00Z' } as const
    expect(connectionStatusText(s).label).toBe('Conectado como Grace Hopper')
    expect(accountName(notion)).toBe('Acme Labs')
  })
})

describe('estado do fluxo', () => {
  it('gate recusado com "stop" termina como Recusado, não Concluído', () => {
    expect(flowRunText({ status: 'finished', result: 'rejected' })).toEqual({
      label: 'Recusado',
      tone: 'danger'
    })
    expect(flowRunText({ status: 'finished', result: 'done' }).label).toBe('Concluído')
    expect(flowRunText({ status: 'running', result: null }).label).toBe('Rodando')
  })
})

describe('atualização', () => {
  const status = (s: Partial<UpdateStatus>): UpdateStatus =>
    ({ mode: 'auto', phase: 'idle', version: '9.9.9', ...s }) as UpdateStatus

  it('pronta: baixada (automática) ou disponível (manual); disponível no automático ainda baixa', () => {
    expect(isUpdateReady(status({ phase: 'downloaded' }))).toBe(true)
    expect(isUpdateReady(status({ mode: 'manual', phase: 'available' }))).toBe(true)
    expect(isUpdateReady(status({ phase: 'available' }))).toBe(false)
    // Antes o token de Configurações dizia "Nova versão" aqui (ignorava o modo).
    expect(updatePhaseText(status({ phase: 'available' }))?.label).toBe('Baixando')
    expect(updatePhaseText(status({ mode: 'manual', phase: 'available' }))?.label).toBe(
      'Nova versão'
    )
    expect(updatePhaseText(status({ mode: 'disabled' }))?.label).toBe('Desligadas')
    expect(updatePhaseText(status({}))).toBeNull()
  })
})

describe('pílulas da PR', () => {
  it('ordem fixa; revisão, comentários e CI só com a PR aberta', () => {
    const open = prPills({
      state: 'open',
      reviewDecision: 'approved',
      unresolvedComments: 2,
      checks: 'failure'
    })
    expect(open.map((p) => p.kind)).toEqual(['state', 'review', 'comments', 'ci'])
    expect(open[2]?.label).toBe('2 comentários')
    const merged = prPills({
      state: 'merged',
      reviewDecision: 'approved',
      unresolvedComments: 2,
      checks: 'failure'
    })
    expect(merged.map((p) => p.kind)).toEqual(['state'])
  })
})
