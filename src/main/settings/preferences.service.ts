/**
 * Fase 4: preferências que o main aplica (padrão das sessões, autonomia sem agente, avisos do
 * sistema, atalho global) e o uso de disco do Orkio (Diagnóstico).
 */
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { DomainError } from '../errors'
import type { ConfigStore } from '../storage/config-store'
import type { OrkioConfig } from '../config/orkio-config'
import {
  DEFAULT_PREFERENCES,
  parsePreferences,
  type AppPreferences,
  type StorageUsage
} from '../../shared/preferences'

export class PreferencesError extends DomainError {
  constructor(message: string) {
    super('read_only', message)
    this.name = 'PreferencesError'
  }
}

export interface PreferencesDeps {
  config: Pick<ConfigStore<OrkioConfig>, 'get' | 'update' | 'readOnly'>
  /** Avisado depois de salvar (ex.: registrar o atalho global de novo). */
  onChange?(prefs: AppPreferences): void
}

export class PreferencesService {
  constructor(private readonly deps: PreferencesDeps) {}

  get(): AppPreferences {
    const raw = this.deps.config.get().preferences
    return raw
      ? parsePreferences(raw)
      : {
          ...DEFAULT_PREFERENCES,
          notifications: { ...DEFAULT_PREFERENCES.notifications, muted: [] }
        }
  }

  async save(patch: Partial<AppPreferences>): Promise<AppPreferences> {
    if (this.deps.config.readOnly) {
      throw new PreferencesError('A configuração está em modo só leitura.')
    }
    const next = parsePreferences({ ...this.get(), ...patch })
    await this.deps.config.update((c) => ({ ...c, preferences: next }))
    this.deps.onChange?.(next)
    return next
  }
}

/** Notificação do sistema permitida para o projeto? E com som? */
export function notificationAllowed(
  prefs: AppPreferences,
  projectId: string | null
): { show: boolean; silent: boolean } {
  const n = prefs.notifications
  const muted = projectId !== null && n.muted.includes(projectId)
  return { show: n.system && !muted, silent: !n.sound }
}

/** Tamanho de uma pasta (sem seguir links; até `maxEntries` arquivos para não travar). */
async function dirBytes(
  dir: string,
  maxEntries = 20_000
): Promise<{ bytes: number; files: number }> {
  let bytes = 0
  let files = 0
  const stack = [dir]
  while (stack.length > 0 && files < maxEntries) {
    const current = stack.pop()!
    let entries
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      const p = join(current, e.name)
      if (e.isDirectory()) stack.push(p)
      else if (e.isFile()) {
        files += 1
        bytes += await stat(p).then(
          (s) => s.size,
          () => 0
        )
      }
    }
  }
  return { bytes, files }
}

/** Uso do disco: execuções (log de cada uma), ambientes de tarefa e memória dos agentes. */
export async function storageUsage(paths: {
  runs: string
  worktrees: string
  agentMemory: string
  keepPerTask: number
}): Promise<StorageUsage> {
  const runs = await dirBytes(paths.runs)
  const memory = await dirBytes(paths.agentMemory)
  // Ambientes: só conta (`worktrees/<projeto>/<ID>`); medir o tamanho leria repositórios inteiros.
  let worktrees = 0
  const projects = await readdir(paths.worktrees, { withFileTypes: true }).catch(() => [])
  for (const p of projects) {
    if (!p.isDirectory()) continue
    const inner = await readdir(join(paths.worktrees, p.name), { withFileTypes: true }).catch(
      () => []
    )
    worktrees += inner.filter((e) => e.isDirectory()).length
  }
  return {
    runsBytes: runs.bytes,
    runsCount: runs.files,
    runsKeptPerTask: paths.keepPerTask,
    worktrees,
    agentMemoryBytes: memory.bytes
  }
}
