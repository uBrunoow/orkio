import { randomBytes } from 'node:crypto'
import { mkdir, open, rename, rm } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

export interface AtomicWriteOptions {
  /** Permissão do arquivo (ex.: 0o600 para segredos). */
  mode: number
  /** `fsync` antes do rename: o conteúdo está no disco quando o nome aparece. */
  fsync: boolean
  /** Permissão da pasta, se precisar criá-la (padrão do sistema). */
  dirMode?: number
}

/**
 * Escrita atômica: grava num temporário na mesma pasta (`.<nome>.<aleatório>.tmp`) e renomeia por
 * cima. Quem lê vê o arquivo antigo ou o novo inteiro, nunca pela metade. Falhou → o temporário
 * some e o erro sobe.
 */
export async function atomicWriteFile(
  path: string,
  data: string | Uint8Array,
  options: AtomicWriteOptions
): Promise<void> {
  const dir = dirname(path)
  await mkdir(dir, {
    recursive: true,
    ...(options.dirMode !== undefined ? { mode: options.dirMode } : {})
  })
  const tmp = join(dir, `.${basename(path)}.${randomBytes(6).toString('hex')}.tmp`)
  try {
    const handle = await open(tmp, 'w', options.mode)
    try {
      await handle.writeFile(data)
      if (options.fsync) await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(tmp, path)
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => undefined)
    throw error
  }
}
