import { watch as fsWatch, type FSWatcher } from 'node:fs'
import { readFile as fsReadFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Observa a branch atual de um repositório lendo <gitDir>/HEAD.
 *
 * - Observamos o DIRETÓRIO do git (não o arquivo): o git grava HEAD.lock e renomeia para HEAD,
 *   o que quebra watchers de arquivo em várias plataformas.
 * - `gitDir` vem de `git rev-parse --absolute-git-dir`, então worktrees (onde `.git` é um arquivo
 *   "gitdir: ...") já chegam com o diretório certo (.git/worktrees/<nome>).
 * - Debounce para juntar a rajada de eventos de um checkout; só avisa se a branch mudou.
 * - Se o fs.watch falhar (ex.: sistema de arquivos de rede), cai para polling.
 */

export const HEAD_DEBOUNCE_MS = 300
export const HEAD_POLL_FALLBACK_MS = 2_000

export interface HeadWatcherDeps {
  watch?: (dir: string, listener: (event: string, filename: string | null) => void) => FSWatcher
  readFile?: (path: string) => Promise<string>
}

export interface HeadWatcherOptions {
  gitDir: string
  /** Chamado quando a branch muda (`null` = detached HEAD). */
  onBranchChange(branch: string | null): void
  /** HEAD sumiu/ilegível (pasta apagada ou movida). */
  onError?(): void
  debounceMs?: number
  pollMs?: number
}

/** "ref: refs/heads/feature/x" → "feature/x"; hash (detached) → null. */
export function parseHeadContent(content: string): string | null {
  const match = /^ref:\s*refs\/heads\/(.+)$/m.exec(content.trim())
  return match ? match[1]!.trim() : null
}

export class HeadWatcher {
  private watcher: FSWatcher | null = null
  private poller: NodeJS.Timeout | null = null
  private debounce: NodeJS.Timeout | null = null
  private last: string | null | undefined = undefined
  private stopped = false
  private readonly watchImpl: NonNullable<HeadWatcherDeps['watch']>
  private readonly readFileImpl: NonNullable<HeadWatcherDeps['readFile']>

  constructor(
    private readonly options: HeadWatcherOptions,
    deps: HeadWatcherDeps = {}
  ) {
    this.watchImpl =
      deps.watch ?? ((dir, listener) => fsWatch(dir, { persistent: false }, listener))
    this.readFileImpl = deps.readFile ?? ((path) => fsReadFile(path, 'utf8'))
  }

  /** Lê a branch inicial (sem avisar) e começa a observar. */
  async start(): Promise<string | null> {
    const initial = await this.readBranch()
    this.last = initial ?? null
    if (this.stopped) return this.last
    try {
      this.watcher = this.watchImpl(this.options.gitDir, (_event, filename) => {
        // Alguns sistemas não informam o nome do arquivo: checamos mesmo assim.
        if (filename === null || filename === 'HEAD' || filename === 'HEAD.lock') this.schedule()
      })
      this.watcher.on('error', () => this.fallbackToPolling())
    } catch {
      this.fallbackToPolling()
    }
    return this.last
  }

  stop(): void {
    this.stopped = true
    this.watcher?.close()
    this.watcher = null
    if (this.poller) clearInterval(this.poller)
    if (this.debounce) clearTimeout(this.debounce)
    this.poller = null
    this.debounce = null
  }

  private schedule(): void {
    if (this.stopped) return
    if (this.debounce) clearTimeout(this.debounce)
    this.debounce = setTimeout(() => {
      this.debounce = null
      void this.check()
    }, this.options.debounceMs ?? HEAD_DEBOUNCE_MS)
  }

  private async check(): Promise<void> {
    const branch = await this.readBranch()
    if (this.stopped || branch === undefined) return
    if (branch !== this.last) {
      this.last = branch
      this.options.onBranchChange(branch)
    }
  }

  /** `undefined` = não deu para ler (HEAD sumiu). */
  private async readBranch(): Promise<string | null | undefined> {
    try {
      return parseHeadContent(await this.readFileImpl(join(this.options.gitDir, 'HEAD')))
    } catch {
      if (!this.stopped) this.options.onError?.()
      return undefined
    }
  }

  private fallbackToPolling(): void {
    if (this.stopped || this.poller) return
    this.watcher?.close()
    this.watcher = null
    this.poller = setInterval(() => void this.check(), this.options.pollMs ?? HEAD_POLL_FALLBACK_MS)
  }
}
