import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ConfigReadOnlyError, ConfigStore } from './config-store'

interface Data {
  items: string[]
}

function makeStore(
  file: string,
  extra: Partial<ConstructorParameters<typeof ConfigStore<Data>>[0]> = {}
) {
  return new ConfigStore<Data>({
    file,
    currentVersion: 2,
    migrations: {
      // v0 (sem schemaVersion): { list: [...] } → v1: { items: [...] }
      0: (d) => ({ items: Array.isArray(d['list']) ? d['list'] : [] }),
      // v1 → v2: itens em maiúsculas (só para provar o encadeamento)
      1: (d) => ({ items: (d['items'] as string[]).map((s) => s.toUpperCase()) })
    },
    validate: (d) => {
      if (!Array.isArray(d['items'])) return null
      const items = d['items'].filter((i): i is string => typeof i === 'string')
      const dropped = d['items'].length - items.length
      return dropped > 0
        ? { value: { items }, warning: `${dropped} ignorado(s)` }
        : { value: { items } }
    },
    empty: () => ({ items: [] }),
    now: () => new Date('2026-11-19T12:00:00.000Z'),
    ...extra
  })
}

describe('ConfigStore: migrações obrigatórias', () => {
  it('faltando a migração v → v+1, o store nem é criado (antes: backup + config vazia)', () => {
    expect(() => makeStore('/tmp/nao-usado.json', { migrations: { 0: (d) => d } })).toThrow(
      /faltam as migrações 1/
    )
  })
})

describe('ConfigStore', () => {
  let dir: string
  let file: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'orkio-config-'))
    file = join(dir, 'orkio-config.json')
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('sem arquivo → começa vazio, sem aviso', async () => {
    const store = makeStore(file)
    expect(await store.load()).toEqual({ data: { items: [] } })
  })

  it('grava com schemaVersion e lê de volta numa nova instância', async () => {
    const store = makeStore(file)
    await store.load()
    await store.update((d) => ({ items: [...d.items, 'A'] }))

    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ items: ['A'], schemaVersion: 2 })
    const reopened = makeStore(file)
    expect((await reopened.load()).data).toEqual({ items: ['A'] })
  })

  it('escrita atômica: escritas concorrentes não corrompem e não deixam temporários', async () => {
    const store = makeStore(file)
    await store.load()
    await Promise.all(
      Array.from({ length: 20 }, (_, i) => store.update((d) => ({ items: [...d.items, `I${i}`] })))
    )
    const onDisk = JSON.parse(await readFile(file, 'utf8')) as Data
    expect(onDisk.items).toHaveLength(20)
    expect(await readdir(dir)).toEqual(['orkio-config.json'])
  })

  it('JSON corrompido → backup + começa vazio + aviso (não lança)', async () => {
    await writeFile(file, '{ isso não é json')
    const store = makeStore(file)
    const result = await store.load()

    expect(result.data).toEqual({ items: [] })
    expect(result.warning).toMatch(
      /corrompidas.*orkio-config\.corrupt-2026-11-19T12-00-00-000Z\.json/
    )
    expect((await readdir(dir)).sort()).toEqual([
      'orkio-config.corrupt-2026-11-19T12-00-00-000Z.json'
    ])
    expect(
      await readFile(join(dir, 'orkio-config.corrupt-2026-11-19T12-00-00-000Z.json'), 'utf8')
    ).toBe('{ isso não é json')

    // Continua utilizável.
    await store.update(() => ({ items: ['ok'] }))
    expect((await makeStore(file).load()).data).toEqual({ items: ['ok'] })
  })

  it('estrutura inválida (validate → null) também vira backup', async () => {
    await writeFile(file, JSON.stringify({ schemaVersion: 2, items: 'não é lista' }))
    const result = await makeStore(file).load()
    expect(result.warning).toMatch(/corrompidas/)
    expect((await readdir(dir)).some((f) => f.includes('.corrupt-'))).toBe(true)
  })

  it('migra v0 → v1 → v2 e regrava no formato atual', async () => {
    await writeFile(file, JSON.stringify({ list: ['a', 'b'] }))
    const result = await makeStore(file).load()
    expect(result).toEqual({ data: { items: ['A', 'B'] } })
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({
      items: ['A', 'B'],
      schemaVersion: 2
    })
  })

  it('migra a partir de v1', async () => {
    await writeFile(file, JSON.stringify({ schemaVersion: 1, items: ['x'] }))
    expect((await makeStore(file).load()).data).toEqual({ items: ['X'] })
  })

  it('itens inválidos são descartados com aviso', async () => {
    await writeFile(file, JSON.stringify({ schemaVersion: 2, items: ['ok', 3, null] }))
    expect(await makeStore(file).load()).toEqual({
      data: { items: ['ok'] },
      warning: '2 ignorado(s)'
    })
  })

  it('versão mais nova que a suportada → somente leitura, arquivo intocado', async () => {
    const future = JSON.stringify({ schemaVersion: 9, items: ['futuro'] })
    await writeFile(file, future)
    const store = makeStore(file)
    const result = await store.load()

    expect(result.warning).toMatch(/versão mais nova/)
    expect(store.readOnly).toBe(true)
    await expect(store.update(() => ({ items: [] }))).rejects.toBeInstanceOf(ConfigReadOnlyError)
    expect(await readFile(file, 'utf8')).toBe(future)
  })

  it('schemaVersion inválido → backup', async () => {
    await writeFile(file, JSON.stringify({ schemaVersion: 'dois', items: [] }))
    expect((await makeStore(file).load()).warning).toMatch(/corrompidas/)
  })

  it('get() antes de load() é erro de programação', () => {
    expect(() => makeStore(file).get()).toThrow(/load/)
  })
})
