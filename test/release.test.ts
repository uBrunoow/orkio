import { describe, expect, it } from 'vitest'
import {
  extractNotes,
  isPrerelease,
  nextVersion,
  parseReleaseArgs,
  planRelease,
  releaseChangelog,
  releaseKindFromLabels
} from '../scripts/release-lib.mjs'

describe('nextVersion', () => {
  it('sobe patch/minor/major a partir de uma versão estável', () => {
    expect(nextVersion('0.1.0', 'patch')).toBe('0.1.1')
    expect(nextVersion('0.1.3', 'minor')).toBe('0.2.0')
    expect(nextVersion('0.4.2', 'major')).toBe('1.0.0')
  })

  it('beta: próximo patch com -beta.1, depois incrementa N', () => {
    expect(nextVersion('0.1.0', 'beta')).toBe('0.1.1-beta.1')
    expect(nextVersion('0.1.1-beta.1', 'beta')).toBe('0.1.1-beta.2')
  })

  it('--beta com minor/major começa o beta da versão seguinte', () => {
    expect(nextVersion('0.1.0', 'minor', { beta: true })).toBe('0.2.0-beta.1')
    expect(nextVersion('0.2.0-beta.1', 'minor', { beta: true })).toBe('0.2.0-beta.2')
    expect(nextVersion('0.1.0', 'major', { beta: true })).toBe('1.0.0-beta.1')
  })

  it('saindo de um beta, a versão estável fecha o beta', () => {
    expect(nextVersion('0.1.1-beta.3', 'patch')).toBe('0.1.1')
    expect(nextVersion('0.2.0-beta.1', 'minor')).toBe('0.2.0')
    expect(nextVersion('0.2.1-beta.1', 'minor')).toBe('0.3.0')
    expect(nextVersion('1.0.0-beta.2', 'major')).toBe('1.0.0')
  })

  it('recusa versão ou tipo inválidos', () => {
    expect(() => nextVersion('1.0', 'patch')).toThrow(/Versão inválida/)
    expect(() => nextVersion('1.0.0-rc.1', 'patch')).toThrow(/Versão inválida/)
    expect(() => nextVersion('1.0.0', 'hotfix' as 'patch')).toThrow(/Tipo inválido/)
  })

  it('isPrerelease', () => {
    expect(isPrerelease('1.0.0-beta.1')).toBe(true)
    expect(isPrerelease('1.0.0')).toBe(false)
  })
})

const CHANGELOG = `# Changelog

Texto.

## [Não lançado]

### Adicionado

- Coisa nova.

### Corrigido

- Um bug.

## [0.1.0] - 2026-11-20

- Primeira.
`

describe('releaseChangelog', () => {
  it('move "Não lançado" para a versão e deixa a seção vazia no topo', () => {
    const out = releaseChangelog(CHANGELOG, '0.1.1', '2026-11-21')
    expect(out).toContain('## [Não lançado]\n\n## [0.1.1] - 2026-11-21\n\n### Adicionado')
    expect(out).toContain('- Um bug.\n\n## [0.1.0] - 2026-11-20')
    expect(extractNotes(out, '0.1.1')).toBe(
      '### Adicionado\n\n- Coisa nova.\n\n### Corrigido\n\n- Um bug.'
    )
    expect(extractNotes(out, '0.1.0')).toBe('- Primeira.')
  })

  it('recusa seção vazia (só subtítulos), ausente ou versão repetida', () => {
    const vazio = CHANGELOG.replace('- Coisa nova.', '').replace('- Um bug.', '')
    expect(() => releaseChangelog(vazio, '0.1.1', '2026-11-21')).toThrow(/vazia/)
    expect(() => releaseChangelog('# Changelog\n', '0.1.1', '2026-11-21')).toThrow(/não tem/)
    expect(() => releaseChangelog(CHANGELOG, '0.1.0', '2026-11-21')).toThrow(/já tem/)
  })

  it('extractNotes não confunde 0.1.1 com 0.1.10 e devolve null se não houver', () => {
    const text = '## [0.1.10] - x\n\n- dez\n\n## [0.1.1] - y\n\n- um\n'
    expect(extractNotes(text, '0.1.1')).toBe('- um')
    expect(extractNotes(text, '0.2.0')).toBeNull()
  })

  it('o CHANGELOG do repositório está no formato esperado', async () => {
    const { readFileSync } = await import('node:fs')
    const text = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8')
    expect(text).toMatch(/^## \[Não lançado\]$/m)
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      version: string
    }
    expect(extractNotes(text, pkg.version)).toBeTruthy()
  })
})

describe('parseReleaseArgs', () => {
  it('aceita o tipo e --beta', () => {
    expect(parseReleaseArgs(['patch'])).toEqual({ kind: 'patch', beta: false })
    expect(parseReleaseArgs(['--', 'minor', '--beta'])).toEqual({ kind: 'minor', beta: true })
  })

  it('recusa uso errado', () => {
    expect(() => parseReleaseArgs([])).toThrow(/Uso/)
    expect(() => parseReleaseArgs(['patch', 'minor'])).toThrow(/Uso/)
    expect(() => parseReleaseArgs(['patch', '--force'])).toThrow(/desconhecida/)
  })
})

describe('releaseKindFromLabels', () => {
  it('sem rótulo de release, a PR não lança versão', () => {
    expect(releaseKindFromLabels([])).toBeNull()
    expect(releaseKindFromLabels(['bug', 'enhancement'])).toBeNull()
  })

  it('um rótulo release:<tipo> escolhe o tipo (repetido conta uma vez)', () => {
    expect(releaseKindFromLabels(['bug', 'release:minor'])).toBe('minor')
    expect(releaseKindFromLabels(['release:beta'])).toBe('beta')
    expect(releaseKindFromLabels(['release:patch', 'release:patch'])).toBe('patch')
  })

  it('mais de um tipo ou um tipo desconhecido é erro', () => {
    expect(() => releaseKindFromLabels(['release:patch', 'release:minor'])).toThrow(/mais de um/)
    expect(() => releaseKindFromLabels(['release:gigante'])).toThrow(/desconhecido/)
  })
})

describe('planRelease', () => {
  const changelog = '# Changelog\n\n## [Não lançado]\n\n### Adicionado\n\n- Algo novo.\n'
  const base = { currentVersion: '0.1.0', changelog, today: '2026-11-21' }

  it('sem rótulo: não há release', () => {
    expect(planRelease({ ...base, labels: ['bug'] })).toEqual({ release: false })
  })

  it('com rótulo: tipo, versão e se é pre-release', () => {
    expect(planRelease({ ...base, labels: ['release:minor'] })).toEqual({
      release: true,
      kind: 'minor',
      version: '0.2.0',
      prerelease: false
    })
    expect(planRelease({ ...base, labels: ['release:beta'] })).toMatchObject({
      version: '0.1.1-beta.1',
      prerelease: true
    })
  })

  it('CHANGELOG sem o que lançar derruba o plano antes do merge', () => {
    expect(() =>
      planRelease({
        ...base,
        labels: ['release:patch'],
        changelog: '# Changelog\n\n## [Não lançado]\n\n### Adicionado\n'
      })
    ).toThrow(/vazia/)
  })
})
