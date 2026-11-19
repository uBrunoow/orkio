import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildCatalog, parseFrontmatter, parseInstalledPlugins } from './catalog'

let home: string
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'orkio-cat-'))
})
afterEach(() => rm(home, { recursive: true, force: true }))

const md = (name: string, description: string): string =>
  `---\nname: ${name}\ndescription: "${description}"\n---\nCORPO-SECRETO`

describe('catálogo de comandos', () => {
  it('frontmatter: só name/description; multilinha ignorada', () => {
    expect(parseFrontmatter('---\nname: a\ndescription: >\n  x\ntools: Bash\n---\nx')).toEqual({
      name: 'a'
    })
    expect(parseFrontmatter('sem frontmatter')).toEqual({})
  })

  it('agrupa usuário, projeto e plugins (comandos e skills) sem ler o corpo', async () => {
    const claude = join(home, '.claude')
    await mkdir(join(claude, 'commands'), { recursive: true })
    await writeFile(join(claude, 'commands', 'revisar.md'), md('revisar', 'Revisa o diff'))
    await mkdir(join(claude, 'skills', 'deploy'), { recursive: true })
    await writeFile(join(claude, 'skills', 'deploy', 'SKILL.md'), md('deploy', 'Faz deploy'))
    const plugin = join(claude, 'plugins', 'cache', 'eng')
    await mkdir(join(plugin, 'commands'), { recursive: true })
    await writeFile(join(plugin, 'commands', 'debug.md'), md('debug', 'Depura'))
    await writeFile(
      join(claude, 'plugins', 'installed_plugins.json'),
      JSON.stringify({ plugins: { 'engineering@mkt': [{ installPath: plugin }] } })
    )
    // credenciais ao lado: nunca lidas
    await writeFile(join(claude, '.credentials.json'), '{"token":"SEGREDO"}')
    const project = join(home, 'proj')
    await mkdir(join(project, '.claude', 'commands'), { recursive: true })
    await writeFile(join(project, '.claude', 'commands', 'spec.md'), md('spec', 'Escreve spec'))

    const groups = await buildCatalog({ home, projectDir: project })
    expect(groups.map((g) => [g.title, g.commands.map((c) => c.name)])).toEqual([
      ['Seus comandos', ['deploy', 'revisar']],
      ['Deste projeto', ['spec']],
      ['engineering', ['engineering:debug']]
    ])
    expect(JSON.stringify(groups)).not.toContain('SEGREDO')
    expect(JSON.stringify(groups)).not.toContain('CORPO-SECRETO')
    expect(groups[0]!.commands[1]!.description).toBe('Revisa o diff')
  })

  it('pastas ausentes e JSON inválido não quebram', async () => {
    expect(await buildCatalog({ home })).toEqual([])
    expect(parseInstalledPlugins('{{')).toEqual([])
  })
})
