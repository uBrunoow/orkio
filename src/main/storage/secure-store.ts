import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { atomicWriteFile } from './atomic-write'

/** Subconjunto do `safeStorage` do Electron que usamos (facilita mock em testes). */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean
  encryptString(plainText: string): Buffer
  decryptString(encrypted: Buffer): string
  /** Só existe no Linux. `basic_text` significa senha fixa, ou seja, sem proteção real. */
  getSelectedStorageBackend?(): string
}

export class EncryptionUnavailableError extends Error {
  constructor() {
    super('Armazenamento seguro indisponível neste sistema.')
    this.name = 'EncryptionUnavailableError'
  }
}

export class SecretReadError extends Error {
  constructor() {
    super('Não foi possível ler o segredo salvo.')
    this.name = 'SecretReadError'
  }
}

export interface SecretStore {
  isAvailable(): boolean
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
  delete(key: string): Promise<void>
}

const KEY_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/

/** Backends do Linux que não oferecem criptografia de verdade. */
const INSECURE_LINUX_BACKENDS = new Set(['basic_text', 'unknown'])

/**
 * Guarda segredos criptografados com `safeStorage`, um arquivo por chave em `<dir>/<key>.bin`.
 * Nunca grava texto puro: se a criptografia não estiver disponível, lança `EncryptionUnavailableError`.
 */
export class SecureStore implements SecretStore {
  constructor(
    private readonly dir: string,
    private readonly safeStorage: SafeStorageLike
  ) {}

  isAvailable(): boolean {
    if (!this.safeStorage.isEncryptionAvailable()) return false
    const backend = this.safeStorage.getSelectedStorageBackend?.()
    return backend === undefined || !INSECURE_LINUX_BACKENDS.has(backend)
  }

  async get(key: string): Promise<string | null> {
    const file = this.fileFor(key)
    let encrypted: Buffer
    try {
      encrypted = await readFile(file)
    } catch (error) {
      if (isNotFound(error)) return null
      throw new SecretReadError()
    }
    this.assertAvailable()
    try {
      return this.safeStorage.decryptString(encrypted)
    } catch {
      throw new SecretReadError()
    }
  }

  async set(key: string, value: string): Promise<void> {
    const file = this.fileFor(key)
    this.assertAvailable()
    const encrypted = this.safeStorage.encryptString(value)
    await atomicWriteFile(file, encrypted, { mode: 0o600, fsync: true, dirMode: 0o700 })
  }

  async delete(key: string): Promise<void> {
    await rm(this.fileFor(key), { force: true })
  }

  private assertAvailable(): void {
    if (!this.isAvailable()) throw new EncryptionUnavailableError()
  }

  private fileFor(key: string): string {
    if (!KEY_PATTERN.test(key)) throw new Error(`Chave de segredo inválida: ${key}`)
    return join(this.dir, `${key}.bin`)
  }
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === 'ENOENT'
  )
}
