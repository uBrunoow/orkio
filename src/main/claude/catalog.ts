/**
 * Catálogo de comandos do Claude Code (Etapa 4B): comandos e skills do usuário, do projeto e dos
 * plugins instalados, agrupados por origem.
 *
 * Lê SÓ metadados (`name` e `description` do frontmatter) de arquivos .md. Nunca abre
 * credenciais, settings, MCP configs nem o corpo dos comandos.
 */
import { readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import type { CatalogCommand, CatalogGroup } from '../../shared/agent-run'

export type { CatalogCommand, CatalogGroup }

const MAX_FILES_PER_DIR = 300
const MAX_HEAD_BYTES = 8 * 1024
/** `installed_plugins.json` cresce com cada plugin (~170 bytes cada): lido inteiro, até 1 MB. */
const MAX_INDEX_BYTES = 1024 * 1024
const NAME = /^[A-Za-z0-9][\w:.-]{0,80}$/

/** Frontmatter simples (`chave: valor`), só as duas chaves que interessam. */
export function parseFrontmatter(text: string): { name?: string; description?: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  if (!m) return {}
  const out: { name?: string; description?: string } = {}
  for (const line of (m[1] ?? '').split(/\r?\n/)) {
    const kv = /^(name|description)\s*:\s*(.*)$/.exec(line)
    if (!kv) continue
    let v = (kv[2] ?? '').trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1)
    }
    if (/^[>|][+-]?$/.test(v)) continue // bloco multilinha: sem descrição
    out[kv[1] as 'name' | 'description'] = v.slice(0, 200)
  }
  return out
}

export interface CatalogFs {
  readdir(path: string): Promise<string[]>
  /** Só o começo do arquivo (frontmatter). */
  readHead(path: string): Promise<string | null>
  /** Arquivo inteiro (índices JSON); `null` se não existir ou passar do limite. */
  readText(path: string): Promise<string | null>
  isDir(path: string): Promise<boolean>
}

export const realCatalogFs: CatalogFs = {
  readdir: (p) => readdir(p),
  async readHead(p) {
    try {
      const s = await stat(p)
      if (!s.isFile()) return null
      return (await readFile(p, 'utf8')).slice(0, MAX_HEAD_BYTES)
    } catch {
      return null
    }
  },
  async readText(p) {
    try {
      const s = await stat(p)
      if (!s.isFile() || s.size > MAX_INDEX_BYTES) return null
      return await readFile(p, 'utf8')
    } catch {
      return null
    }
  },
  async isDir(p) {
    try {
      return (await stat(p)).isDirectory()
    } catch {
      return false
    }
  }
}

async function scanDir(fs: CatalogFs, dir: string, prefix: string): Promise<CatalogCommand[]> {
  const out: CatalogCommand[] = []
  let entries: string[]
  try {
    entries = (await fs.readdir(dir)).slice(0, MAX_FILES_PER_DIR)
  } catch {
    return out
  }
  for (const entry of entries) {
    // Comandos: <dir>/commands/<nome>.md; skills: <dir>/skills/<nome>/SKILL.md
    const asSkill = dir.endsWith('skills')
    const file = asSkill ? join(dir, entry, 'SKILL.md') : join(dir, entry)
    if (!asSkill && !entry.endsWith('.md')) continue
    const head = await fs.readHead(file)
    if (head === null) continue
    const meta = parseFrontmatter(head)
    const base = asSkill ? entry : basename(entry, '.md')
    const name = meta.name && NAME.test(meta.name) ? meta.name : base
    if (!NAME.test(name)) continue
    out.push({
      name: prefix ? `${prefix}:${name}` : name,
      description: meta.description ?? '',
      kind: asSkill ? 'skill' : 'command'
    })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

/** `installed_plugins.json`: só nome e pasta de instalação de cada plugin. */
export function parseInstalledPlugins(json: string): { name: string; path: string }[] {
  try {
    const data = JSON.parse(json) as { plugins?: Record<string, unknown> }
    const out: { name: string; path: string }[] = []
    for (const [key, value] of Object.entries(data.plugins ?? {})) {
      const list = Array.isArray(value) ? value : [value]
      const entry = list.find(
        (v): v is { installPath: string } =>
          typeof v === 'object' &&
          v !== null &&
          typeof (v as { installPath?: unknown }).installPath === 'string'
      )
      if (entry) out.push({ name: key.split('@')[0] ?? key, path: entry.installPath })
    }
    return out
  } catch {
    return []
  }
}

export async function buildCatalog(options: {
  fs?: CatalogFs
  home?: string
  /** Pasta do worktree/projeto (comandos em `.claude/`). */
  projectDir?: string | null
}): Promise<CatalogGroup[]> {
  const fs = options.fs ?? realCatalogFs
  const claude = join(options.home ?? homedir(), '.claude')
  const groups: CatalogGroup[] = []
  const add = (g: CatalogGroup): void => {
    g.commands.sort((a, b) => a.name.localeCompare(b.name))
    if (g.commands.length > 0) groups.push(g)
  }

  add({
    id: 'user',
    title: 'Seus comandos',
    source: 'user',
    commands: [
      ...(await scanDir(fs, join(claude, 'commands'), '')),
      ...(await scanDir(fs, join(claude, 'skills'), ''))
    ]
  })
  if (options.projectDir) {
    add({
      id: 'project',
      title: 'Deste projeto',
      source: 'project',
      commands: [
        ...(await scanDir(fs, join(options.projectDir, '.claude', 'commands'), '')),
        ...(await scanDir(fs, join(options.projectDir, '.claude', 'skills'), ''))
      ]
    })
  }

  // Inteiro: cortado em 8 KB, o JSON (com muitos plugins) não fecha e o catálogo perdia todos.
  const installed = await fs.readText(join(claude, 'plugins', 'installed_plugins.json'))
  for (const plugin of installed ? parseInstalledPlugins(installed) : []) {
    if (!(await fs.isDir(plugin.path))) continue
    add({
      id: `plugin:${plugin.name}`,
      title: plugin.name,
      source: 'plugin',
      commands: [
        ...(await scanDir(fs, join(plugin.path, 'commands'), plugin.name)),
        ...(await scanDir(fs, join(plugin.path, 'skills'), plugin.name))
      ]
    })
  }
  return groups
}
