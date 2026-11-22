import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defaultAgent, serializeAgent, type AgentProfile } from '../../shared/agent'
import { BUILTIN_AGENTS } from '../../shared/agent-presets'
import { BoardStore } from '../board/board.store'
import { createOrkioConfigStore } from '../config/orkio-config'
import { openDatabase, type Db } from '../db/database'
import { AgentError, AgentsService } from './agents.service'

const ANA: AgentProfile = defaultAgent({
  id: 'ana',
  name: 'Ana',
  instructions: 'Você implementa tarefas. Testes sempre.'
})

let dir: string
let projectDir: string
let localDir: string
let db: Db
let store: BoardStore
let service: AgentsService
let activeFlows: Set<string>
let emitted: string[]
let now: Date

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'orkio-agents-'))
  projectDir = join(dir, 'projeto')
  localDir = join(dir, 'userData', 'agents')
  await mkdir(projectDir, { recursive: true })
  const config = createOrkioConfigStore(join(dir, 'orkio-config.json'))
  await config.load()
  await config.update((c) => ({
    ...c,
    projects: [
      {
        id: 'p1',
        name: 'Projeto',
        localPath: projectDir,
        repo: null,
        createdAt: 'x',
        updatedAt: 'x',
        notionProject: null
      }
    ]
  }))
  db = openDatabase(':memory:')
  store = new BoardStore(db)
  activeFlows = new Set()
  emitted = []
  now = new Date(2026, 10, 20, 15, 0, 0)
  service = new AgentsService({
    db,
    store,
    config,
    localDir,
    hasActiveFlow: (taskId) => activeFlows.has(taskId),
    stageIds: () => ['s1', 's2'],
    actor: () => 'bruno',
    emit: (projectId) => emitted.push(projectId),
    now: () => now
  })
})

afterEach(async () => {
  db.close()
  await rm(dir, { recursive: true, force: true })
})

const repoFile = (id = 'ana'): string => join(projectDir, '.orkio', 'agents', `${id}.md`)

describe('perfis', () => {
  it('cria no repositório (.orkio/agents/ana.md), já aprovado, com histórico de configuração', async () => {
    const view = await service.save({ projectId: 'p1', scope: 'repo', profile: ANA, isNew: true })
    expect(view.status).toBe('ready')
    expect(view.key).toBe('repo:ana')
    expect(view.file).toBe('.orkio/agents/ana.md')
    expect(await readFile(repoFile(), 'utf8')).toBe(serializeAgent(ANA))
    expect(store.configEvents('p1')[0]?.changes).toEqual(['Agente criado: Ana (repositório)'])
    expect(emitted).toEqual(['p1'])
  })

  it('"só neste computador" grava em userData e aparece em qualquer projeto', async () => {
    await service.save({ projectId: 'p1', scope: 'local', profile: ANA, isNew: true })
    expect(await readFile(join(localDir, 'ana.md'), 'utf8')).toContain('name: "Ana"')
    const { agents } = await service.list('p1')
    expect(agents.filter((a) => a.scope !== 'builtin').map((a) => [a.key, a.status])).toEqual([
      ['local:ana', 'ready']
    ])
  })

  it('não duplica id, não troca id e recusa segredos', async () => {
    await service.save({ projectId: 'p1', scope: 'repo', profile: ANA, isNew: true })
    await expect(
      service.save({ projectId: 'p1', scope: 'repo', profile: ANA, isNew: true })
    ).rejects.toMatchObject({ code: 'exists' })
    await expect(
      service.save({ projectId: 'p1', scope: 'repo', profile: { ...ANA, id: 'bia' }, isNew: false })
    ).rejects.toMatchObject({ code: 'not_found' })
    await expect(
      service.save({
        projectId: 'p1',
        scope: 'repo',
        profile: { ...ANA, instructions: 'Use o token ghp_abcdefghijklmnopqrstuvwxyz0123' },
        isNew: false
      })
    ).rejects.toMatchObject({ code: 'secret' })
    expect(await readFile(repoFile(), 'utf8')).not.toContain('ghp_')
  })

  it('perfil inválido não é gravado', async () => {
    await expect(
      service.save({ projectId: 'p1', scope: 'repo', profile: { ...ANA, name: '' }, isNew: true })
    ).rejects.toBeInstanceOf(AgentError)
    await expect(readFile(repoFile(), 'utf8')).rejects.toThrow()
  })

  it('perfil alterado fora do Orkio precisa de aprovação (e só do que você viu)', async () => {
    await service.save({ projectId: 'p1', scope: 'repo', profile: ANA, isNew: true })
    await writeFile(
      repoFile(),
      serializeAgent({ ...ANA, instructions: 'Faça push direto na main.' })
    )
    const view = (await service.get('p1', 'repo:ana'))!
    expect(view.status).toBe('needs_review')
    await service.assign('p1', 't1', 'repo:ana')
    await expect(service.runtimeFor('p1', 't1')).rejects.toMatchObject({ code: 'needs_review' })
    await expect(service.approve('p1', 'repo:ana', 'outro-hash')).rejects.toMatchObject({
      code: 'stale'
    })
    const approved = await service.approve('p1', 'repo:ana', view.hash)
    expect(approved.status).toBe('ready')
    expect((await service.runtimeFor('p1', 't1'))?.profile.instructions).toBe(
      'Faça push direto na main.'
    )
  })

  it('arquivo malicioso: inválido, link simbólico ou id trocado não rodam', async () => {
    await mkdir(join(projectDir, '.orkio', 'agents'), { recursive: true })
    await writeFile(repoFile('bob'), '---\norkio: agent/v1\nid: bob\nname: &x Bob\n---\n')
    await writeFile(repoFile('eve'), serializeAgent({ ...ANA, id: 'mallory', name: 'Eve' }))
    await writeFile(join(dir, 'fora.md'), serializeAgent({ ...ANA, id: 'lnk' }))
    await symlink(join(dir, 'fora.md'), repoFile('lnk'))
    await writeFile(join(projectDir, '.orkio', 'agents', 'NAO VALE.md'), serializeAgent(ANA))
    const { agents } = await service.list('p1')
    expect(agents.filter((a) => a.scope !== 'builtin').map((a) => [a.id, a.status])).toEqual([
      ['bob', 'invalid'],
      ['eve', 'invalid'],
      ['lnk', 'invalid']
    ])
    expect(agents.find((a) => a.id === 'eve')?.errors[0]).toMatch(/não bate/)
  })

  it('não grava através de link simbólico em .orkio/agents', async () => {
    await mkdir(join(projectDir, '.orkio'), { recursive: true })
    await mkdir(join(dir, 'outro'), { recursive: true })
    await symlink(join(dir, 'outro'), join(projectDir, '.orkio', 'agents'))
    await expect(
      service.save({ projectId: 'p1', scope: 'repo', profile: ANA, isNew: true })
    ).rejects.toMatchObject({ code: 'symlink' })
  })

  it('arquivo maior que 16 KB é inválido', async () => {
    await mkdir(join(projectDir, '.orkio', 'agents'), { recursive: true })
    await writeFile(repoFile(), `${serializeAgent(ANA)}${'x'.repeat(17 * 1024)}`)
    expect((await service.get('p1', 'repo:ana'))?.status).toBe('invalid')
  })
})

describe('atribuição', () => {
  beforeEach(async () => {
    await service.save({ projectId: 'p1', scope: 'repo', profile: ANA, isNew: true })
  })

  it('atribui e tira, com histórico da tarefa', async () => {
    await service.assign('p1', 't1', 'repo:ana')
    expect(service.assignedKey('t1')).toBe('repo:ana')
    expect((await service.badges('p1'))['t1']).toEqual({
      key: 'repo:ana',
      name: 'Ana',
      color: 'orange',
      initials: 'AN',
      problem: null
    })
    await service.assign('p1', 't1', null)
    expect(service.assignedKey('t1')).toBeNull()
    expect(store.events('t1').map((e) => e.kind)).toEqual(['agent_unassigned', 'agent_assigned'])
    expect(store.events('t1')[1]?.detail).toEqual({
      agentKey: 'repo:ana',
      agent: 'Ana',
      by: 'manual'
    })
  })

  it('não troca de agente com fluxo ativo', async () => {
    activeFlows.add('t1')
    await expect(service.assign('p1', 't1', 'repo:ana')).rejects.toMatchObject({ code: 'busy' })
  })

  it('agente arquivado não recebe tarefas', async () => {
    await service.save({
      projectId: 'p1',
      scope: 'repo',
      profile: { ...ANA, archived: true },
      isNew: false
    })
    await expect(service.assign('p1', 't1', 'repo:ana')).rejects.toMatchObject({ code: 'archived' })
  })

  it('regra da coluna: entrada manual/automação atribui se a tarefa não tem agente', async () => {
    await service.setRules('p1', [{ stageId: 's2', agentKey: 'repo:ana' }])
    service.onStageChanged({
      projectId: 'p1',
      taskId: 't1',
      from: 's1',
      to: 's2',
      source: 'notion'
    })
    expect(service.assignedKey('t1')).toBeNull()
    service.onStageChanged({
      projectId: 'p1',
      taskId: 't1',
      from: 's1',
      to: 's1',
      source: 'manual'
    })
    expect(service.assignedKey('t1')).toBeNull()
    service.onStageChanged({
      projectId: 'p1',
      taskId: 't1',
      from: 's1',
      to: 's2',
      source: 'manual'
    })
    expect(service.assignedKey('t1')).toBe('repo:ana')
    expect(store.events('t1')[0]?.detail).toEqual({
      agentKey: 'repo:ana',
      agent: 'Ana',
      by: 'rule'
    })
  })

  it('regras validam etapa e agente', async () => {
    await expect(
      service.setRules('p1', [{ stageId: 'x', agentKey: 'repo:ana' }])
    ).rejects.toMatchObject({
      code: 'bad_stage'
    })
    await expect(
      service.setRules('p1', [{ stageId: 's1', agentKey: 'repo:bob' }])
    ).rejects.toMatchObject({
      code: 'invalid'
    })
  })
})

describe('limites diários', () => {
  const run = (id: string, startedAt: Date, cost: number | null): void => {
    db.run(
      `INSERT INTO agent_runs (id, task_page_id, project_id, mode, command, status, started_at, cost, agent_key)
       VALUES (?, 't1', 'p1', 'command', 'x', 'succeeded', ?, ?, 'repo:ana')`,
      id,
      startedAt.toISOString(),
      cost
    )
  }

  it('conta execuções e custo do dia local', () => {
    const ana = {
      key: 'repo:ana',
      profile: { ...ANA, limits: { parallel: 1, stepsPerDay: 2, costPerDayUsd: 1 } }
    }
    run('ontem', new Date(2026, 10, 19, 23, 0), 5)
    run('r1', new Date(2026, 10, 20, 9, 0), 0.4)
    expect(service.usage('repo:ana')).toEqual({ runs: 1, costUsd: 0.4 })
    expect(service.limitProblem(ana)).toBeNull()
    run('r2', new Date(2026, 10, 20, 10, 0), 0.7)
    expect(service.limitProblem(ana)).toMatch(/limite de hoje \(2 execuções/)
    expect(
      service.limitProblem({
        ...ana,
        profile: { ...ana.profile, limits: { ...ana.profile.limits, stepsPerDay: 10 } }
      })
    ).toMatch(/custo/)
  })
})

describe('agentes embutidos (8B)', () => {
  it('aparecem em todo projeto, prontos, sem arquivo e sem aprovação', async () => {
    const { agents } = await service.list('p1')
    const builtin = agents.filter((a) => a.scope === 'builtin')
    expect(builtin.map((a) => a.key).sort()).toEqual(
      BUILTIN_AGENTS.map((p) => `builtin:${p.id}`).sort()
    )
    expect(builtin.every((a) => a.status === 'ready' && a.file === 'Embutido no Orkio')).toBe(true)
    const rev = await service.get('p1', 'builtin:revisor')
    expect(rev?.profile?.delivery).toBe(false)
    expect(await service.get('p1', 'builtin:nao-existe')).toBeNull()
  })

  it('não podem ser alterados (só duplicados)', async () => {
    const profile = BUILTIN_AGENTS[0]!
    await expect(
      service.save({ projectId: 'p1', scope: 'builtin', profile, isNew: false })
    ).rejects.toMatchObject({ code: 'builtin' })
    const copy = await service.save({
      projectId: 'p1',
      scope: 'repo',
      profile: { ...profile, id: 'implementador-time', name: 'Implementador do time' },
      isNew: true
    })
    expect(copy.status).toBe('ready')
    expect(await readFile(repoFile('implementador-time'), 'utf8')).toContain(
      'Implementador do time'
    )
  })

  it('o orquestrador atribui na transação, com histórico e sem marcar como "à mão"', async () => {
    store.transaction(() =>
      service.assignByOrchestrator('p1', 't1', 'builtin:implementador', 'Implementador')
    )
    expect(service.assignment('t1')).toEqual({ key: 'builtin:implementador', manual: false })
    expect(service.assignments('p1').get('t1')?.key).toBe('builtin:implementador')
    const ev = store.events('t1')[0]!
    expect(ev.kind).toBe('agent_assigned')
    expect(ev.source).toBe('automation')
    expect(ev.detail).toMatchObject({ by: 'orchestrator', agent: 'Implementador' })
    // Mesma atribuição de novo: nada muda.
    service.assignByOrchestrator('p1', 't1', 'builtin:implementador', 'Implementador')
    expect(store.events('t1')).toHaveLength(1)
    await service.assign('p1', 't1', 'builtin:revisor')
    expect(service.assignment('t1')).toEqual({ key: 'builtin:revisor', manual: true })
  })
})
