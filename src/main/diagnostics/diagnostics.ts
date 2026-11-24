/**
 * Coletor do diagnóstico (Configurações > Sobre > "Copiar diagnóstico"). Junta só versões,
 * contagens e estados, sem rede: o banco local (versão, `quick_check`, filas), a config (esquema,
 * só leitura), as conexões (só o estado), versões de git/gh/claude e quantas pastas de trabalho e
 * logs existem. O texto final passa por `redactSecrets` mesmo assim.
 */
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { formatDiagnostics, type DiagnosticSection } from '../../shared/diagnostics'
import { redactSecrets } from '../platform/redact'
import type { Db } from '../db/database'
import { NOTION_PENDING_ATTEMPTS } from '../../shared/overview'
import type { ConnectionStatus } from '../../shared/connection'
import type { UserDataPaths } from '../platform/paths'

export interface DiagnosticsDeps {
  app: { version: string; packaged: boolean }
  runtime: { electron: string; node: string; chrome: string }
  os: { platform: string; arch: string; release: string }
  config: { schemaVersion: number; readOnly: boolean }
  /** Banco local (versão e `quick_check`); as contagens vêm dos donos das tabelas. */
  db: Db | null
  /** Contagens pelos donos das tabelas (`null` = sem banco): fluxos, execuções e quadro. */
  flows: { counts(): { total: number; active: number } } | null
  runs: { counts(): { total: number; active: number } } | null
  board: {
    counts(): { events: number; pendingWrites: number }
    stuckWrites(minAttempts: number): readonly unknown[]
  } | null
  connections: () => Promise<{ name: string; status: ConnectionStatus }[]>
  /** `<cmd> --version` (primeira linha) ou `null` se não estiver instalado. */
  toolVersion: (cmd: 'git' | 'gh' | 'claude') => Promise<string | null>
  paths: Pick<UserDataPaths, 'worktrees' | 'runs'>
  listDir?: (dir: string) => Promise<string[]>
  projects: () => { total: number; withBoard: number }
  automation: () => { polling: number; failing: number }
  now?: () => Date
}

/** Escritas com esta quantidade de tentativas contam como presas (a mesma regra do sino). */
const STUCK_ATTEMPTS = NOTION_PENDING_ATTEMPTS

/** Uma contagem que falhou vira "—" (o resto do diagnóstico sai). */
function safe<T>(read: () => T): T | null {
  try {
    return read()
  } catch {
    return null
  }
}

/** Worktrees (`worktrees/<projeto>/<ID>`) e logs (`runs/<id>.jsonl`); pasta ausente = 0. */
async function countEntries(
  paths: DiagnosticsDeps['paths'],
  listDir: (dir: string) => Promise<string[]>
): Promise<{ worktrees: number; runs: number }> {
  const list = (dir: string): Promise<string[]> => listDir(dir).catch(() => [])
  let worktrees = 0
  for (const project of await list(paths.worktrees)) {
    worktrees += (await list(join(paths.worktrees, project))).length
  }
  return { worktrees, runs: (await list(paths.runs)).length }
}

function connectionState(s: ConnectionStatus): string {
  if (s.state === 'connected')
    return s.warning ? 'conectado (última verificação falhou)' : 'conectado'
  if (s.state === 'error') return s.hasStoredCredentials ? 'erro (credencial salva)' : 'erro'
  return s.state === 'connecting' ? 'conectando' : 'desconectado'
}

export async function collectDiagnostics(deps: DiagnosticsDeps): Promise<string> {
  const now = (deps.now ?? (() => new Date()))()
  const [connections, git, gh, claude, entries] = await Promise.all([
    deps.connections().catch(() => []),
    deps.toolVersion('git').catch(() => null),
    deps.toolVersion('gh').catch(() => null),
    deps.toolVersion('claude').catch(() => null),
    countEntries(deps.paths, deps.listDir ?? ((dir) => readdir(dir))).catch(() => null)
  ])
  const worktrees = entries?.worktrees ?? null
  const runs = entries?.runs ?? null

  const db = deps.db
  let integrity: string | null = null
  if (db) {
    try {
      const rows = db.all<{ quick_check: string }>('PRAGMA quick_check')
      integrity = rows.map((r) => r.quick_check).join('; ') || null
    } catch {
      integrity = 'não deu para verificar'
    }
  }
  const projects = deps.projects()
  const automation = deps.automation()
  const flowCounts = safe(() => deps.flows?.counts() ?? null)
  const runCounts = safe(() => deps.runs?.counts() ?? null)
  const boardCounts = safe(() => deps.board?.counts() ?? null)
  const stuck = safe(() => deps.board?.stuckWrites(STUCK_ATTEMPTS).length ?? null)

  const sections: DiagnosticSection[] = [
    {
      title: 'App',
      rows: [
        ['Versão', deps.app.version],
        ['Empacotado', deps.app.packaged],
        ['Electron', deps.runtime.electron],
        ['Node', deps.runtime.node],
        ['Chromium', deps.runtime.chrome],
        ['Sistema', `${deps.os.platform} ${deps.os.release} (${deps.os.arch})`]
      ]
    },
    {
      title: 'Dados locais',
      rows: [
        ['Config (schema)', deps.config.schemaVersion],
        ['Config só leitura (versão futura)', deps.config.readOnly],
        ['Banco local', db ? `v${db.version}` : 'indisponível'],
        ['Integridade do banco', integrity],
        ['Eventos de tarefas', boardCounts?.events ?? null],
        ['Execuções do Claude Code', runCounts?.total ?? null],
        ['Execuções de fluxo', flowCounts?.total ?? null],
        ['Pastas de trabalho (worktrees)', worktrees],
        ['Logs de execução', runs]
      ]
    },
    {
      title: 'Agora',
      rows: [
        ['Claude Code rodando ou na fila', runCounts?.active ?? null],
        ['Fluxos em andamento', flowCounts?.active ?? null],
        ['Escritas pendentes no Notion', boardCounts?.pendingWrites ?? null],
        [`Escritas com ${STUCK_ATTEMPTS}+ tentativas`, stuck],
        ['Projetos', projects.total],
        ['Projetos com quadro', projects.withBoard],
        ['Projetos com automação ativa', automation.polling],
        ['Projetos com a última verificação falhando', automation.failing]
      ]
    },
    {
      title: 'Conexões e ferramentas',
      rows: [
        ...connections.map((c) => [c.name, connectionState(c.status)] as const),
        ['git', git ?? 'não encontrado'],
        ['gh', gh ?? 'não encontrado'],
        ['claude', claude ?? 'não encontrado']
      ]
    }
  ]
  return redactSecrets(formatDiagnostics(now.toISOString(), sections))
}
