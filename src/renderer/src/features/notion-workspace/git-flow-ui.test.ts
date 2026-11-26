import { describe, expect, it } from 'vitest'
import type { GitFlowConfig, GitFlowSetup } from '../../../../shared/git-flow'
import { gitFlowEntry, savedOptionColor, stageCandidates } from './git-flow-ui'

const stage = {
  id: 'git',
  name: 'Etapa Git',
  type: 'select',
  options: [{ id: 'g1', name: 'Branch criada', color: 'yellow' as const }]
}
const url = { id: 'prl', name: 'PR', type: 'url' }
const setup = (properties: GitFlowSetup['properties']): GitFlowSetup => ({
  config: null,
  suggestion: null,
  properties
})
const config: GitFlowConfig = {
  stage: { id: 'git', name: 'Etapa Git', type: 'select' },
  options: { branch: { id: 'g1', name: 'Branch criada' } }
}

describe('gitFlowEntry', () => {
  it('sem seleção/status e nada salvo: só o aviso (sem formulário vazio)', () => {
    expect(gitFlowEntry(setup([url]), null)).toBe('no_property')
    expect(stageCandidates(setup([url]))).toEqual([])
  })
  it('carregando, com propriedade ou já salvo', () => {
    expect(gitFlowEntry(null, null)).toBe('loading')
    expect(gitFlowEntry(setup([stage, url]), null)).toBe('ready')
    expect(gitFlowEntry(null, config)).toBe('ready')
    expect(gitFlowEntry(setup([url]), config)).toBe('ready')
  })
})

describe('savedOptionColor', () => {
  it('cor da opção no schema; desconhecida = null', () => {
    expect(savedOptionColor(setup([stage]), config, 'g1')).toBe('yellow')
    expect(savedOptionColor(setup([stage]), config, 'gx')).toBeNull()
    expect(savedOptionColor(null, config, 'g1')).toBeNull()
  })
})
