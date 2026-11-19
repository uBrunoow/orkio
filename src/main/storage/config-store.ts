import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

/**
 * Armazenamento de configuração NÃO secreta (JSON em userData). Segredos vão no SecureStore.
 *
 * - Escrita atômica: arquivo temporário + fsync + rename; escritas serializadas.
 * - `schemaVersion` + migrações encadeadas (v → v+1).
 * - Arquivo corrompido/inválido: vira backup (`<nome>.corrupt-<data>.json`) e começamos vazio,
 *   com aviso. Nunca derruba o app.
 * - Versão mais nova que a suportada: não sobrescreve (modo só leitura), com aviso.
 */

export interface ConfigStoreOptions<T> {
  file: string
  currentVersion: number
  /** `migrations[v]` converte dados da versão v para v+1. */
  migrations?: Record<number, (data: Record<string, unknown>) => Record<string, unknown>>
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

  constructor(private readonly options: ConfigStoreOptions<T>) {
    this.data = options.empty()
  }

  async load(): Promise<{ data: T; warning?: string }> {
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
      const migrate = this.options.migrations?.[v]
      if (!migrate) return this.recoverFromCorruption()
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
    const run = this.writing.then(() => atomicWrite(this.options.file, snapshot))
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

export class ConfigReadOnlyError extends Error {
  constructor() {
    super('As configurações estão em modo somente leitura.')
    this.name = 'ConfigReadOnlyError'
  }
}

async function atomicWrite(file: string, content: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  try {
    const handle = await open(tmp, 'w', 0o644)
    try {
      await handle.writeFile(content, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(tmp, file)
  } catch (error) {
    await rm(tmp, { force: true })
    throw error
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
