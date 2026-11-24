/**
 * Coletor do diagnóstico (Configurações > Sobre > "Copiar diagnóstico"). Junta só versões,
 * contagens e estados, sem rede: o banco local (versão, `quick_check`, filas), a config (esquema,
 * só leitura), as conexões (só o estado), versões de git/gh/claude e quantas pastas de trabalho e
 * logs existem. O texto final passa por `redactSecrets` mesmo assim.
 */
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { formatDiagnostics, type DiagnosticSection } from '../../shared/diagnostics'
import { redactSecrets } from '../claude/redact'
import type { Db } from '../db/database'
import type { ConnectionStatus } from '../../shared/connection'
import type { UserDataPaths } from '../platform/paths'

export interface DiagnosticsDeps {
  app: { version: string; packaged: boolean }
  runtime: { electron: string; node: string; chrome: string }
  os: { platform: string; arch: string; release: string }
  config: { schemaVersion: number; readOnly: boolean }
  db: Db | null
  /** Contagens das execuções de fluxo, pelo dono da tabela (`null` = sem banco). */
  flows: { counts(): { total: number; active: number } } | null
  connections: () => Promise<{ name: string; status: ConnectionStatus }[]>
  /** `<cmd> --version` (primeira linha) ou `null` se não estiver instalado. */
  toolVersion: (cmd: 'git' | 'gh' | 'claude') => Promise<string | null>
  /** Pastas do userData (`userDataPaths()`): worktrees por projeto e logs das execuções. */
  paths: Pick<UserDataPaths, 'worktrees' | 'runs'>
  /** Nomes numa pasta (padrão: `fs.readdir`). */
  listDir?: (dir: string) => Promise<string[]>
  projects: () => { total: number; withBoard: number }
  automation: () => { polling: number; failing: number }
  now?: () => Date
}

function count(db: Db, sql: string): number | null {
  try {
    return db.get<{ n: number }>(sql)?.n ?? 0
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
  let flowCounts: { total: number; active: number } | null
  try {
    flowCounts = deps.flows?.counts() ?? null
  } catch {
    flowCounts = null
  }

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
        ['Eventos de tarefas', db ? count(db, 'SELECT COUNT(*) AS n FROM task_events') : null],
        ['Execuções do Claude Code', db ? count(db, 'SELECT COUNT(*) AS n FROM agent_runs') : null],
        ['Execuções de fluxo', flowCounts?.total ?? null],
        ['Pastas de trabalho (worktrees)', worktrees],
        ['Logs de execução', runs]
      ]
    },
    {
      title: 'Agora',
      rows: [
        [
          'Claude Code rodando ou na fila',
          db
            ? count(
                db,
                "SELECT COUNT(*) AS n FROM agent_runs WHERE status IN ('queued', 'running')"
              )
            : null
        ],
        ['Fluxos em andamento', flowCounts?.active ?? null],
        [
          'Escritas pendentes no Notion',
          db ? count(db, 'SELECT COUNT(*) AS n FROM pending_writes') : null
        ],
        [
          'Escritas com 3+ tentativas',
          db ? count(db, 'SELECT COUNT(*) AS n FROM pending_writes WHERE attempts >= 3') : null
        ],
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
