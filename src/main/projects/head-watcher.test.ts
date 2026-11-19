import { execFileSync } from 'node:child_process'
import { EventEmitter } from 'node:events'
import type { FSWatcher } from 'node:fs'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HeadWatcher, parseHeadContent } from './head-watcher'

describe('parseHeadContent', () => {
  it('branch, branch com barra, detached', () => {
    expect(parseHeadContent('ref: refs/heads/main\n')).toBe('main')
    expect(parseHeadContent('ref: refs/heads/ORK-142/sync-notion\n')).toBe('ORK-142/sync-notion')
    expect(parseHeadContent('3f786850e387550fdab836ed7e6dc881de23001b\n')).toBeNull()
  })
})

/** fs.watch falso: o teste dispara eventos à mão. */
function fakeFs(initial: string) {
  let head = initial
  let missing = false
  const emitter = new EventEmitter() as EventEmitter & { close: () => void }
  emitter.close = vi.fn()
  let listener: ((event: string, filename: string | null) => void) | null = null
  return {
    deps: {
      watch: vi.fn((_dir: string, l: (event: string, filename: string | null) => void) => {
        listener = l
        return emitter as unknown as FSWatcher
      }),
      readFile: vi.fn(async (path: string) => {
        expect(path).toBe(join('/repo/.git', 'HEAD'))
        if (missing) throw Object.assign(new Error('nope'), { code: 'ENOENT' })
        return head
      })
    },
    setHead(value: string) {
      head = value
    },
    remove() {
      missing = true
    },
    fire(filename: string | null = 'HEAD') {
      listener?.('change', filename)
    },
    emitter
  }
}

describe('HeadWatcher (fs simulado)', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('lê a branch inicial e avisa só quando ela muda (com debounce)', async () => {
    vi.useFakeTimers()
    const fs = fakeFs('ref: refs/heads/main\n')
    const onBranchChange = vi.fn()
    const watcher = new HeadWatcher({ gitDir: '/repo/.git', onBranchChange }, fs.deps)

    expect(await watcher.start()).toBe('main')
    expect(fs.deps.watch).toHaveBeenCalledWith('/repo/.git', expect.any(Function))

    // Rajada de eventos de um checkout → uma leitura só.
    fs.setHead('ref: refs/heads/ORK-1/feature\n')
    fs.fire('HEAD.lock')
    fs.fire('HEAD')
    fs.fire('index')
    fs.fire('HEAD')
    await vi.advanceTimersByTimeAsync(299)
    expect(onBranchChange).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(onBranchChange).toHaveBeenCalledExactlyOnceWith('ORK-1/feature')

    // Evento sem mudança real de branch → não avisa.
    fs.fire('HEAD')
    await vi.advanceTimersByTimeAsync(300)
    expect(onBranchChange).toHaveBeenCalledTimes(1)

    // Detached HEAD → null.
    fs.setHead('3f786850e387550fdab836ed7e6dc881de23001b\n')
    fs.fire(null)
    await vi.advanceTimersByTimeAsync(300)
    expect(onBranchChange).toHaveBeenLastCalledWith(null)
    watcher.stop()
  })

  it('arquivos que não são HEAD não disparam leitura', async () => {
    vi.useFakeTimers()
    const fs = fakeFs('ref: refs/heads/main\n')
    const watcher = new HeadWatcher({ gitDir: '/repo/.git', onBranchChange: vi.fn() }, fs.deps)
    await watcher.start()
    fs.deps.readFile.mockClear()
    fs.fire('ORIG_HEAD')
    fs.fire('index')
    await vi.advanceTimersByTimeAsync(1000)
    expect(fs.deps.readFile).not.toHaveBeenCalled()
    watcher.stop()
  })

  it('HEAD sumiu (pasta apagada) → onError, sem onBranchChange', async () => {
    vi.useFakeTimers()
    const fs = fakeFs('ref: refs/heads/main\n')
    const onBranchChange = vi.fn()
    const onError = vi.fn()
    const watcher = new HeadWatcher({ gitDir: '/repo/.git', onBranchChange, onError }, fs.deps)
    await watcher.start()
    fs.remove()
    fs.fire('HEAD')
    await vi.advanceTimersByTimeAsync(300)
    expect(onError).toHaveBeenCalled()
    expect(onBranchChange).not.toHaveBeenCalled()
    watcher.stop()
  })

  it('erro no fs.watch → passa a fazer polling', async () => {
    vi.useFakeTimers()
    const fs = fakeFs('ref: refs/heads/main\n')
    const onBranchChange = vi.fn()
    const watcher = new HeadWatcher({ gitDir: '/repo/.git', onBranchChange, pollMs: 1000 }, fs.deps)
    await watcher.start()
    fs.emitter.emit('error', new Error('EMFILE'))
    expect(fs.emitter.close).toHaveBeenCalled()

    fs.setHead('ref: refs/heads/dev\n')
    await vi.advanceTimersByTimeAsync(1000)
    expect(onBranchChange).toHaveBeenCalledWith('dev')
    watcher.stop()
  })

  it('stop() fecha o watcher e ignora eventos pendentes', async () => {
    vi.useFakeTimers()
    const fs = fakeFs('ref: refs/heads/main\n')
    const onBranchChange = vi.fn()
    const watcher = new HeadWatcher({ gitDir: '/repo/.git', onBranchChange }, fs.deps)
    await watcher.start()
    fs.setHead('ref: refs/heads/x\n')
    fs.fire('HEAD')
    watcher.stop()
    await vi.advanceTimersByTimeAsync(1000)
    expect(onBranchChange).not.toHaveBeenCalled()
    expect(fs.emitter.close).toHaveBeenCalled()
  })
})

describe('HeadWatcher com fs.watch e git reais', () => {
  it('git checkout em outro processo é detectado em < 2 s', async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'orkio-head-')))
    const run = (...args: string[]) => execFileSync('git', args, { cwd: dir })
    try {
      run('init', '-q', '-b', 'main')
      run('config', 'user.email', 'e2e@example.com')
      run('config', 'user.name', 'E2E')
      await writeFile(join(dir, 'a.txt'), 'a')
      run('add', '.')
      run('commit', '-q', '-m', 'init')

      const changes: (string | null)[] = []
      const watcher = new HeadWatcher({
        gitDir: join(dir, '.git'),
        onBranchChange: (b) => changes.push(b)
      })
      expect(await watcher.start()).toBe('main')

      const started = Date.now()
      run('checkout', '-q', '-b', 'ORK-142/sync')
      await vi.waitFor(() => expect(changes).toEqual(['ORK-142/sync']), { timeout: 2000 })
      expect(Date.now() - started).toBeLessThan(2000)

      run('checkout', '-q', 'main')
      await vi.waitFor(() => expect(changes).toEqual(['ORK-142/sync', 'main']), { timeout: 2000 })
      watcher.stop()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
