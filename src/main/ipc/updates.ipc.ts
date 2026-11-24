import type { ORKIO_API } from '../../shared/ipc/api'
import type {
  AboutInfo,
  ReleaseNotes,
  UpdateChannel,
  UpdateInstallMode,
  UpdateInstallResult,
  UpdateStatus
} from '../../shared/updates'
import type { Impl } from './register'

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

/** Atualizações (6C): o renderer manda só o canal ou o modo de instalação. */
export function updatesHandlers(
  service: UpdatesIpcService,
  about: () => AboutInfo,
  /** Diagnóstico (Sobre > "Copiar diagnóstico"): texto sem segredos. */
  diagnostics: () => Promise<string>
): Impl<typeof ORKIO_API.updates> {
  return {
    status: () => service.getStatus(),
    check: () => service.check(),
    setChannel: (channel) => service.setChannel(channel),
    install: (mode) => service.install(mode),
    openDownload: () => service.openDownload(),
    whatsNew: () => service.whatsNew(),
    markWhatsNewSeen: () => service.markWhatsNewSeen(),
    releaseNotes: () => service.releaseNotes(),
    about: () => about(),
    diagnostics: () => diagnostics()
  }
}
