import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MEMORY_LIMITS, MEMORY_MESSAGES, serializeMemory } from '../../shared/agent-memory'
import { AgentMemoryStore, digestOf } from './agent-memory.store'

const SECRET = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789'

describe('AgentMemoryStore', () => {
  let root: string
  let now: Date
  let store: AgentMemoryStore

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'orkio-memory-'))
    now = new Date(2026, 10, 24, 10)
    store = new AgentMemoryStore({ root, now: () => now })
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  const note = (text: string) => ({ text, scope: 'geral' as const, until: null })

  it('local/embutido valem em todos os projetos; repo é por projeto', async () => {
    await store.add('local:ana', 'p1', note('Use pnpm'), null)
    expect((await store.read('local:ana', 'p2')).notes.map((n) => n.text)).toEqual(['Use pnpm'])
    await store.add('repo:ana', 'p1', note('Só no p1'), null)
    expect((await store.read('repo:ana', 'p2')).notes).toEqual([])
    expect(await readFile(join(root, 'repo', 'p1', 'ana', 'MEMORY.md'), 'utf8')).toContain(
      '- [2026-11-24 · geral] Só no p1'
    )
    await store.add('builtin:revisor', 'p1', note('x'), null)
    expect(await readdir(join(root, 'builtin'))).toEqual(['revisor'])
  })

  it('pastas 0700 e arquivos 0600', async () => {
    if (process.platform === 'win32') return
    await store.add('local:ana', 'p1', note('a'), null)
    const v = await store.read('local:ana', 'p1')
    await store.remove('local:ana', 'p1', v.digest, v.notes[0]!.id)
    const dir = join(root, 'local', 'ana')
    expect((await stat(dir)).mode & 0o777).toBe(0o700)
    expect((await stat(join(dir, 'MEMORY.md'))).mode & 0o777).toBe(0o600)
    expect((await stat(join(dir, 'history'))).mode & 0o777).toBe(0o700)
    const [snap] = await readdir(join(dir, 'history'))
    expect((await stat(join(dir, 'history', snap!))).mode & 0o777).toBe(0o600)
  })

  it('segredos são removidos ao gravar (tela, ferramenta e rollback)', async () => {
    await store.add('local:ana', 'p1', note(`o token é ${SECRET}`), null)
    const r = await store.remember('local:ana', 'p1', { texto: `API_KEY=abc123 e ${SECRET}` })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.text).not.toContain(SECRET)
    const file = await readFile(join(root, 'local', 'ana', 'MEMORY.md'), 'utf8')
    expect(file).not.toContain(SECRET)
    expect(file).not.toContain('abc123')
    expect(file).toContain('[segredo omitido]')
    // Foto do histórico com segredo (editada à mão): o rollback redige também.
    const v = await store.read('local:ana', 'p1')
    const id = v.history[0]!.id
    await writeFile(
      join(root, 'local', 'ana', 'history', `${id}.md`),
      serializeMemory([
        { text: `segredo ${SECRET}`, date: '2026-11-01', projectId: null, until: null }
      ])
    )
    const back = await store.rollback('local:ana', 'p1', v.digest, id)
    expect(JSON.stringify(back)).not.toContain(SECRET)
    expect(await readFile(join(root, 'local', 'ana', 'MEMORY.md'), 'utf8')).not.toContain(SECRET)
  })

  it('digest velho = erro claro; digest certo edita', async () => {
    const v1 = await store.add('local:ana', 'p1', note('Um'), null)
    expect(v1.digest).toBe(
      digestOf(await readFile(join(root, 'local', 'ana', 'MEMORY.md'), 'utf8'))
    )
    const v2 = await store.add('local:ana', 'p1', note('Dois'), v1.digest)
    await expect(store.remove('local:ana', 'p1', v1.digest, v1.notes[0]!.id)).rejects.toMatchObject(
      {
        code: 'stale',
        message: MEMORY_MESSAGES.stale
      }
    )
    const v3 = await store.edit('local:ana', 'p1', v2.digest, v2.notes[0]!.id, {
      text: 'Um\neditado',
      scope: 'projeto',
      until: '2027-01-31'
    })
    expect(v3.notes[0]).toMatchObject({
      text: 'Um editado',
      projectId: 'p1',
      until: '2027-01-31',
      date: '2026-11-24'
    })
    await expect(store.remove('local:ana', 'p1', v3.digest, 'deadbeef')).rejects.toMatchObject({
      code: 'not_found'
    })
  })

  it('escritas paralelas no mesmo agente não se perdem', async () => {
    await Promise.all(
      Array.from({ length: 10 }, (_, i) => store.add('local:ana', 'p1', note(`nota ${i}`), null))
    )
    expect((await store.read('local:ana', 'p1')).notes).toHaveLength(10)
  })

  it('arquivar, desarquivar e vencidas na próxima escrita', async () => {
    let v = await store.add(
      'local:ana',
      'p1',
      { text: 'vence', scope: 'geral', until: '2026-11-25' },
      null
    )
    v = await store.add('local:ana', 'p1', note('fica'), v.digest)
    v = await store.archive('local:ana', 'p1', v.digest, v.notes.find((n) => n.text === 'fica')!.id)
    expect(v.archived.map((n) => n.text)).toEqual(['fica'])
    now = new Date(2026, 10, 27, 10)
    v = await store.read('local:ana', 'p1')
    expect(v.notes[0]).toMatchObject({ text: 'vence', expired: true })
    expect(await store.summary('local:ana', 'p1')).toBe('')
    v = await store.unarchive('local:ana', 'p1', v.digest, v.archived[0]!.id)
    expect(v.notes.map((n) => n.text)).toEqual(['fica'])
    expect(v.archived.map((n) => n.text)).toEqual(['vence'])
    // Desarquivar uma vencida tira a validade (senão sairia de novo).
    v = await store.unarchive('local:ana', 'p1', v.digest, v.archived[0]!.id)
    expect(v.notes.find((n) => n.text === 'vence')).toMatchObject({ until: null, expired: false })
  })

  it('acima do orçamento, as mais antigas vão para as arquivadas', async () => {
    const big = (i: number) => note(`${i} ${'x'.repeat(900)}`)
    for (let i = 0; i < 9; i++) {
      now = new Date(2026, 10, 1 + i, 10)
      await store.add('local:ana', 'p1', big(i), null)
    }
    const v = await store.read('local:ana', 'p1')
    expect(v.used).toBeLessThanOrEqual(MEMORY_LIMITS.budget)
    expect(v.archived.map((n) => n.text.split(' ')[0])).toEqual(['0'])
    expect(v.notes.map((n) => n.text.split(' ')[0])).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8'
    ])
  })

  it('histórico: foto antes de cada mudança (50 últimas) e rollback', async () => {
    let v = await store.add('local:ana', 'p1', note('primeira'), null)
    expect(v.history).toEqual([])
    v = await store.add('local:ana', 'p1', note('segunda'), v.digest)
    expect(v.history).toHaveLength(1)
    expect(v.history[0]!.count).toBe(1)
    v = await store.rollback('local:ana', 'p1', v.digest, v.history[0]!.id)
    expect(v.notes.map((n) => n.text)).toEqual(['primeira'])
    expect(v.history).toHaveLength(2)
    expect(v.history[0]!.count).toBe(2)
    await expect(
      store.rollback('local:ana', 'p1', v.digest, '2020-01-01T00-00-00-000Z-abcdef')
    ).rejects.toMatchObject({ code: 'not_found' })
    for (let i = 0; i < 55; i++) await store.add('local:ana', 'p1', note(`n${i}`), null)
    v = await store.read('local:ana', 'p1')
    expect(v.history).toHaveLength(MEMORY_LIMITS.historyKeep)
  })

  it('archive.md é gravado antes do MEMORY.md', async () => {
    let v = await store.add('local:ana', 'p1', note('a'), null)
    v = await store.archive('local:ana', 'p1', v.digest, v.notes[0]!.id)
    const dir = join(root, 'local', 'ana')
    const a = await stat(join(dir, 'archive.md'))
    const m = await stat(join(dir, 'MEMORY.md'))
    expect(a.mtimeMs).toBeLessThanOrEqual(m.mtimeMs)
    expect(v.notes).toEqual([])
  })

  it('lembrar: entrada inválida volta com o motivo; resumo filtra pelo projeto', async () => {
    expect(await store.remember('local:ana', 'p1', { texto: '' })).toEqual({
      ok: false,
      message: `Não anotei: ${MEMORY_MESSAGES.empty}`
    })
    expect(
      await store.remember('local:ana', 'p1', { texto: 'x', ate: '2020-01-01' })
    ).toMatchObject({
      ok: false
    })
    await store.remember('local:ana', 'p1', { texto: 'do p1', escopo: 'projeto' })
    await store.remember('local:ana', 'p2', { texto: 'do p2', escopo: 'projeto' })
    await store.remember('local:ana', 'p2', { texto: 'de todos' })
    expect((await store.summary('local:ana', 'p1')).split('\n')).toEqual(['- de todos', '- do p1'])
  })

  it('chave ou projeto inválidos nunca viram caminho', async () => {
    await expect(store.read('local:../x', 'p1')).rejects.toMatchObject({ code: 'invalid' })
    await expect(store.read('repo:ana', '../p')).rejects.toMatchObject({ code: 'invalid' })
  })
})
