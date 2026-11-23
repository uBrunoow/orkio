import type { IpcMain } from 'electron'
import { IPC_CHANNELS, type AboutInfo } from '../../shared/ipc-contract'
import type {
  ReleaseNotes,
  UpdateChannel,
  UpdateInstallMode,
  UpdateInstallResult,
  UpdateStatus
} from '../../shared/updates'
import { errorName } from './payload'
import type { SenderGuard } from './trusted-sender'

export interface UpdatesIpcService {
  getStatus(): UpdateStatus
  check(): Promise<UpdateStatus>
  setChannel(channel: UpdateChannel): Promise<UpdateStatus>
  install(mode: UpdateInstallMode): Promise<UpdateInstallResult>
  openDownload(): Promise<boolean>
  whatsNew(): ReleaseNotes | null
  markWhatsNewSeen(): Promise<void>
  releaseNotes(): ReleaseNotes | null
}

const INSTALL_MODES: readonly UpdateInstallMode[] = ['if_idle', 'now', 'when_idle', 'cancel_wait']

/** Atualizações (6C): o renderer manda só o canal ou o modo de instalação (validados aqui). */
export function registerUpdatesIpc(
  ipc: Pick<IpcMain, 'handle'>,
  service: UpdatesIpcService,
  about: () => AboutInfo,
  isTrustedSender: SenderGuard,
  /** Diagnóstico (Sobre > "Copiar diagnóstico"): texto sem segredos. */
  diagnostics: () => Promise<string> = async () => ''
): void {
  const ch = IPC_CHANNELS.updates
  function guarded<T>(
    channel: string,
    fallback: () => T,
    run: (...args: unknown[]) => Promise<T> | T
  ): void {
    ipc.handle(channel, async (event, ...args: unknown[]) => {
      if (!isTrustedSender(event)) throw new Error('Origem de IPC não autorizada')
      try {
        return await run(...args)
      } catch (error) {
        console.error(`[orkio] falha inesperada em ${channel}: ${errorName(error)}`)
        return fallback()
      }
    })
  }
  const status = (): UpdateStatus => service.getStatus()
  guarded(ch.status, status, status)
  guarded(ch.check, status, () => service.check())
  guarded(ch.setChannel, status, (channel) =>
    channel === 'stable' || channel === 'beta' ? service.setChannel(channel) : status()
  )
  guarded<UpdateInstallResult>(
    ch.install,
    () => ({ state: 'unavailable', message: 'Não foi possível instalar a atualização agora.' }),
    (mode) =>
      INSTALL_MODES.includes(mode as UpdateInstallMode)
        ? service.install(mode as UpdateInstallMode)
        : { state: 'unavailable', message: 'Pedido inválido.' }
  )
  guarded(
    ch.openDownload,
    () => false,
    () => service.openDownload()
  )
  guarded(
    ch.whatsNew,
    () => null,
    () => service.whatsNew()
  )
  guarded(
    ch.markWhatsNewSeen,
    () => undefined,
    () => service.markWhatsNewSeen()
  )
  guarded(
    ch.releaseNotes,
    () => null,
    () => service.releaseNotes()
  )
  guarded(ch.about, about, about)
  guarded(
    ch.diagnostics,
    () => 'Não foi possível montar o diagnóstico agora.',
    () => diagnostics()
  )
}
