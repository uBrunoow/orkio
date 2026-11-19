import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  EncryptionUnavailableError,
  SecretReadError,
  SecureStore,
  type SafeStorageLike
} from './secure-store'

/** Mock de safeStorage: "criptografa" invertendo e prefixando, para provar que não é texto puro. */
function fakeSafeStorage(overrides: Partial<SafeStorageLike> = {}): SafeStorageLike {
  return {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((s: string) => Buffer.from('enc:' + [...s].reverse().join(''))),
    decryptString: vi.fn((b: Buffer) => {
      const raw = b.toString()
      if (!raw.startsWith('enc:')) throw new Error('bad ciphertext')
      return [...raw.slice(4)].reverse().join('')
    }),
    ...overrides
  }
}

const SECRET = 'ntn_super_secret_value_123'

describe('SecureStore', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'orkio-secure-store-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('salva criptografado e lê de volta', async () => {
    const store = new SecureStore(join(dir, 'secrets'), fakeSafeStorage())
    await store.set('notion', SECRET)

    const onDisk = await readFile(join(dir, 'secrets', 'notion.bin'), 'utf8')
    expect(onDisk).not.toContain(SECRET)
    expect(await store.get('notion')).toBe(SECRET)
  })

  it('grava o arquivo com permissão 0600 e não deixa temporários', async () => {
    const store = new SecureStore(dir, fakeSafeStorage())
    await store.set('notion', SECRET)
    if (process.platform !== 'win32') {
      const mode = (await stat(join(dir, 'notion.bin'))).mode & 0o777
      expect(mode).toBe(0o600)
    }
    expect(await readdir(dir)).toEqual(['notion.bin'])
  })

  it('retorna null quando não há segredo salvo', async () => {
    const store = new SecureStore(dir, fakeSafeStorage())
    expect(await store.get('notion')).toBeNull()
  })

  it('apaga o arquivo do disco e é idempotente', async () => {
    const store = new SecureStore(dir, fakeSafeStorage())
    await store.set('notion', SECRET)
    await store.delete('notion')
    await store.delete('notion')
    expect(await readdir(dir)).toEqual([])
    expect(await store.get('notion')).toBeNull()
  })

  describe('criptografia indisponível', () => {
    it('set lança EncryptionUnavailableError e NÃO grava nada', async () => {
      const safe = fakeSafeStorage({ isEncryptionAvailable: vi.fn(() => false) })
      const store = new SecureStore(join(dir, 'secrets'), safe)

      expect(store.isAvailable()).toBe(false)
      await expect(store.set('notion', SECRET)).rejects.toBeInstanceOf(EncryptionUnavailableError)
      expect(safe.encryptString).not.toHaveBeenCalled()
      await expect(readdir(join(dir, 'secrets'))).rejects.toMatchObject({ code: 'ENOENT' })
    })

    it('trata o backend basic_text do Linux como indisponível', async () => {
      const safe = fakeSafeStorage({ getSelectedStorageBackend: () => 'basic_text' })
      const store = new SecureStore(dir, safe)

      expect(store.isAvailable()).toBe(false)
      await expect(store.set('notion', SECRET)).rejects.toBeInstanceOf(EncryptionUnavailableError)
      expect(await readdir(dir)).toEqual([])
    })

    it('aceita backends reais do Linux (gnome_libsecret, kwallet)', () => {
      for (const backend of ['gnome_libsecret', 'kwallet5', 'kwallet6']) {
        const store = new SecureStore(dir, fakeSafeStorage({ getSelectedStorageBackend: () => backend }))
        expect(store.isAvailable()).toBe(true)
      }
    })

    it('get lança EncryptionUnavailableError se existe arquivo mas não dá para decifrar', async () => {
      await writeFile(join(dir, 'notion.bin'), 'enc:xyz')
      const store = new SecureStore(dir, fakeSafeStorage({ isEncryptionAvailable: () => false }))
      await expect(store.get('notion')).rejects.toBeInstanceOf(EncryptionUnavailableError)
    })
  })

  it('arquivo corrompido gera SecretReadError sem expor o conteúdo', async () => {
    await writeFile(join(dir, 'notion.bin'), 'lixo')
    const store = new SecureStore(dir, fakeSafeStorage())
    const error = await store.get('notion').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(SecretReadError)
    expect(String(error)).not.toContain('lixo')
  })

  it('rejeita chaves que poderiam escapar do diretório', async () => {
    const store = new SecureStore(dir, fakeSafeStorage())
    for (const key of ['../evil', 'a/b', '', 'UPPER', '.hidden']) {
      await expect(store.set(key, SECRET)).rejects.toThrow('Chave de segredo inválida')
    }
  })
})
