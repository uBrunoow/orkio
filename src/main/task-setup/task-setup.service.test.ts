import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { builtinAgent, BUILTIN_AGENT_KEYS } from '../../shared/agent-presets'
import { NATIVE_FLOW_IDS } from '../../shared/native-flows'
import { TASK_SETUP_MESSAGES } from '../../shared/task-setup'
import { createOrkioConfigStore } from '../config/orkio-config'
import { openDatabase, type Db } from '../db/database'
import { TaskSetupService } from './task-setup.service'

let dir: string
let db: Db
let config: ReturnType<typeof createOrkioConfigStore>
let stage: string | null
let active: boolean
let assigned: { key: string; manual: boolean } | null

function service(): TaskSetupService {
  return new TaskSetupService({
    db,
    config,
    currentStage: () => stage,
    assignment: () => assigned,
    agentName: async (_p, key) => (key === BUILTIN_AGENT_KEYS.implementer ? 'Implementador' : key),
    runtime: async (_p, key) => ({
      key,
      profile: builtinAgent(key.replace('builtin:', '')) ?? builtinAgent('revisor')!
    }),
    agentFlow: async () => null,
    hasActiveFlow: () => active
  })
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'orkio-setup-'))
  db = openDatabase(':memory:')
  config = createOrkioConfigStore(join(dir, 'orkio-config.json'))
  await config.load()
  await config.update((c) => ({
    ...c,
    boards: {
      p1: {
        stages: [
          {
            id: 's-todo',
            name: 'A fazer',
            role: 'queue',
            order: 0,
            notionStatus: { id: 'a', name: 'A' },
            color: null
          },
          {
            id: 's-dev',
            name: 'Em andamento',
            role: 'work',
            order: 1,
            notionStatus: { id: 'b', name: 'B' },
            color: null
          },
          {
            id: 's-rev',
            name: 'Revisado',
            role: 'reviewed',
            order: 2,
            notionStatus: { id: 'c', name: 'C' },
            color: null
          }
        ],
        orkioStageProperty: null,
        blockedProperty: null,
        rules: [],
        updatedAt: '2026-11-24T00:00:00.000Z'
      }
    } as never
  }))
  stage = 's-dev'
  active = false
  assigned = null
})
afterEach(async () => {
  db.close()
  await rm(dir, { recursive: true, force: true })
})

describe('TaskSetupService', () => {
  it('padrão da coluna → troca da tarefa → "herdado da coluna X"', async () => {
    const s = service()
    await s.saveColumn('p1', 's-dev', { mode: 'approval', evidence: true })
    let view = await s.view('p1', 't1')
    expect(view.stage).toEqual({ id: 's-dev', name: 'Em andamento' })
    expect(view.effective.values).toMatchObject({ mode: 'approval', evidence: true })
    expect(view.effective.from).toMatchObject({
      mode: 'column',
      evidence: 'column',
      reviewer: 'app'
    })
    expect(view.runs).toEqual({ kind: 'native', mode: 'approval' })

    view = await s.save('p1', 't1', { mode: 'quick' })
    expect(view.task).toEqual({ mode: 'quick' })
    expect(view.effective.from.mode).toBe('task')
    expect(view.runs).toEqual({ kind: 'native', mode: 'quick' })
    // `{}` volta a herdar tudo.
    expect((await s.save('p1', 't1', {})).task).toEqual({})
    // A config guarda só o padrão da coluna (o que a tarefa troca fica no banco).
    const disk = JSON.parse(await readFile(join(dir, 'orkio-config.json'), 'utf8'))
    expect(disk.runSetup).toEqual({ p1: { 's-dev': { mode: 'approval', evidence: true } } })
  })

  it('travado com fluxo ativo; revisor igual a quem implementa é recusado', async () => {
    const s = service()
    active = true
    await expect(s.save('p1', 't1', { mode: 'quick' })).rejects.toMatchObject({
      code: 'locked',
      message: TASK_SETUP_MESSAGES.locked
    })
    expect((await s.view('p1', 't1')).locked).toBe(true)
    active = false
    assigned = { key: 'repo:ana', manual: true }
    await expect(s.save('p1', 't1', { reviewer: 'repo:ana' })).rejects.toMatchObject({
      code: 'same_reviewer'
    })
  })

  it('nativePlan: coluna com modo roda; a tarefa troca só onde a coluna roda (ou à mão)', async () => {
    const s = service()
    // Coluna sem modo e sem fluxo: a troca da tarefa só vale em "Rodar agora".
    await s.save('p1', 't1', { mode: 'steps', reviewer: 'none' })
    expect(await s.nativePlan('p1', 't1', 's-dev', false)).toBeNull()
    const manual = await s.nativePlan('p1', 't1', 's-dev', true)
    expect(manual).toMatchObject({ source: 'task', reviewer: null })
    expect(manual!.flow.id).toBe(NATIVE_FLOW_IDS.steps)

    await s.saveColumn('p1', 's-dev', { mode: 'quick', model: 'opus' })
    await s.save('p1', 't1', {})
    const column = await s.nativePlan('p1', 't1', 's-dev', false)
    expect(column).toMatchObject({ source: 'column', model: 'opus' })
    expect(column!.reviewer?.key).toBe(BUILTIN_AGENT_KEYS.reviewer)
    expect(column!.flow.steps.some((st) => st.id === 'revisar')).toBe(true)

    // Revisado: a mesma escolha vira "corrigir comentários da PR"; a fila não roda nada.
    await s.saveColumn('p1', 's-rev', { mode: 'quick' })
    expect((await s.nativePlan('p1', 't1', 's-rev', false))!.flow.id).toBe(
      NATIVE_FLOW_IDS.prComments
    )
    await s.saveColumn('p1', 's-todo', { mode: 'quick' })
    expect(await s.nativePlan('p1', 't1', 's-todo', false)).toBeNull()
  })

  it('coluna inexistente é recusada', async () => {
    await expect(service().saveColumn('p1', 'x', { mode: 'quick' })).rejects.toMatchObject({
      code: 'bad_stage'
    })
  })
})
