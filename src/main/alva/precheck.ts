/**
 * "Pronto para o alva-flow?" (Etapa 5B): checa, por projeto, o que o plugin precisa na máquina e
 * no repositório. Só lê metadados: versão do plugin, existência de arquivos, nome/status dos MCPs
 * (`claude mcp list`), código de saída do `gh auth status`. Nunca guarda nem loga a saída.
 */
import { statSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  ALVA_COMMANDS,
  ALVA_PLUGIN,
  alvaCommand,
  type AlvaCheckItem,
  type AlvaPrecheck
} from '../../shared/alva'
import { parseInstalledPlugins } from '../claude/catalog'
import { compareVersions } from '../claude/detect'

const MIN_COMPOSE = '2.24.4'
const COMPOSE_FILES = [
  'docker/docker-compose.dev.yml',
  'docker-compose.dev.yml',
  'compose.yaml',
  'compose.yml',
  'docker-compose.yml'
]

/**
 * O projeto usa Docker Compose (algum arquivo de compose conhecido)? Leitura local e síncrona, sem
 * depender da pré-checagem: o limite de fluxos Alva em paralelo pergunta isto ao reabrir o app.
 */
export function hasComposeFile(projectDir: string): boolean {
  return COMPOSE_FILES.some(
    (f) => statSync(join(projectDir, f), { throwIfNoEntry: false })?.isFile() === true
  )
}

export type ExecResult = { code: number; stdout: string }
export type Exec = (
  command: string,
  args: string[],
  options: { cwd: string; timeoutMs: number }
) => Promise<ExecResult>

export interface PrecheckDeps {
  exec: Exec
  /** Pasta neutra (fora de qualquer projeto): `claude mcp list` ali só vê o escopo do usuário. */
  neutralDir: string
  home?: string
  readText?: (path: string) => Promise<string | null>
  isDir?: (path: string) => Promise<boolean>
  isFile?: (path: string) => Promise<boolean>
}

async function defaultReadText(path: string): Promise<string | null> {
  try {
    const s = await stat(path)
    if (!s.isFile() || s.size > 512 * 1024) return null
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}
async function defaultIsDir(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}
async function defaultIsFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

/**
 * Linhas de `claude mcp list` (`nome: <comando ou url> - ✔ Connected`). Devolve só nome e status;
 * o resto da linha (comando/URL) é descartado.
 */
export function parseMcpList(
  stdout: string
): { name: string; status: 'ok' | 'pending' | 'failed' }[] {
  const out: { name: string; status: 'ok' | 'pending' | 'failed' }[] = []
  for (const line of stdout.split(/\r?\n/)) {
    const m = /^([A-Za-z0-9._-]{1,64}):\s.*\s-\s+(\S)/.exec(line.trim())
    if (!m) continue
    const mark = m[2]!
    out.push({
      name: m[1]!,
      status: mark === '✔' ? 'ok' : mark === '⏸' ? 'pending' : 'failed'
    })
  }
  return out
}

/** Targets do Makefile (`nome:` no começo da linha, sem variáveis). */
export function makeTargets(makefile: string): Set<string> {
  const out = new Set<string>()
  for (const m of makefile.matchAll(/^([A-Za-z0-9_.-]+)\s*:(?!=)/gm)) out.add(m[1]!)
  return out
}

export async function runPrecheck(
  projectDir: string,
  commandsInCatalog: readonly string[],
  deps: PrecheckDeps
): Promise<AlvaPrecheck> {
  const readText = deps.readText ?? defaultReadText
  const isDir = deps.isDir ?? defaultIsDir
  const isFile = deps.isFile ?? defaultIsFile
  const claudeDir = join(deps.home ?? homedir(), '.claude')
  const items: AlvaCheckItem[] = []

  let pluginVersion: string | null = null
  const installed = await readText(join(claudeDir, 'plugins', 'installed_plugins.json'))
  const entry = installed
    ? parseInstalledPlugins(installed).find((p) => p.name === ALVA_PLUGIN)
    : null
  if (entry) {
    const manifest = await readText(join(entry.path, '.claude-plugin', 'plugin.json'))
    try {
      const v = manifest ? (JSON.parse(manifest) as { version?: unknown }).version : null
      pluginVersion = typeof v === 'string' && /^\d+\.\d+\.\d+/.test(v) ? v : null
    } catch {
      pluginVersion = null
    }
  }
  const missingCommands = ALVA_COMMANDS.filter((c) => !commandsInCatalog.includes(alvaCommand(c)))
  if (!entry && missingCommands.length === ALVA_COMMANDS.length) {
    items.push({
      id: 'plugin',
      label: 'Plugin alva-flow',
      state: 'missing',
      detail: 'Não está instalado no Claude Code.',
      fix: '/plugin marketplace add alva-dev-team/alva-flow\n/plugin install alva-flow@alva-flow-marketplace'
    })
  } else if (missingCommands.length > 0) {
    items.push({
      id: 'plugin',
      label: 'Plugin alva-flow',
      state: 'missing',
      detail: `Faltam comandos: ${missingCommands.map((c) => `/${alvaCommand(c)}`).join(', ')}.`,
      fix: '/plugin update alva-flow@alva-flow-marketplace'
    })
  } else {
    items.push({
      id: 'plugin',
      label: 'Plugin alva-flow',
      state: 'ok',
      detail: pluginVersion ? `Versão ${pluginVersion}.` : 'Instalado (versão não informada).'
    })
  }

  const hasConfig = await isFile(join(projectDir, 'backlog', 'config.yml'))
  const hasTasks = await isDir(join(projectDir, 'backlog', 'tasks'))
  items.push(
    hasConfig && hasTasks
      ? {
          id: 'backlog',
          label: 'Backlog.md no repositório',
          state: 'ok',
          detail: 'backlog/config.yml e backlog/tasks/.'
        }
      : {
          id: 'backlog',
          label: 'Backlog.md no repositório',
          state: 'missing',
          detail: `Falta ${[!hasConfig ? 'backlog/config.yml' : '', !hasTasks ? 'backlog/tasks/' : ''].filter(Boolean).join(' e ')} (commitados na branch principal).`,
          fix: 'backlog init'
        }
  )

  // MCP do Backlog.md: escopo do usuário (vale em qualquer worktree) ou só no projeto.
  const findBacklog = async (cwd: string): Promise<'ok' | 'pending' | 'failed' | null> => {
    const r = await deps
      .exec('claude', ['mcp', 'list'], { cwd, timeoutMs: 60_000 })
      .catch(() => null)
    if (!r) return null
    return parseMcpList(r.stdout).find((s) => s.name === 'backlog')?.status ?? null
  }
  const userScope = await findBacklog(deps.neutralDir)
  if (userScope === 'ok') {
    items.push({
      id: 'backlog_mcp',
      label: 'MCP do Backlog.md',
      state: 'ok',
      detail: 'Configurado no escopo do usuário e conectado.'
    })
  } else if (userScope) {
    items.push({
      id: 'backlog_mcp',
      label: 'MCP do Backlog.md',
      state: 'warning',
      detail:
        'Configurado, mas não conectou. Confira se o comando `backlog` está instalado (`npm i -g backlog.md`).'
    })
  } else {
    const projectScope = await findBacklog(projectDir)
    items.push(
      projectScope
        ? {
            id: 'backlog_mcp',
            label: 'MCP do Backlog.md',
            state: 'warning',
            detail:
              'Configurado só para a pasta do projeto. O Orkio roda o Claude Code em outra pasta (worktree), onde ele não aparece. Configure no escopo do usuário.',
            fix: 'claude mcp add backlog --scope user -- backlog mcp start'
          }
        : {
            id: 'backlog_mcp',
            label: 'MCP do Backlog.md',
            state: 'missing',
            detail: 'Não configurado no Claude Code.',
            fix: 'claude mcp add backlog --scope user -- backlog mcp start'
          }
    )
  }

  // gh instalado e autenticado (só o código de saída).
  const ghVersion = await deps
    .exec('gh', ['--version'], { cwd: deps.neutralDir, timeoutMs: 15_000 })
    .catch(() => null)
  if (!ghVersion || ghVersion.code !== 0) {
    items.push({
      id: 'gh',
      label: 'GitHub CLI (gh)',
      state: 'missing',
      detail: 'Não encontrado.',
      fix: 'https://cli.github.com'
    })
  } else {
    const auth = await deps
      .exec('gh', ['auth', 'status'], { cwd: deps.neutralDir, timeoutMs: 15_000 })
      .catch(() => null)
    items.push(
      auth?.code === 0
        ? { id: 'gh', label: 'GitHub CLI (gh)', state: 'ok', detail: 'Instalado e autenticado.' }
        : {
            id: 'gh',
            label: 'GitHub CLI (gh)',
            state: 'missing',
            detail: 'Instalado, mas sem login.',
            fix: 'gh auth login'
          }
    )
  }

  // python3 (scripts de CI e comentários do /pr).
  const py = await deps
    .exec('python3', ['--version'], { cwd: deps.neutralDir, timeoutMs: 15_000 })
    .catch(() => null)
  items.push(
    py?.code === 0
      ? { id: 'python', label: 'Python 3', state: 'ok', detail: 'Encontrado.' }
      : {
          id: 'python',
          label: 'Python 3',
          state: 'missing',
          detail: 'Não encontrado (o /pr usa scripts em Python).'
        }
  )

  const makefile = await readText(join(projectDir, 'Makefile'))
  if (makefile === null) {
    items.push({
      id: 'makefile',
      label: 'Makefile',
      state: 'missing',
      detail:
        'Sem Makefile: os comandos do alva-flow descobrem os testes e o lint por targets como `make test`.'
    })
  } else {
    const targets = makeTargets(makefile)
    const lacking = ['test', 'lint'].filter((t) => !targets.has(t))
    items.push(
      lacking.length === 0
        ? { id: 'makefile', label: 'Makefile', state: 'ok', detail: 'Targets test e lint.' }
        : {
            id: 'makefile',
            label: 'Makefile',
            state: 'missing',
            detail: `Faltam os targets: ${lacking.join(', ')}.`
          }
    )
  }

  let hasDocker = false
  for (const f of COMPOSE_FILES) if (await isFile(join(projectDir, f))) hasDocker = true
  if (hasDocker) {
    const v = await deps
      .exec('docker', ['compose', 'version', '--short'], {
        cwd: deps.neutralDir,
        timeoutMs: 15_000
      })
      .catch(() => null)
    const version = v?.code === 0 ? (/(\d+\.\d+\.\d+)/.exec(v.stdout)?.[1] ?? null) : null
    const running =
      (
        await deps
          .exec('docker', ['info', '--format', '{{.ServerVersion}}'], {
            cwd: deps.neutralDir,
            timeoutMs: 20_000
          })
          .catch(() => null)
      )?.code === 0
    if (!version) {
      items.push({
        id: 'docker',
        label: 'Docker Compose',
        state: 'missing',
        detail: 'O projeto usa Docker Compose, mas ele não foi encontrado.'
      })
    } else if (compareVersions(version, MIN_COMPOSE) < 0) {
      items.push({
        id: 'docker',
        label: 'Docker Compose',
        state: 'missing',
        detail: `Versão ${version}; o alva-flow precisa de ${MIN_COMPOSE} ou mais nova.`
      })
    } else if (!running) {
      items.push({
        id: 'docker',
        label: 'Docker Compose',
        state: 'missing',
        detail: `Versão ${version}, mas o Docker não está rodando.`
      })
    } else {
      items.push({
        id: 'docker',
        label: 'Docker Compose',
        state: 'ok',
        detail: `Versão ${version}, rodando.`
      })
    }
  }

  return {
    ready: items.every((i) => i.state !== 'missing'),
    pluginVersion,
    hasDocker,
    items,
    checkedAt: new Date().toISOString()
  }
}
