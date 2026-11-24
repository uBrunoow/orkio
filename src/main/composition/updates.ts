import { app, dialog, shell } from 'electron'
import { autoUpdater } from 'electron-updater'
import changelog from '../../../CHANGELOG.md?raw'
import { changelogSection } from '../../shared/updates'
import type { OrkioConfig } from '../config/orkio-config'
import type { Emit } from '../ipc/emit'
import { isAllowedExternalUrl } from '../ipc/shell.ipc'
import { withDialogWindow } from '../platform/dialog'
import { execExitCode } from '../platform/process'
import type { ConfigStore } from '../storage/config-store'
import { busyCount, describeBusy } from '../updates/busy'
import { isMacAppSigned } from '../updates/mac-signature'
import { UpdateService, type UpdaterLike } from '../updates/update.service'

export function createUpdates(deps: {
  configStore: ConfigStore<OrkioConfig>
  configReady: Promise<void>
  emit: Emit
  /** Trabalho em andamento (execuções, fluxos, escritas no Notion): nunca reinicia por cima. */
  busy: () => Omit<Parameters<typeof describeBusy>[0], 'taskLabel'>
  taskLabel: (projectId: string, taskId: string) => Promise<string | null>
  /** O desligamento único do app (`stop`), esperando as execuções saírem. */
  shutdownWork: () => Promise<void>
}): UpdateService {
  const version = app.getVersion()
  return new UpdateService({
    // O tipo do electron-updater é um emissor tipado; usamos só o pedaço descrito em UpdaterLike.
    updater: autoUpdater as unknown as UpdaterLike,
    currentVersion: version,
    isPackaged: () => app.isPackaged,
    platform: process.platform,
    arch: process.arch,
    isAppImage: process.platform === 'linux' && !!process.env['APPIMAGE'],
    macSigned: () =>
      isMacAppSigned(
        (command, args) =>
          execExitCode(command, args, { timeoutMs: 10_000 }).then((r) => ({
            code: r.code,
            stderr: r.stderr
          })),
        app.getPath('exe'),
        import.meta.env.MAIN_VITE_MAC_SIGNED === '1'
      ),
    settings: {
      get: () => deps.configStore.get().updates,
      save: async (patch) => {
        await deps.configReady
        await deps.configStore.update((c) => ({ ...c, updates: { ...c.updates, ...patch } }))
      },
      writable: () => !deps.configStore.readOnly
    },
    busyCount: () => busyCount(deps.busy()),
    busyItems: () => describeBusy({ ...deps.busy(), taskLabel: deps.taskLabel }),
    shutdownWork: deps.shutdownWork,
    openExternal: async (url) => {
      // Mesma allowlist do renderer: só o repo público de releases.
      if (isAllowedExternalUrl(url)) await shell.openExternal(url)
    },
    releaseNotes: () => {
      const notes = changelogSection(changelog, version)
      return notes === null ? null : { version, notes }
    },
    emit: (status) => deps.emit('updateStatus', status),
    askRestart: async (next) => {
      const { response } = await withDialogWindow(dialog.showMessageBox, {
        type: 'info',
        title: 'Atualização pronta',
        message: `O Orkio ${next} foi baixado.`,
        detail: 'Reiniciar agora para atualizar? O Orkio fecha e abre de novo na versão nova.',
        buttons: ['Reiniciar agora', 'Depois'],
        defaultId: 0,
        cancelId: 1,
        noLink: true
      })
      return response === 0
    }
  })
}
