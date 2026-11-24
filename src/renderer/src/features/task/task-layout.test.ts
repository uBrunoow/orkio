import { describe, expect, it } from 'vitest'
import {
  PHASE_LABELS_MIN_WIDTH,
  SIDE_PANEL_MIN_WIDTH,
  compactPhaseBar,
  taskLayout
} from './task-layout'

describe('taskLayout', () => {
  it('abaixo de 1200 px o painel vai para cima da conversa', () => {
    expect(SIDE_PANEL_MIN_WIDTH).toBe(1200)
    expect(taskLayout(1199)).toBe('stacked')
    expect(taskLayout(1200)).toBe('columns')
  })
})

describe('compactPhaseBar', () => {
  it('abaixo de 1280 px só a fase de agora mostra o rótulo', () => {
    expect(PHASE_LABELS_MIN_WIDTH).toBe(1280)
    expect(compactPhaseBar(1000)).toBe(true)
    expect(compactPhaseBar(1279)).toBe(true)
    expect(compactPhaseBar(1280)).toBe(false)
  })
})
