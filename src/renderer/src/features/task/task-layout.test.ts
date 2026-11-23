import { describe, expect, it } from 'vitest'
import { SIDE_PANEL_MIN_WIDTH, taskLayout } from './task-layout'

describe('taskLayout', () => {
  it('abaixo de 1200 px o painel vai para cima da conversa', () => {
    expect(SIDE_PANEL_MIN_WIDTH).toBe(1200)
    expect(taskLayout(1199)).toBe('stacked')
    expect(taskLayout(1200)).toBe('columns')
  })
})
