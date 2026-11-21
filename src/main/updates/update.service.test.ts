import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import type { BusyItem, UpdateStatus } from '../../shared/updates'
import { describeBusy } from './busy'
import { parseCodesign, isMacAppSigned } from './mac-signature'
import {
  CHECK_INTERVAL_MS,
  FIRST_CHECK_DELAY_MS,
  IDLE_POLL_MS,
  UpdateService,
  type UpdateSettings,
  type UpdaterLike
} from './update.service'

class FakeUpdater extends EventEmitter implements UpdaterLike {
  autoDownload = true
  autoInstallOnAppQuit = true
  allowPrerelease = false
  allowDowngrade = true
  forceDevUpdateConfig = false
  logger: unknown = console
  /** O que a próxima checagem faz. */
  next: 'none' | { version: string; files?: string[]; download?: boolean } | Error = 'none'
  checks: { allowPrerelease: boolean; autoDownload: boolean }[] = []
  installs: [boolean | undefined, boolean | undefined][] = []

  async checkForUpdates(): Promise<unknown> {
    this.checks.push({ allowPrerelease: this.allowPrerelease, autoDownload: this.autoDownload })
    this.emit('checking-for-update')
    const next = this.next
    if (next instanceof Error) {
      this.emit('error', next)
      throw next
    }
    if (next === 'none') {
      this.emit('update-not-available', { version: '1.0.0' })
      return null
    }
    const info = {
      version: next.version,
      files: (next.files ?? [`Orkio-${next.version}-win-x64-setup.exe`]).map((url) => ({ url }))
    }
    this.emit('update-available', info)
    if (this.autoDownload && next.download !== false) {
      this.emit('download-progress', { percent: 42.4 })
      this.emit('update-downloaded', info)
    }
    return { updateInfo: info }
  }
  async downloadUpdate(): Promise<unknown> {
    return []
  }
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void {
    this.installs.push([isSilent, isForceRunAfter])
  }
}

function setup(
  options: {
    platform?: NodeJS.Platform
    packaged?: boolean
    macSigned?: boolean
    settings?: Partial<UpdateSettings>
    writable?: boolean
    version?: string
    arch?: string
  } = {}
) {
  const updater = new FakeUpdater()
  const timers: { fn: () => void; at: number; cancelled: boolean }[] = []
  let clock = Date.parse('2026-11-21T12:00:00Z')
  let settings: UpdateSettings = {
    channel: 'stable',
    lastSeenVersion: '1.0.0',
    lastCheckAt: null,
    ...options.settings
  }
  let busy: BusyItem[] = []
  const statuses: UpdateStatus[] = []
  const opened: string[] = []
  const shutdown = vi.fn(async () => undefined)
  const service = new UpdateService({
    updater,
    currentVersion: options.version ?? '1.0.0',
    isPackaged: () => options.packaged ?? true,
    platform: options.platform ?? 'win32',
    arch: options.arch ?? 'x64',
    macSigned: async () => options.macSigned ?? false,
    settings: {
      get: () => settings,
      save: async (patch) => {
        if (options.writable === false) throw new Error('só leitura')
        settings = { ...settings, ...patch }
      },
      writable: () => options.writable !== false
    },
    busyCount: () => busy.length,
    busyItems: async () => busy,
    shutdownWork: shutdown,
    openExternal: async (url) => {
      opened.push(url)
    },
    releaseNotes: () => ({ version: options.version ?? '1.0.0', notes: '### Novo\n- Coisa' }),
    emit: (s) => statuses.push(s),
    now: () => new Date(clock),
    random: () => 0.5,
    schedule: (fn, ms) => {
      const t = { fn, at: clock + ms, cancelled: false }
      timers.push(t)
      return { cancel: () => (t.cancelled = true) }
    }
  })
  /** Avança o relógio rodando os timers vencidos (em ordem). */
  async function advance(ms: number): Promise<void> {
    const end = clock + ms
    for (;;) {
      const due = timers.filter((t) => !t.cancelled && t.at <= end).sort((a, b) => a.at - b.at)[0]
      if (!due) break
      due.cancelled = true
      clock = due.at
      due.fn()
      for (let i = 0; i < 10; i++) await Promise.resolve()
      await new Promise((r) => setImmediate(r))
    }
    clock = end
  }
  return {
    updater,
    service,
    statuses,
    opened,
    shutdown,
    advance,
    get settings() {
      return settings
    },
    setBusy: (items: BusyItem[]) => {
      busy = items
    }
  }
}

describe('UpdateService', () => {
  it('desliga o logger padrão (ele imprimiria URLs) e não faz downgrade', () => {
    const { updater } = setup()
    expect(updater.logger).toBeNull()
    expect(updater.allowDowngrade).toBe(false)
  })

  it('fora do app empacotado (ou no Linux) fica desligado e não consulta nada', async () => {
    const dev = setup({ packaged: false })
    expect((await dev.service.check()).mode).toBe('disabled')
    expect(dev.updater.checks).toHaveLength(0)
    const linux = setup({ platform: 'linux' })
    expect((await linux.service.check()).mode).toBe('disabled')
    expect(linux.updater.checks).toHaveLength(0)
  })

  it('forceDevUpdateConfig liga mesmo sem empacotar', async () => {
    const t = setup({ packaged: false, platform: 'linux' })
    t.updater.forceDevUpdateConfig = true
    expect((await t.service.check()).mode).toBe('auto')
  })

  it('checa 10 s depois de abrir e depois a cada ~4 h', async () => {
    const t = setup()
    t.service.start()
    await t.advance(FIRST_CHECK_DELAY_MS - 1)
    expect(t.updater.checks).toHaveLength(0)
    await t.advance(1)
    expect(t.updater.checks).toHaveLength(1)
    await t.advance(CHECK_INTERVAL_MS - 1)
    expect(t.updater.checks).toHaveLength(1)
    await t.advance(1)
    expect(t.updater.checks).toHaveLength(2)
    expect(t.settings.lastCheckAt).not.toBeNull()
  })

  it('sem novidade: idle com a data da última verificação', async () => {
    const t = setup()
    const s = await t.service.check()
    expect(s).toMatchObject({ mode: 'auto', phase: 'idle', version: null, error: null })
    expect(s.lastCheckAt).toBe('2026-11-21T12:00:00.000Z')
  })

  it('disponível → baixando → baixado (Windows)', async () => {
    const t = setup()
    t.updater.next = { version: '1.1.0' }
    const s = await t.service.check()
    expect(t.updater.checks[0]).toEqual({ allowPrerelease: false, autoDownload: true })
    expect(t.updater.autoInstallOnAppQuit).toBe(true)
    expect(t.statuses.map((x) => x.phase)).toEqual(
      expect.arrayContaining(['checking', 'downloading', 'downloaded'])
    )
    expect(t.statuses.find((x) => x.phase === 'downloading' && x.progress === 42)).toBeTruthy()
    expect(s).toMatchObject({ phase: 'downloaded', version: '1.1.0', progress: null })
  })

  it('erro de rede é silencioso: status com mensagem amigável, sem exceção nem URL', async () => {
    const t = setup()
    t.updater.next = Object.assign(
      new Error('net::ERR_INTERNET_DISCONNECTED https://github.com/x?token=abc'),
      { code: 'ERR_INTERNET_DISCONNECTED' }
    )
    const s = await t.service.check()
    expect(s.phase).toBe('error')
    expect(s.error).toBe('Sem conexão com o GitHub. O Orkio tenta de novo mais tarde.')
    expect(JSON.stringify(t.statuses)).not.toContain('https://')
    expect(s.lastCheckAt).not.toBeNull()
  })

  it('erro numa checagem depois do download mantém a atualização pronta', async () => {
    const t = setup()
    t.updater.next = { version: '1.1.0' }
    await t.service.check()
    t.updater.next = new Error('HttpError: 404')
    const s = await t.service.check()
    expect(s.phase).toBe('downloaded')
    expect(s.error).toBe('Ainda não há versão publicada para este canal.')
  })

  it('macOS sem assinatura: não baixa e abre o DMG da arquitetura', async () => {
    const t = setup({ platform: 'darwin', macSigned: false, arch: 'arm64' })
    t.updater.next = {
      version: '1.1.0',
      files: [
        'Orkio-1.1.0-mac-x64.zip',
        'Orkio-1.1.0-mac-arm64.zip',
        'Orkio-1.1.0-mac-x64.dmg',
        'Orkio-1.1.0-mac-arm64.dmg'
      ]
    }
    const s = await t.service.check()
    expect(t.updater.checks[0]?.autoDownload).toBe(false)
    expect(t.updater.autoInstallOnAppQuit).toBe(false)
    expect(s).toMatchObject({ mode: 'manual', phase: 'available', version: '1.1.0' })
    expect(await t.service.openDownload()).toBe(true)
    expect(t.opened).toEqual([
      'https://github.com/uBrunoow/orkio/releases/download/v1.1.0/Orkio-1.1.0-mac-arm64.dmg'
    ])
    expect((await t.service.install('now')).state).toBe('unavailable')
    expect(t.updater.installs).toHaveLength(0)
  })

  it('macOS assinado: baixa e instala como no Windows', async () => {
    const t = setup({ platform: 'darwin', macSigned: true })
    t.updater.next = { version: '1.1.0' }
    expect(await t.service.check()).toMatchObject({ mode: 'auto', phase: 'downloaded' })
  })

  it('Reiniciar e atualizar com tudo ocioso instala na hora (desligando com segurança)', async () => {
    const t = setup()
    t.updater.next = { version: '1.1.0' }
    await t.service.check()
    expect(await t.service.install('if_idle')).toEqual({ state: 'installing' })
    expect(t.shutdown).toHaveBeenCalledOnce()
    expect(t.updater.installs).toEqual([[false, true]])
  })

  it('com execução rodando: não reinicia; mostra o que está rodando', async () => {
    const t = setup()
    t.updater.next = { version: '1.1.0' }
    await t.service.check()
    t.setBusy([{ kind: 'claude', label: 'Claude Code rodando em ORK-1' }])
    expect(await t.service.install('if_idle')).toEqual({
      state: 'busy',
      busy: [{ kind: 'claude', label: 'Claude Code rodando em ORK-1' }]
    })
    expect(t.updater.installs).toHaveLength(0)
    expect(t.shutdown).not.toHaveBeenCalled()
  })

  it('Atualizar quando terminar: espera ficar ocioso (5 s seguidos) e instala', async () => {
    const t = setup()
    t.updater.next = { version: '1.1.0' }
    await t.service.check()
    t.setBusy([{ kind: 'flow', label: 'Fluxo em ORK-2' }])
    expect((await t.service.install('when_idle')).state).toBe('waiting')
    expect(t.service.getStatus()).toMatchObject({ installWhenIdle: true })
    await t.advance(IDLE_POLL_MS * 10)
    expect(t.updater.installs).toHaveLength(0)
    // Fluxo entre passos: ocioso por um instante não basta.
    t.setBusy([])
    await t.advance(IDLE_POLL_MS)
    t.setBusy([{ kind: 'flow', label: 'Fluxo em ORK-2' }])
    await t.advance(IDLE_POLL_MS)
    expect(t.updater.installs).toHaveLength(0)
    t.setBusy([])
    await t.advance(IDLE_POLL_MS * 4)
    expect(t.updater.installs).toHaveLength(1)
    expect(t.shutdown).toHaveBeenCalledOnce()
  })

  it('desistir da espera não instala depois', async () => {
    const t = setup()
    t.updater.next = { version: '1.1.0' }
    await t.service.check()
    t.setBusy([{ kind: 'notion', label: '1 alteração esperando o Notion' }])
    await t.service.install('when_idle')
    expect(await t.service.install('cancel_wait')).toEqual({ state: 'cancelled' })
    t.setBusy([])
    await t.advance(IDLE_POLL_MS * 10)
    expect(t.updater.installs).toHaveLength(0)
    expect(t.service.getStatus().installWhenIdle).toBe(false)
  })

  it('Atualizar agora mesmo assim: desliga o trabalho antes de instalar', async () => {
    const t = setup()
    t.updater.next = { version: '1.1.0' }
    await t.service.check()
    t.setBusy([{ kind: 'claude', label: 'Claude Code rodando em ORK-1' }])
    const order: string[] = []
    t.shutdown.mockImplementation(async () => {
      order.push('shutdown')
    })
    const original = t.updater.quitAndInstall.bind(t.updater)
    t.updater.quitAndInstall = (a, b) => {
      order.push('install')
      original(a, b)
    }
    expect(await t.service.install('now')).toEqual({ state: 'installing' })
    expect(order).toEqual(['shutdown', 'install'])
  })

  it('sem atualização baixada não instala', async () => {
    const t = setup()
    await t.service.check()
    expect((await t.service.install('now')).state).toBe('unavailable')
    expect(t.updater.installs).toHaveLength(0)
  })

  it('canal Beta liga allowPrerelease e checa de novo; Estável desliga', async () => {
    const t = setup()
    await t.service.setChannel('beta')
    await new Promise((r) => setImmediate(r))
    expect(t.settings.channel).toBe('beta')
    expect(t.updater.checks.at(-1)?.allowPrerelease).toBe(true)
    await t.service.setChannel('stable')
    await new Promise((r) => setImmediate(r))
    expect(t.updater.checks.at(-1)?.allowPrerelease).toBe(false)
    expect(t.updater.allowDowngrade).toBe(false)
  })

  it('numa beta com canal Estável, avisa que fica na beta até sair uma estável mais nova', () => {
    const t = setup({ version: '1.1.0-beta.2' })
    expect(t.service.getStatus().channelNote).toMatch(/versão beta/)
  })

  it('O que há de novo: uma vez depois de atualizar; instalação nova só registra', async () => {
    const updated = setup({ version: '1.1.0', settings: { lastSeenVersion: '1.0.0' } })
    expect(updated.service.whatsNew()).toEqual({ version: '1.1.0', notes: '### Novo\n- Coisa' })
    await new Promise((r) => setImmediate(r))
    // Uma vez: na próxima abertura não aparece mais, mesmo sem clicar em "Entendi".
    expect(updated.settings.lastSeenVersion).toBe('1.1.0')
    // Mesma sessão (a tela remontou): continua mostrando até "Entendi".
    expect(updated.service.whatsNew()?.version).toBe('1.1.0')
    await updated.service.markWhatsNewSeen()
    expect(updated.service.whatsNew()).toBeNull()

    const fresh = setup({ version: '1.1.0', settings: { lastSeenVersion: null } })
    expect(fresh.service.whatsNew()).toBeNull()
    await new Promise((r) => setImmediate(r))
    expect(fresh.settings.lastSeenVersion).toBe('1.1.0')

    // Config só leitura (dados de uma versão mais nova): não mostra (não teria como lembrar).
    const readOnly = setup({ version: '1.1.0', writable: false })
    expect(readOnly.service.whatsNew()).toBeNull()
  })

  it('config só leitura não impede procurar nem instalar (é assim que se sai do downgrade)', async () => {
    const t = setup({ writable: false })
    t.updater.next = { version: '1.1.0' }
    expect((await t.service.check()).phase).toBe('downloaded')
    expect((await t.service.install('if_idle')).state).toBe('installing')
  })
})

describe('assinatura no macOS', () => {
  it('Developer ID → assinado; ad-hoc, sem TeamIdentifier ou erro → não', () => {
    expect(
      parseCodesign(0, 'Authority=Developer ID Application: X\nTeamIdentifier=ABCDE12345\n')
    ).toBe(true)
    expect(parseCodesign(0, 'Signature=adhoc\nTeamIdentifier=not set\n')).toBe(false)
    expect(parseCodesign(0, 'TeamIdentifier=not set\n')).toBe(false)
    expect(parseCodesign(1, 'code object is not signed at all')).toBe(false)
  })

  it('codesign do bundle (não do executável); sem codesign usa a flag do build', async () => {
    const calls: string[][] = []
    const signed = await isMacAppSigned(
      async (cmd, args) => {
        calls.push([cmd, ...args])
        return { code: 0, stderr: 'TeamIdentifier=ABCDE12345' }
      },
      '/Applications/Orkio.app/Contents/MacOS/Orkio',
      false
    )
    expect(signed).toBe(true)
    expect(calls).toEqual([['codesign', '-dv', '--verbose=2', '/Applications/Orkio.app']])
    const missing = async (): Promise<never> => {
      throw Object.assign(new Error('x'), { code: 'ENOENT' })
    }
    expect(await isMacAppSigned(missing, '/A.app/Contents/MacOS/A', true)).toBe(true)
  })
})

describe('describeBusy', () => {
  it('lista fluxos, execuções fora de fluxo e escritas pendentes', async () => {
    const items = await describeBusy({
      flows: [{ projectId: 'p', taskId: 't1', flowName: 'Alva: implementar', step: '/review' }],
      runs: [
        { projectId: 'p', taskId: 't1', queued: false },
        { projectId: 'p', taskId: 't2', queued: false },
        { projectId: 'p', taskId: 't3', queued: true }
      ],
      pendingWrites: 2,
      taskLabel: async (_p, t) => (t === 't3' ? null : `ORK-${t.slice(1)}`)
    })
    expect(items).toEqual([
      { kind: 'flow', label: 'Fluxo “Alva: implementar” em ORK-1, passo “/review”' },
      { kind: 'claude', label: 'Claude Code rodando em ORK-2' },
      { kind: 'claude', label: 'Claude Code na fila em uma tarefa' },
      { kind: 'notion', label: '2 alterações esperando o Notion (continuam depois de reiniciar)' }
    ])
  })
})
