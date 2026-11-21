/**
 * Atualizações automáticas (Etapa 6C) com electron-updater, lendo o repo público de releases.
 *
 * - Só no app empacotado (macOS/Windows). Checa 10 s depois de abrir e a cada ~4 h, e no botão.
 * - Windows e macOS assinado: baixa em segundo plano; instala ao sair ou em "Reiniciar e atualizar".
 * - macOS sem assinatura: não baixa (o Squirrel.Mac recusaria); avisa e abre o DMG certo.
 * - Nunca reinicia por cima de execução do Claude, fluxo rodando ou escrita pendente no Notion sem
 *   a pessoa escolher: "Atualizar quando terminar" (espera ficar ocioso) ou "agora mesmo assim"
 *   (o mesmo desligamento seguro do fechamento normal).
 * - Falhas do feed são silenciosas: só o status (com erro amigável) em Configurações. O logger do
 *   electron-updater fica desligado (ele imprimiria URLs); nada de exceção crua.
 *
 * O autoUpdater é injetado (`UpdaterLike`) para testar sem rede.
 */
import {
  compareVersions,
  friendlyUpdateError,
  isPrerelease,
  macDownloadUrl,
  type BusyItem,
  type ReleaseNotes,
  type UpdateChannel,
  type UpdateInstallMode,
  type UpdateInstallResult,
  type UpdateMode,
  type UpdatePhase,
  type UpdateStatus
} from '../../shared/updates'

export const FIRST_CHECK_DELAY_MS = 10_000
export const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000
/** Intervalo do teste de "ocioso" enquanto espera para instalar. */
export const IDLE_POLL_MS = 2_000
/** Tempo seguido sem nada rodando antes de instalar (um fluxo entre passos não conta como fim). */
export const IDLE_STABLE_MS = 5_000

/** O pedaço do `autoUpdater` do electron-updater que usamos. */
export interface UpdaterLike {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  allowPrerelease: boolean
  allowDowngrade: boolean
  /** Flag oficial do electron-updater: procura atualizações mesmo sem empacotar. */
  forceDevUpdateConfig: boolean
  logger: unknown
  checkForUpdates(): Promise<unknown>
  downloadUpdate(): Promise<unknown>
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
  on(event: string, listener: (arg: unknown) => void): unknown
}

export interface UpdateSettings {
  channel: UpdateChannel
  lastSeenVersion: string | null
  lastCheckAt: string | null
}

export interface UpdateServiceDeps {
  updater: UpdaterLike
  currentVersion: string
  isPackaged(): boolean
  platform: NodeJS.Platform
  arch: string
  /** macOS: o bundle tem assinatura Developer ID? (só é chamada no macOS, uma vez). */
  macSigned(): Promise<boolean>
  settings: {
    get(): UpdateSettings
    /** Pode falhar (config só leitura): o serviço segue sem gravar. */
    save(patch: Partial<UpdateSettings>): Promise<void>
    writable(): boolean
  }
  /** Contagem síncrona do que está rodando (0 = ocioso). */
  busyCount(): number
  /** O que está rodando, com nomes para mostrar. */
  busyItems(): Promise<BusyItem[]>
  /** Mesmo desligamento do fechamento normal (cancela execuções e espera saírem). */
  shutdownWork(): Promise<void>
  openExternal(url: string): Promise<void>
  /** Notas da versão atual (CHANGELOG embutido no build). */
  releaseNotes(): ReleaseNotes | null
  emit(status: UpdateStatus): void
  now?: () => Date
  random?: () => number
  schedule?: (fn: () => void, ms: number) => { cancel(): void }
}

interface FoundUpdate {
  version: string
  files: string[]
}

export class UpdateService {
  private readonly now: () => Date
  private readonly random: () => number
  private readonly schedule: (fn: () => void, ms: number) => { cancel(): void }
  private phase: UpdatePhase = 'idle'
  private found: FoundUpdate | null = null
  private progress: number | null = null
  private error: string | null = null
  private installWhenIdle = false
  private busy: BusyItem[] = []
  private installing = false
  private checking: Promise<void> | null = null
  private timer: { cancel(): void } | null = null
  private idleTimer: { cancel(): void } | null = null
  private idleSince: number | null = null
  private macSigned: boolean | null = null
  private started = false
  private sessionNotes: ReleaseNotes | null | undefined = undefined

  constructor(private readonly deps: UpdateServiceDeps) {
    this.now = deps.now ?? (() => new Date())
    this.random = deps.random ?? Math.random
    this.schedule =
      deps.schedule ??
      ((fn, ms) => {
        const t = setTimeout(fn, ms)
        return { cancel: () => clearTimeout(t) }
      })
    const u = deps.updater
    // O logger padrão imprime URLs e respostas; não queremos nada disso no log.
    u.logger = null
    u.allowDowngrade = false
    u.autoDownload = false
    u.autoInstallOnAppQuit = false
    this.listen()
  }

  /** Liga o agendamento: primeira checagem em 10 s, depois a cada ~4 h (±10%). */
  start(): void {
    if (this.started) return
    this.started = true
    this.timer = this.schedule(() => void this.tick(), FIRST_CHECK_DELAY_MS)
  }

  stop(): void {
    this.started = false
    this.timer?.cancel()
    this.timer = null
    this.stopIdleWatch()
  }

  getStatus(): UpdateStatus {
    const settings = this.deps.settings.get()
    const mode = this.mode()
    return {
      mode,
      phase: mode === 'disabled' ? 'idle' : this.phase,
      currentVersion: this.deps.currentVersion,
      channel: settings.channel,
      version: this.found?.version ?? null,
      progress: this.progress,
      lastCheckAt: settings.lastCheckAt,
      error: this.error,
      installWhenIdle: this.installWhenIdle,
      busy: this.busy,
      channelNote:
        settings.channel === 'stable' && isPrerelease(this.deps.currentVersion)
          ? 'Você está numa versão beta. Ela continua até sair uma versão estável mais nova.'
          : null
    }
  }

  /** "Procurar atualizações" (e o agendador). Falha vira status, nunca exceção. */
  async check(): Promise<UpdateStatus> {
    await this.resolveMacSignature()
    if (this.mode() === 'disabled' || this.installing) return this.getStatus()
    // Baixando: a checagem em curso já achou a versão; não começa outra.
    if (this.phase === 'downloading') return this.getStatus()
    this.checking ??= this.runCheck().finally(() => {
      this.checking = null
    })
    await this.checking
    return this.getStatus()
  }

  async setChannel(channel: UpdateChannel): Promise<UpdateStatus> {
    if (this.deps.settings.get().channel !== channel) {
      await this.deps.settings.save({ channel }).catch(() => undefined)
      // Uma versão achada no outro canal não vale mais (exceto se já baixou: fica pronta).
      if (this.phase !== 'downloaded' && this.phase !== 'downloading') {
        this.found = null
        this.phase = 'idle'
      }
      this.emit()
      void this.check()
    }
    return this.getStatus()
  }

  /** Abre o DMG certo no navegador (macOS sem assinatura). */
  async openDownload(): Promise<boolean> {
    if (!this.found || this.mode() !== 'manual') return false
    await this.deps.openExternal(
      macDownloadUrl(this.found.version, this.found.files, this.deps.arch)
    )
    return true
  }

  async install(mode: UpdateInstallMode): Promise<UpdateInstallResult> {
    if (mode === 'cancel_wait') {
      this.installWhenIdle = false
      this.stopIdleWatch()
      this.busy = []
      this.emit()
      return { state: 'cancelled' }
    }
    if (this.mode() !== 'auto' || this.phase !== 'downloaded' || this.installing) {
      return { state: 'unavailable', message: 'Nenhuma atualização pronta para instalar.' }
    }
    if (mode === 'now') {
      await this.doInstall()
      return { state: 'installing' }
    }
    if (this.deps.busyCount() === 0) {
      await this.doInstall()
      return { state: 'installing' }
    }
    this.busy = await this.deps.busyItems()
    if (mode === 'if_idle') {
      this.emit()
      return { state: 'busy', busy: this.busy }
    }
    this.installWhenIdle = true
    this.idleSince = null
    this.startIdleWatch()
    this.emit()
    return { state: 'waiting', busy: this.busy }
  }

  /** Notas para mostrar uma vez depois de atualizar (`null` = nada a mostrar). */
  whatsNew(): ReleaseNotes | null {
    // Na mesma sessão devolve a mesma resposta (a tela pode pedir de novo ao remontar).
    if (this.sessionNotes !== undefined) return this.sessionNotes
    this.sessionNotes = this.computeWhatsNew()
    return this.sessionNotes
  }

  private computeWhatsNew(): ReleaseNotes | null {
    if (!this.deps.settings.writable()) return null
    const { lastSeenVersion } = this.deps.settings.get()
    const current = this.deps.currentVersion
    if (lastSeenVersion === null) {
      // Instalação nova: não há "novidade"; só registra a versão.
      void this.deps.settings.save({ lastSeenVersion: current }).catch(() => undefined)
      return null
    }
    if (compareVersions(current, lastSeenVersion) <= 0) return null
    // Mostrado uma vez: já conta como visto (o painel fica até "Entendi" nesta sessão).
    void this.deps.settings.save({ lastSeenVersion: current }).catch(() => undefined)
    return this.deps.releaseNotes() ?? { version: current, notes: '' }
  }

  async markWhatsNewSeen(): Promise<void> {
    this.sessionNotes = null
    await this.deps.settings
      .save({ lastSeenVersion: this.deps.currentVersion })
      .catch(() => undefined)
  }

  releaseNotes(): ReleaseNotes | null {
    return this.deps.releaseNotes()
  }

  // ---------- interno ----------

  private mode(): UpdateMode {
    const u = this.deps.updater
    const enabled =
      u.forceDevUpdateConfig || (this.deps.isPackaged() && this.deps.platform !== 'linux')
    if (!enabled) return 'disabled'
    if (this.deps.platform === 'darwin' && this.macSigned === false) return 'manual'
    return 'auto'
  }

  private async resolveMacSignature(): Promise<void> {
    if (this.deps.platform !== 'darwin' || this.macSigned !== null) return
    try {
      this.macSigned = await this.deps.macSigned()
    } catch {
      this.macSigned = false
    }
  }

  private async tick(): Promise<void> {
    if (!this.started) return
    await this.check().catch(() => undefined)
    if (!this.started) return
    const jitter = 1 + (this.random() * 0.2 - 0.1)
    this.timer = this.schedule(() => void this.tick(), Math.round(CHECK_INTERVAL_MS * jitter))
  }

  private async runCheck(): Promise<void> {
    const u = this.deps.updater
    const mode = this.mode()
    const { channel } = this.deps.settings.get()
    u.autoDownload = mode === 'auto'
    u.autoInstallOnAppQuit = mode === 'auto'
    u.allowPrerelease = channel === 'beta'
    u.allowDowngrade = false
    if (this.phase !== 'downloaded') this.phase = 'checking'
    this.error = null
    this.emit()
    try {
      await u.checkForUpdates()
      if (this.phase === 'checking') this.phase = this.found ? this.phase : 'idle'
    } catch (error) {
      this.fail(error)
    }
    await this.deps.settings.save({ lastCheckAt: this.now().toISOString() }).catch(() => undefined)
    this.emit()
  }

  private listen(): void {
    const u = this.deps.updater
    u.on('update-available', (info: unknown) => {
      const found = toFound(info)
      if (!found) return
      this.found = found
      this.error = null
      if (this.mode() === 'auto') {
        this.phase = 'downloading'
        this.progress = 0
      } else {
        this.phase = 'available'
      }
      this.emit()
    })
    u.on('update-not-available', () => {
      if (this.phase === 'downloaded') return
      this.found = null
      this.phase = 'idle'
      this.progress = null
      this.emit()
    })
    u.on('download-progress', (p: unknown) => {
      const percent =
        typeof p === 'object' &&
        p !== null &&
        typeof (p as { percent?: unknown }).percent === 'number'
          ? (p as { percent: number }).percent
          : null
      if (percent === null || this.phase !== 'downloading') return
      this.progress = Math.max(0, Math.min(100, Math.round(percent)))
      this.emit()
    })
    u.on('update-downloaded', (info: unknown) => {
      const found = toFound(info)
      if (found) this.found = found
      this.phase = 'downloaded'
      this.progress = null
      this.error = null
      this.emit()
    })
    u.on('error', (error: unknown) => this.fail(error))
  }

  private fail(error: unknown): void {
    this.error = friendlyUpdateError(error)
    // Uma atualização já baixada continua pronta; o erro fica só no status.
    if (this.phase !== 'downloaded') {
      this.phase = this.phase === 'available' ? 'available' : 'error'
      this.progress = null
    }
    this.emit()
  }

  private startIdleWatch(): void {
    this.stopIdleWatch()
    this.idleTimer = this.schedule(() => void this.idleTick(), IDLE_POLL_MS)
  }

  private stopIdleWatch(): void {
    this.idleTimer?.cancel()
    this.idleTimer = null
    this.idleSince = null
  }

  private async idleTick(): Promise<void> {
    this.idleTimer = null
    if (!this.installWhenIdle || this.installing) return
    const now = this.now().getTime()
    if (this.deps.busyCount() === 0) {
      this.idleSince ??= now
      if (now - this.idleSince >= IDLE_STABLE_MS) {
        await this.doInstall()
        return
      }
      if (this.busy.length > 0) {
        this.busy = []
        this.emit()
      }
    } else {
      this.idleSince = null
      const busy = await this.deps.busyItems()
      if (JSON.stringify(busy) !== JSON.stringify(this.busy)) {
        this.busy = busy
        this.emit()
      }
    }
    if (this.installWhenIdle)
      this.idleTimer = this.schedule(() => void this.idleTick(), IDLE_POLL_MS)
  }

  private async doInstall(): Promise<void> {
    if (this.installing) return
    this.installing = true
    this.stopIdleWatch()
    this.emit()
    try {
      await this.deps.shutdownWork()
    } catch {
      // Segue: o fechamento normal também não espera para sempre.
    }
    // isSilent=false (instalador NSIS normal), isForceRunAfter=true (abre de novo depois).
    this.deps.updater.quitAndInstall(false, true)
  }

  private emit(): void {
    this.deps.emit(this.getStatus())
  }
}

function toFound(info: unknown): FoundUpdate | null {
  if (typeof info !== 'object' || info === null) return null
  const { version, files } = info as { version?: unknown; files?: unknown }
  if (typeof version !== 'string' || !version) return null
  const names = Array.isArray(files)
    ? files
        .map((f) =>
          typeof f === 'object' && f !== null && typeof (f as { url?: unknown }).url === 'string'
            ? (f as { url: string }).url
            : null
        )
        .filter((f): f is string => f !== null)
    : []
  return { version, files: names }
}
