import { readFile, rename } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { atomicWriteFile } from './atomic-write'

/**
 * Armazenamento de configuração NÃO secreta (JSON em userData). Segredos vão no SecureStore.
 *
 * - Escrita atômica: arquivo temporário + fsync + rename; escritas serializadas.
 * - `schemaVersion` + migrações encadeadas (v → v+1), obrigatórias: faltar uma é erro ao criar.
 * - Arquivo corrompido/inválido: vira backup (`<nome>.corrupt-<data>.json`) e começamos vazio,
 *   com aviso. Nunca derruba o app.
 * - Versão mais nova que a suportada: não sobrescreve (modo só leitura), com aviso.
 */

/** `migrations[v]` converte dados da versão v para v+1. */
export type ConfigMigrations = Record<
  number,
  (data: Record<string, unknown>) => Record<string, unknown>
>

export interface ConfigStoreOptions<T> {
  file: string
  currentVersion: number
  /** Uma para cada versão de 0 até `currentVersion - 1`: faltando uma, o store nem é criado. */
  migrations: ConfigMigrations
  /** Valida e normaliza a versão atual. `null` = inválido. Pode devolver aviso (ex.: itens descartados). */
  validate(data: Record<string, unknown>): { value: T; warning?: string } | null
  empty(): T
  now?: () => Date
}

export class ConfigStore<T extends object> {
  private data: T
  private loaded = false
  private writing: Promise<void> = Promise.resolve()
  /** true quando o arquivo é de uma versão mais nova do Orkio: não sobrescrevemos. */
  readOnly = false
  /** Aviso da carga (ex.: arquivo corrompido recuperado, modo só leitura), mostrado em Projetos. */
  loadWarning: string | undefined

  constructor(private readonly options: ConfigStoreOptions<T>) {
    const missing = missingMigrations(options.migrations, options.currentVersion)
    // Erro de programação, não de dados: sem a migração, a carga apagaria a config de todos.
    if (missing.length > 0) {
      throw new Error(`ConfigStore: faltam as migrações ${missing.join(', ')} (v → v+1).`)
    }
    this.data = options.empty()
  }

  /** Carrega (uma vez, por quem cria o store). O aviso também fica em `loadWarning`. */
  async load(): Promise<{ data: T; warning?: string }> {
    const result = await this.read()
    this.loadWarning = result.warning
    return result
  }

  private async read(): Promise<{ data: T; warning?: string }> {
    const { file, currentVersion } = this.options
    this.loaded = true
    let raw: string
    try {
      raw = await readFile(file, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.data = this.options.empty()
        return { data: this.data }
      }
      this.data = this.options.empty()
      this.readOnly = true
      return {
        data: this.data,
        warning: 'Não foi possível ler as configurações do Orkio. Nada será salvo até reiniciar.'
      }
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return this.recoverFromCorruption()
    }
    if (!isRecord(parsed)) return this.recoverFromCorruption()

    const version = parsed['schemaVersion'] === undefined ? 0 : parsed['schemaVersion']
    if (typeof version !== 'number' || !Number.isInteger(version) || version < 0) {
      return this.recoverFromCorruption()
    }
    if (version > currentVersion) {
      this.readOnly = true
      this.data = this.options.empty()
      return {
        data: this.data,
        warning:
          'As configurações foram salvas por uma versão mais nova do Orkio. Atualize o app; ' +
          'nada será alterado até lá.'
      }
    }

    let migrated: Record<string, unknown> = parsed
    for (let v = version; v < currentVersion; v++) {
      const migrate = this.options.migrations[v]!
      try {
        migrated = { ...migrate(migrated), schemaVersion: v + 1 }
      } catch {
        return this.recoverFromCorruption()
      }
    }

    const validated = this.options.validate(migrated)
    if (!validated) return this.recoverFromCorruption()
    this.data = validated.value
    if (version !== currentVersion) await this.write()
    return validated.warning ? { data: this.data, warning: validated.warning } : { data: this.data }
  }

  get(): T {
    if (!this.loaded) throw new Error('ConfigStore.load() precisa ser chamado antes de get()')
    return this.data
  }

  /** Aplica uma alteração e grava (escritas em fila, uma por vez). */
  async update(mutate: (current: T) => T): Promise<T> {
    if (this.readOnly) {
      throw new ConfigReadOnlyError()
    }
    const next = mutate(this.get())
    this.data = next
    await this.write()
    return next
  }

  private write(): Promise<void> {
    const snapshot = JSON.stringify(
      { ...this.data, schemaVersion: this.options.currentVersion },
      null,
      2
    )
    const run = this.writing.then(() =>
      atomicWriteFile(this.options.file, snapshot, { mode: 0o644, fsync: true })
    )
    // A fila continua mesmo se uma escrita falhar; o erro vai para quem chamou.
    this.writing = run.catch(() => {})
    return run
  }

  private async recoverFromCorruption(): Promise<{ data: T; warning: string }> {
    const { file } = this.options
    const stamp = (this.options.now?.() ?? new Date()).toISOString().replace(/[:.]/g, '-')
    const backup = join(dirname(file), `${basename(file, '.json')}.corrupt-${stamp}.json`)
    try {
      await rename(file, backup)
    } catch {
      // Sem backup possível: não sobrescrevemos o original.
      this.readOnly = true
    }
    this.data = this.options.empty()
    return {
      data: this.data,
      warning: this.readOnly
        ? 'As configurações do Orkio estão corrompidas e não puderam ser recuperadas.'
        : `As configurações do Orkio estavam corrompidas. Uma cópia foi salva em ${basename(backup)} e o app começou do zero.`
    }
  }
}

export function missingMigrations(migrations: ConfigMigrations, currentVersion: number): number[] {
  const missing: number[] = []
  for (let v = 0; v < currentVersion; v++) {
    if (typeof migrations[v] !== 'function') missing.push(v)
  }
  return missing
}

export class ConfigReadOnlyError extends Error {
  constructor() {
    super('As configurações estão em modo somente leitura.')
    this.name = 'ConfigReadOnlyError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
