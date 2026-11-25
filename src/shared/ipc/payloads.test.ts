import { describe, expect, it } from 'vitest'
import { defaultAgent, validateAgent } from '../agent'
import { INVALID } from './define'
import {
  parseActivityQuery,
  parseAgentProfile,
  parseAgentRules,
  parseBoardSaveInput,
  parseFlowDraft,
  parseOrchestratorConfig,
  parseSendMessageRequest,
  parseStartRunRequest,
  parseWorkspaceInput
} from './payloads'
import { isStageId, isTaskId } from './validate'

const TASK = '11111111-1111-4111-8111-000000000001'
const ok = (v: unknown): boolean => v !== INVALID

describe('conceitos: uma regra por id', () => {
  it('etapa aceita "_" (quadro antigo) e os ids gerados; recusa caminho', () => {
    for (const id of ['stage-1', 'stage-lx2k-ab12cd', 'planejando-lx2k', 'em_andamento']) {
      expect(isStageId(id)).toBe(true)
    }
    expect(isStageId('../x')).toBe(false)
    expect(isStageId('')).toBe(false)
  })

  it('tarefa é uma página do Notion (UUID com ou sem hífens)', () => {
    expect(isTaskId(TASK)).toBe(true)
    expect(isTaskId(TASK.replaceAll('-', ''))).toBe(true)
    expect(isTaskId('task-1')).toBe(false)
  })

  it('regra de agente e raia do orquestrador aceitam a mesma etapa que o quadro', () => {
    expect(parseAgentRules([{ stageId: 'em_andamento', agentKey: 'repo:ana' }])).toEqual([
      { stageId: 'em_andamento', agentKey: 'repo:ana' }
    ])
    const config = parseOrchestratorConfig({
      enabled: true,
      lanes: [{ stageId: 'em_andamento', agents: ['builtin:implementador'], next: null }]
    })
    expect(config).not.toBe(INVALID)
  })
})

describe('payloads: forma e cópia só com campos conhecidos', () => {
  it('board.save descarta campos estranhos e recusa formas erradas', () => {
    const input = {
      stages: [{ id: null, name: 'Prioridades', notionStatusId: 'o1', hack: 1 }],
      orkioStage: { mode: 'existing', propertyId: 'sel' },
      addMissingOptions: false,
      blockedPropertyId: null,
      extra: true
    }
    expect(parseBoardSaveInput(input)).toEqual({
      stages: [{ id: null, name: 'Prioridades', notionStatusId: 'o1' }],
      orkioStage: { mode: 'existing', propertyId: 'sel' },
      addMissingOptions: false,
      blockedPropertyId: null
    })
    expect(parseBoardSaveInput({ ...input, stages: [] })).toBe(INVALID)
    expect(parseBoardSaveInput({ ...input, orkioStage: { mode: 'hack' } })).toBe(INVALID)
  })

  it('bancos do Notion: só campos do mapeamento', () => {
    const input = {
      projectsDataSourceId: '11111111-1111-1111-1111-111111111111',
      tasksDataSourceId: '2222222222222222222222222222222a',
      mapping: { title: 'title', priority: null }
    }
    expect(parseWorkspaceInput(input)).toEqual(input)
    expect(parseWorkspaceInput({ ...input, mapping: { hacked: 'x' } })).toBe(INVALID)
  })

  it('rascunho do fluxo volta normalizado, sem mexer no objeto recebido', () => {
    const draft = {
      stages: [{ id: 'stage-1', name: 'A', notionStatusId: 'o1' }],
      rules: [
        {
          id: 'r1',
          name: 'r',
          enabled: true,
          trigger: 'pr.merged',
          action: { type: 'move_to_stage', stageId: 'stage-1' },
          exec: 'rm -rf /'
        }
      ],
      removals: { 'stage-2': 'stage-1' }
    }
    const before = JSON.stringify(draft)
    const parsed = parseFlowDraft(draft)
    expect(parsed).not.toBe(INVALID)
    expect(JSON.stringify(parsed)).not.toContain('exec')
    expect(JSON.stringify(draft)).toBe(before)
    expect(
      parseFlowDraft({ ...draft, stages: [{ id: '../x', name: 'A', notionStatusId: null }] })
    ).toBe(INVALID)
    expect(parseFlowDraft({ ...draft, rules: [{ id: 'x', trigger: 'pr.hack' }] })).toBe(INVALID)
    expect(parseFlowDraft({ ...draft, removals: { 'stage-2': '../y' } })).toBe(INVALID)
    const role = (r: unknown) =>
      parseFlowDraft({
        ...draft,
        stages: [{ id: 'stage-1', name: 'A', notionStatusId: null, role: r }]
      })
    expect(role('dono')).toBe(INVALID)
    const queue = role('queue')
    expect(queue !== INVALID && queue.stages[0]?.role).toBe('queue')
  })

  it('claude.start: forma, limites e só os campos conhecidos', () => {
    const base = {
      projectId: 'p1',
      taskId: TASK,
      mode: 'prompt',
      command: null,
      text: 'x',
      briefing: 'b'
    }
    expect(parseStartRunRequest({ ...base, extra: 1 })).toEqual(base)
    expect(parseStartRunRequest({ ...base, projectId: '../x' })).toBe(INVALID)
    expect(parseStartRunRequest({ ...base, mode: 'shell' })).toBe(INVALID)
    expect(parseStartRunRequest({ ...base, briefing: 'x'.repeat(300_000) })).toBe(INVALID)
  })

  it('claude.send: forma, anexos e runtime', () => {
    const base = { projectId: 'p1', taskId: TASK, text: 'x' }
    expect(ok(parseSendMessageRequest(base))).toBe(true)
    expect(ok(parseSendMessageRequest({ ...base, fresh: true, asAgent: false }))).toBe(true)
    expect(parseSendMessageRequest({ ...base, taskId: '../x' })).toBe(INVALID)
    expect(parseSendMessageRequest({ ...base, fresh: 'sim' })).toBe(INVALID)
    expect(parseSendMessageRequest({ ...base, text: 'x'.repeat(300_000) })).toBe(INVALID)

    // Fase 2: ponto da conversa (execução + resposta, ou antes do pedido).
    expect(parseSendMessageRequest({ ...base, fork: { runId: 'run-1', at: null } })).toEqual({
      ...base,
      fork: { runId: 'run-1', at: null }
    })
    expect(
      ok(
        parseSendMessageRequest({
          ...base,
          fork: { runId: 'run-1', at: '0f8c2a3e-1b2c-4d5e-8f90-123456789abc' }
        })
      )
    ).toBe(true)
    expect(parseSendMessageRequest({ ...base, fork: { runId: 'run-1', at: '--x' } })).toBe(INVALID)
    expect(parseSendMessageRequest({ ...base, fork: { runId: '../x', at: null } })).toBe(INVALID)
    const file = { name: 'a.md', mime: 'text/markdown', data: new Uint8Array(3) }
    expect(ok(parseSendMessageRequest({ ...base, attachments: [file] }))).toBe(true)
    for (const attachments of [
      Array(6).fill(file),
      [{ ...file, name: 'a'.repeat(121) }],
      [{ ...file, data: 'abc' }],
      [{ ...file, data: new Uint8Array(11 * 1024 * 1024) }],
      [{ ...file, path: '/etc/passwd' }]
    ]) {
      expect(parseSendMessageRequest({ ...base, attachments })).toBe(INVALID)
    }

    expect(ok(parseSendMessageRequest({ ...base, runtime: { effort: 'low' } }))).toBe(true)
    expect(ok(parseSendMessageRequest({ ...base, runtime: { model: 'opus', effort: null } }))).toBe(
      true
    )
    for (const runtime of [
      { model: 'a b' },
      { model: '--dangerously-x' },
      { effort: 'ultra' },
      { cmd: 'x' },
      'opus'
    ]) {
      expect(parseSendMessageRequest({ ...base, runtime })).toBe(INVALID)
    }
  })

  it('perfil do agente: só a forma; modelo/raciocínio inválidos ficam para o validateAgent', () => {
    const ana = defaultAgent({ id: 'ana', name: 'Ana', instructions: 'Testes sempre.' })
    expect(parseAgentProfile(ana)).toEqual(ana)
    expect(parseAgentProfile({ ...ana, commands: 'tudo' })).toBe(INVALID)
    expect(parseAgentProfile({ ...ana, limits: null })).toBe(INVALID)
    expect(parseAgentProfile([])).toBe(INVALID)
    expect(parseAgentProfile({ ...ana, effort: 7 })).toBe(INVALID)

    const bad = parseAgentProfile({ ...ana, model: '--x' })
    expect(bad !== INVALID && validateAgent(bad)).toContain('Modelo inválido')
    const ultra = parseAgentProfile({ ...ana, effort: 'ultra' })
    expect(ultra !== INVALID && validateAgent(ultra)).toContain('Raciocínio inválido')
    const long = parseAgentProfile({ ...ana, model: 'claude-sonnet-4-5-20250929', effort: 'high' })
    expect(long !== INVALID && validateAgent(long)).toEqual([])

    // Fase 3: campos novos opcionais (renderer antigo não manda); forma checada aqui.
    const old: Record<string, unknown> = { ...ana }
    for (const k of ['description', 'group', 'autonomy', 'command']) delete old[k]
    expect(parseAgentProfile(old)).toEqual(ana)
    const full = { ...ana, description: 'Faz', group: 'a/b', autonomy: 'ask', command: 'revisar' }
    expect(parseAgentProfile(full)).toEqual(full)
    expect(parseAgentProfile({ ...ana, description: 7 })).toBe(INVALID)
    expect(parseAgentProfile({ ...ana, command: ['x'] })).toBe(INVALID)
    const odd = parseAgentProfile({ ...ana, autonomy: 'root' })
    expect(odd !== INVALID && validateAgent(odd)).toContain('Autonomia desconhecida.')
  })

  it('filtro da atividade: só campos válidos', () => {
    expect(parseActivityQuery(undefined)).toEqual({})
    expect(
      parseActivityQuery({ projectId: 'p1', group: 'flow', beforeId: 10, limit: 999 })
    ).toEqual({ projectId: 'p1', group: 'flow', beforeId: 10, limit: 200 })
    for (const bad of [{ group: 'hack' }, { projectId: '../x' }, { beforeId: -1 }, 'x']) {
      expect(parseActivityQuery(bad)).toBe(INVALID)
    }
  })
})

describe('parseOrchestratorConfig', () => {
  const OK = {
    enabled: true,
    enabledSince: '2020-01-01T00:00:00.000Z',
    lanes: [{ stageId: 'dev', agents: ['builtin:implementador', 'repo:ana'], next: null }]
  }

  it('aceita a forma certa; enabledSince é sempre do main', () => {
    expect(parseOrchestratorConfig(OK)).toEqual({ ...OK, enabledSince: null })
  })

  it('recusa em vez de descartar: etapa ou agente repetido, chave inválida, forma errada', () => {
    const lane = OK.lanes[0]!
    for (const bad of [
      null,
      [],
      { ...OK, enabled: 'sim' },
      { ...OK, lanes: [lane, lane] },
      { ...OK, lanes: [{ ...lane, agents: ['repo:ana', 'repo:ana'] }] },
      { ...OK, lanes: [{ ...lane, agents: ['nuvem:x'] }] },
      { ...OK, lanes: [{ ...lane, next: 3 }] },
      { ...OK, lanes: Array.from({ length: 11 }, (_, i) => ({ ...lane, stageId: `s${i}` })) }
    ]) {
      expect(parseOrchestratorConfig(bad)).toBe(INVALID)
    }
  })
})
