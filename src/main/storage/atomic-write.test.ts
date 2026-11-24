import { mkdtemp, readdir, readFile, stat, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { atomicWriteFile } from './atomic-write'

describe('atomicWriteFile', () => {
  it('grava com a permissão pedida, cria a pasta e não deixa temporário', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'orkio-atomic-'))
    const file = join(dir, 'sub', 'a.json')
    await atomicWriteFile(file, '{"v":1}', { mode: 0o600, fsync: true, dirMode: 0o700 })
    await atomicWriteFile(file, '{"v":2}', { mode: 0o600, fsync: false })
    expect(await readFile(file, 'utf8')).toBe('{"v":2}')
    if (process.platform !== 'win32') expect((await stat(file)).mode & 0o777).toBe(0o600)
    expect(await readdir(join(dir, 'sub'))).toEqual(['a.json'])
  })

  it('falha (destino é pasta) → erro sobe, o original fica e o temporário some', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'orkio-atomic-'))
    const target = join(dir, 'pasta')
    await mkdir(target)
    await expect(atomicWriteFile(target, 'x', { mode: 0o644, fsync: false })).rejects.toThrow()
    expect(await readdir(dir)).toEqual(['pasta'])
  })
})
