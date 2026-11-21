import { describe, expect, it } from 'vitest'
import { parsePorcelainLine } from './agent-run'

describe('parsePorcelainLine', () => {
  it('estados do git status --porcelain', () => {
    expect(parsePorcelainLine(' M src/a.ts')).toEqual({ path: 'src/a.ts', status: 'modified' })
    expect(parsePorcelainLine('M  src/a.ts')).toEqual({ path: 'src/a.ts', status: 'modified' })
    expect(parsePorcelainLine('A  novo.ts')).toEqual({ path: 'novo.ts', status: 'added' })
    expect(parsePorcelainLine(' D velho.ts')).toEqual({ path: 'velho.ts', status: 'deleted' })
    expect(parsePorcelainLine('?? solto.md')).toEqual({ path: 'solto.md', status: 'untracked' })
  })

  it('renomeado fica com o nome novo; aspas saem', () => {
    expect(parsePorcelainLine('R  a.ts -> b.ts')).toEqual({ path: 'b.ts', status: 'renamed' })
    expect(parsePorcelainLine(' M "com espaço.md"')).toEqual({
      path: 'com espaço.md',
      status: 'modified'
    })
  })

  it('linha vazia ou curta não vira arquivo', () => {
    expect(parsePorcelainLine('')).toBeNull()
    expect(parsePorcelainLine('??')).toBeNull()
  })
})
