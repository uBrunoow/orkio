import { describe, expect, it } from 'vitest'
import { NOTION_COLOR_TONE, WORKSPACE_HEALTH } from './status-text'

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
