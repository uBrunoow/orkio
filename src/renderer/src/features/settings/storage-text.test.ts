import { describe, expect, it } from 'vitest'
import { formatStorageBytes, storageRows } from './storage-text'

describe('formatStorageBytes', () => {
  it('pt-BR com vírgula, até GB', () => {
    expect(formatStorageBytes(0)).toBe('0 B')
    expect(formatStorageBytes(512)).toBe('512 B')
    expect(formatStorageBytes(3.4 * 1024)).toBe('3,4 KB')
    expect(formatStorageBytes(1.25 * 1024 * 1024)).toBe('1,3 MB')
    expect(formatStorageBytes(2 * 1024 ** 3)).toBe('2,0 GB')
    expect(formatStorageBytes(-1)).toBe('—')
    expect(formatStorageBytes(Number.NaN)).toBe('—')
  })

  it('linhas do armazenamento com plural', () => {
    const rows = storageRows({
      runsBytes: 2048,
      runsCount: 1,
      runsKeptPerTask: 20,
      worktrees: 3,
      agentMemoryBytes: 0
    })
    expect(rows.map((r) => r.value)).toEqual(['2,0 KB', '3 ambientes', '0 B'])
    expect(rows[0]?.detail).toContain('1 execução')
    expect(rows[0]?.detail).toContain('20 mais recentes')
  })
})
