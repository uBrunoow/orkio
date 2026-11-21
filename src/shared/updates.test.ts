import { describe, expect, it } from 'vitest'
import {
  RELEASES_PATH_PATTERN,
  changelogSection,
  compareVersions,
  friendlyUpdateError,
  macDownloadUrl,
  noteBlocks
} from './updates'

describe('compareVersions', () => {
  it('ordena semver com pré-release', () => {
    const sorted = [
      '1.0.0',
      '0.9.9',
      '1.0.0-beta.2',
      '1.0.0-beta.10',
      '1.0.0-alpha',
      '1.0.1',
      'v1.1.0'
    ].sort(compareVersions)
    expect(sorted).toEqual([
      '0.9.9',
      '1.0.0-alpha',
      '1.0.0-beta.2',
      '1.0.0-beta.10',
      '1.0.0',
      '1.0.1',
      'v1.1.0'
    ])
    expect(compareVersions('0.0.2', '0.0.1')).toBe(1)
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0)
  })
})

const CHANGELOG = `# Changelog

## [Não lançado]

- algo ainda não publicado

## [0.0.2] - 2026-11-22

### Adicionado
- **Atualizações** automáticas com \`electron-updater\`.
- Veja [o site](https://exemplo.com).

## [0.0.1] - 2026-11-21

- Primeira versão.
`

describe('changelogSection / noteBlocks', () => {
  it('recorta só a seção da versão', () => {
    expect(changelogSection(CHANGELOG, '0.0.2')).toBe(
      '### Adicionado\n- **Atualizações** automáticas com `electron-updater`.\n- Veja [o site](https://exemplo.com).'
    )
    expect(changelogSection(CHANGELOG, 'v0.0.1')).toBe('- Primeira versão.')
    expect(changelogSection(CHANGELOG, '0.0.3')).toBeNull()
  })

  it('vira blocos de texto simples (sem HTML nem links)', () => {
    expect(noteBlocks(changelogSection(CHANGELOG, '0.0.2')!)).toEqual([
      { type: 'heading', text: 'Adicionado' },
      { type: 'item', text: 'Atualizações automáticas com electron-updater.' },
      { type: 'item', text: 'Veja o site.' }
    ])
    expect(noteBlocks('Linha um\nlinha dois\n\n<script>x</script>')).toEqual([
      { type: 'paragraph', text: 'Linha um linha dois' },
      { type: 'paragraph', text: '<script>x</script>' }
    ])
  })
})

describe('macDownloadUrl', () => {
  const files = ['Orkio-0.0.2-mac-x64.zip', 'Orkio-0.0.2-mac-arm64.dmg', 'Orkio-0.0.2-mac-x64.dmg']
  it('escolhe o DMG da arquitetura', () => {
    expect(macDownloadUrl('0.0.2', files, 'arm64')).toBe(
      'https://github.com/uBrunoow/orkio-releases/releases/download/v0.0.2/Orkio-0.0.2-mac-arm64.dmg'
    )
    expect(macDownloadUrl('0.0.2', files, 'x64')).toBe(
      'https://github.com/uBrunoow/orkio-releases/releases/download/v0.0.2/Orkio-0.0.2-mac-x64.dmg'
    )
  })
  it('sem DMG (ou nome estranho) leva à página da versão', () => {
    expect(macDownloadUrl('0.0.2', ['Orkio-0.0.2-mac-arm64.zip'], 'arm64')).toBe(
      'https://github.com/uBrunoow/orkio-releases/releases/tag/v0.0.2'
    )
    expect(macDownloadUrl('0.0.2', ['../evil.dmg?x=1'], 'arm64')).toBe(
      'https://github.com/uBrunoow/orkio-releases/releases/tag/v0.0.2'
    )
  })
  it('a allowlist aceita as URLs geradas e só elas', () => {
    for (const url of [
      macDownloadUrl('0.0.2', files, 'arm64'),
      macDownloadUrl('0.0.2-beta.1', [], 'x64')
    ]) {
      expect(RELEASES_PATH_PATTERN.test(new URL(url).pathname)).toBe(true)
    }
    for (const path of [
      '/uBrunoow/orkio/releases/download/v1.0.0/Orkio.dmg',
      '/uBrunoow/orkio-releases/releases/download/v1.0.0/Orkio.exe',
      '/uBrunoow/orkio-releases/settings',
      '/uBrunoow/orkio-releases/releases/download/v1.0.0/../x.dmg'
    ]) {
      expect(RELEASES_PATH_PATTERN.test(path)).toBe(false)
    }
  })
})

describe('friendlyUpdateError', () => {
  it('nunca repassa a mensagem crua', () => {
    const msg = friendlyUpdateError(new Error('Something https://secret.example/?token=x'))
    expect(msg).not.toContain('https')
    expect(friendlyUpdateError(new Error('No published versions on GitHub'))).toMatch(
      /Ainda não há/
    )
    expect(friendlyUpdateError(new Error('HttpError: 403 rate limit exceeded'))).toMatch(/limitou/)
  })
})
