import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AlvaPrecheck } from '../../shared/alva'
import type { Flow } from '../../shared/task-flow'
import { BoardStore } from '../board/board.store'
import type { OrkioConfig } from '../config/orkio-config'
import { openDatabase, type Db } from '../db/database'
import { FlowRunner } from '../flows/flow-runner'
import type { ConfigStore } from '../storage/config-store'
import { AlvaFlowsService } from './alva-flows.service'
import { createAlvaIntegration } from './alva-integration'
import type { AlvaService } from './alva.service'
import { hasComposeFile } from './precheck'

/** Fluxo Alva que fica parado no gate (ocupa a vaga sem rodar o Claude Code). */
function gateFlow(id: string, tags: string[]): Flow {
  return {
    id,
    name: id,
    tags,
    steps: [
      {
        id: 'ok',
        name: 'Aprovar',
        type: 'gate',
        message: 'Pode?',
        show: 'none',
        onReject: 'stop',
        timeoutMin: null
      }
    ]
  }
}

const READY: AlvaPrecheck = {
  ready: true,
  pluginVersion: '1.0.25',
  hasDocker: true,
  items: [],
  checkedAt: '2026-11-24T10:00:00Z'
}

let dir: string
let db: Db
let store: BoardStore
let flows: Flow[]

/** O app aberto uma vez: serviço do alva-flow (cache vazio) + executor com a integração. */
function openApp(precheck: (projectDir: string) => Promise<AlvaPrecheck>): FlowRunner {
  const cfg = {
    projects: [{ id: 'p1', localPath: dir }],
    flows: { p1: { flows, bindings: [], alva: { maxParallel: 1 } } }
  } as unknown as OrkioConfig
  const alvaFlows = new AlvaFlowsService({
    config: { get: () => cfg } as unknown as ConfigStore<OrkioConfig>,
    store,
    board: { saveFlow: vi.fn() },
    alva: {} as AlvaService,
    precheck,
    usesDocker: hasComposeFile,
    actor: () => 'bruno'
  })
  let n = 0
  return new FlowRunner({
    db,
    store,
    flows: () => ({ flows, bindings: [] }),
    currentStage: () => null,
    prepare: async () => ({ briefing: '', displayId: 'ORK-1', notionUrl: null }),
    startClaude: async () => 'run',
    cancelClaude: () => undefined,
    extractors: [],
    actions: [],
    integrations: [
      createAlvaIntegration({ alva: { initialVars: async () => ({}) }, flows: alvaFlows })
    ],
    notify: () => undefined,
    emit: () => undefined,
    enterStage: () => undefined,
    newId: () => `fr-${++n}-${Math.random().toString(36).slice(2, 6)}`
  })
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'orkio-alva-int-'))
  // Projeto com Docker Compose: 1 fluxo Alva por vez.
  await writeFile(join(dir, 'docker-compose.yml'), 'services: {}\n')
  db = openDatabase(':memory:')
  store = new BoardStore(db)
  flows = []
})
afterEach(async () => {
  db.close()
  await rm(dir, { recursive: true, force: true })
})

describe('alva-flow como integração dos fluxos: limite de fluxos em paralelo', () => {
  it('ao reabrir o app, a fila continua na fila (o limite não depende da pré-checagem já ter rodado)', async () => {
    flows = [gateFlow('alva-a', ['alva'])]
    const first = openApp(async () => READY)
    const runs = []
    for (const task of ['t1', 't2', 't3']) runs.push(await first.startById('p1', task, 'alva-a'))
    expect(runs.map((r) => first.view(r.id).status)).toEqual(['waiting_gate', 'paused', 'paused'])
    expect(first.view(runs[1]!.id).pauseReason).toBe('waiting_slot')
    first.dispose()

    // Reabrir: serviço novo (cache da pré-checagem vazio) e a pré-checagem nem é chamada.
    const precheck = vi.fn(async (): Promise<AlvaPrecheck> => {
      throw new Error('a pré-checagem não deveria rodar ao abrir')
    })
    const second = openApp(precheck)
    second.init()
    expect(runs.map((r) => second.view(r.id).status)).toEqual(['waiting_gate', 'paused', 'paused'])
    expect(precheck).not.toHaveBeenCalled()

    // Liberou a vaga: só o mais antigo da fila começa.
    await second.cancel(runs[0]!.id)
    await new Promise((r) => setImmediate(r))
    expect(runs.map((r) => second.view(r.id).status)).toEqual([
      'cancelled',
      'waiting_gate',
      'paused'
    ])
  })

  it('o marcador da integração conta em qualquer posição de `tags` (não só o primeiro)', async () => {
    flows = [gateFlow('outro-alva', ['outro', 'alva']), gateFlow('alva-b', ['alva'])]
    const app = openApp(async () => READY)
    // Antes, o limite contava pelo primeiro marcador (`outro`), e este começava junto.
    const a = await app.startById('p1', 't1', 'alva-b')
    const b = await app.startById('p1', 't2', 'outro-alva')
    expect(app.view(a.id).status).toBe('waiting_gate')
    expect(app.view(b.id)).toMatchObject({ status: 'paused', pauseReason: 'waiting_slot' })
  })

  it('sem Docker Compose no projeto: sem limite', async () => {
    await rm(join(dir, 'docker-compose.yml'))
    flows = [gateFlow('alva-a', ['alva'])]
    const app = openApp(async () => ({ ...READY, hasDocker: false }))
    const a = await app.startById('p1', 't1', 'alva-a')
    const b = await app.startById('p1', 't2', 'alva-a')
    expect([app.view(a.id).status, app.view(b.id).status]).toEqual(['waiting_gate', 'waiting_gate'])
  })
})
