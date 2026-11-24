import { describe, expect, it } from 'vitest'
import {
  PHASE_LABELS_MIN_WIDTH,
  SIDE_PANEL_MIN_WIDTH,
  compactPhaseBar,
  taskLayout
} from './task-layout'

describe('taskLayout', () => {
  it('abaixo de 1200 px o painel vai para cima da conversa', () => {
    expect(taskLayout(SIDE_PANEL_MIN_WIDTH - 1)).toBe('stacked')
    expect(taskLayout(SIDE_PANEL_MIN_WIDTH)).toBe('columns')
  })
})

describe('compactPhaseBar', () => {
  it('abaixo de 1280 px só a fase de agora mostra o rótulo', () => {
    expect(compactPhaseBar(1000)).toBe(true)
    expect(compactPhaseBar(PHASE_LABELS_MIN_WIDTH - 1)).toBe(true)
    expect(compactPhaseBar(PHASE_LABELS_MIN_WIDTH)).toBe(false)
  })
})
