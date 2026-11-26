/**
 * Terminal embutido (Fase 2): PTYs (`node-pty`) que vivem no main. O renderer manda só teclas e
 * tamanho para um terminal pelo id; a saída sai por evento em lotes e fica guardada (fim da
 * saída) para redesenhar quando a aba volta (só a aba ativa fica montada).
 *
 * Quem decide pasta e programa é o main: a pasta é o worktree da tarefa (resolvido por quem chama)
 * e o programa é o shell do usuário ou `claude --resume <uuid>` (UUID validado, executável achado
 * no PATH e chamado direto, sem shell). O ambiente passa por `sanitizeEnv`.
 */
import { randomBytes } from 'node:crypto'
import { basename, delimiter, isAbsolute, join } from 'node:path'
import {
  TERMINAL_LIMITS,
  isSessionUuid,
  trimScrollback,
  type TerminalChangedEvent,
  type TerminalDataEvent,
  type TerminalKind,
  type TerminalSnapshot,
  type TerminalView
} from '../../shared/terminal'
import { DomainError } from '../errors'
import { sanitizeEnv } from '../platform/redact'

/** O pedaço do `node-pty` que usamos (injetado: os testes não abrem PTY). */
export interface PtyProcess {
  readonly pid: number
  onData(listener: (data: string) => void): { dispose(): void }
  onExit(listener: (e: { exitCode: number; signal?: number }) => void): { dispose(): void }
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(signal?: string): void
}

export type SpawnPty = (
  file: string,
  args: string[],
  options: {
    name: string
    cols: number
    rows: number
    cwd: string
    env: Record<string, string>
  }
) => PtyProcess

export interface TerminalServiceDeps {
  /** `null` = o módulo nativo não carregou (o app segue sem o terminal embutido). */
  spawnPty: SpawnPty | null
  env: NodeJS.ProcessEnv
  platform: NodeJS.Platform
  isFile(path: string): boolean
  isDir(path: string): boolean
  emitData(event: TerminalDataEvent): void
  emitChanged(event: TerminalChangedEvent): void
  newId?(): string
  now?(): Date
  /** Intervalo dos lotes de saída (ms). */
  flushMs?: number
  /**
   * Sinal ao grupo do processo (servidores: o `pnpm dev` e os filhos dele). Sem isso (Windows),
   * o servidor sai pelo `pty.kill`.
   */
  killGroup?(pid: number, signal: 'SIGTERM' | 'SIGKILL'): void
  /** Registra algo para a saída do processo do app (o SIGKILL final dos servidores). */
  atExit?(fn: () => void): void
}

/** Quanto o servidor tem para sair depois do SIGTERM antes do SIGKILL. */
const SERVER_GRACE_MS = 5_000

export const TERMINAL_MESSAGES = {
  unavailable:
    'O terminal embutido não está disponível neste computador. Use “Abrir terminal aqui”.',
  noWorkspace: 'Esta tarefa ainda não tem pasta de trabalho. Rode o Claude Code primeiro.',
  tooMany: 'Muitos terminais abertos. Feche algum antes de abrir outro.',
  noShell: 'Não achei um shell neste computador.',
  noClaude: 'Não achei o Claude Code no PATH deste computador.',
  invalidSession: 'Sessão do Claude Code inválida.',
  notFound: 'Este terminal já foi fechado.',
  failed: 'Não foi possível abrir o terminal.'
} as const

export class TerminalServiceError extends DomainError {
  override name = 'TerminalServiceError'
}

/** Terminais terminados guardados por tarefa (para ler a saída); os mais antigos saem. */
const KEEP_EXITED = 4
const INITIAL = { cols: 100, rows: 30 }

interface Live {
  view: TerminalView
  pty: PtyProcess | null
  buffer: string
  /** Caracteres já emitidos (fim do `buffer` na saída inteira). */
  emitted: number
  pending: string
  timer: NodeJS.Timeout | null
  disposers: { dispose(): void }[]
  /** Servidor: a saída passa por aqui antes da tela (segredos). */
  filter?: (data: string) => string
  onExit?: (exitCode: number) => void
}

/** Primeiro executável com esse nome no PATH (Windows: só `.exe`, chamado direto). */
export function findExecutable(
  name: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  isFile: (path: string) => boolean
): string | null {
  const dirs = (env['PATH'] ?? env['Path'] ?? '').split(delimiter).filter((d) => isAbsolute(d))
  const exts = platform === 'win32' ? ['.exe'] : ['']
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = join(dir, name + ext)
      if (isFile(candidate)) return candidate
    }
  }
  return null
}

const LOGIN_SHELLS = new Set(['bash', 'zsh', 'fish', 'ksh'])

/** Shell do usuário: `$SHELL` (caminho absoluto existente) ou os padrões do sistema. */
export function userShell(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  isFile: (path: string) => boolean
): { file: string; args: string[] } | null {
  if (platform === 'win32') {
    const ps = findExecutable('powershell', env, platform, isFile)
    if (ps) return { file: ps, args: ['-NoLogo'] }
    const cmd = env['COMSPEC'] ?? env['ComSpec']
    if (cmd && isAbsolute(cmd) && isFile(cmd)) return { file: cmd, args: [] }
    return null
  }
  const shell = env['SHELL']?.trim()
  const candidates = [
    ...(shell && isAbsolute(shell) ? [shell] : []),
    '/bin/zsh',
    '/bin/bash',
    '/bin/sh'
  ]
  const file = candidates.find((c) => isFile(c))
  if (!file) return null
  // Shell de login: lê o perfil do usuário (PATH, aliases), como o terminal do sistema.
  return { file, args: LOGIN_SHELLS.has(basename(file)) ? ['-l'] : [] }
}

/** Argumentos do `claude` para retomar a sessão no terminal (interativo, sem `-p`). */
export function claudeResumeArgs(sessionId: string): string[] {
  if (!isSessionUuid(sessionId)) {
    throw new TerminalServiceError('invalid_session', TERMINAL_MESSAGES.invalidSession)
  }
  return ['--resume', sessionId]
}

export class TerminalService {
  private readonly live = new Map<string, Live>()
  private stopped = false

  constructor(private readonly deps: TerminalServiceDeps) {}

  get available(): boolean {
    return this.deps.spawnPty !== null
  }

  /** Todos os terminais (tela Terminais), do mais antigo ao mais novo. */
  all(): TerminalView[] {
    return [...this.live.values()]
      .map((t) => ({ ...t.view }))
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
  }

  list(taskId: string): TerminalView[] {
    return [...this.live.values()]
      .filter((t) => t.view.taskId === taskId)
      .map((t) => ({ ...t.view }))
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
  }

  /** Algum terminal rodando na tarefa (ex.: não remover o worktree por baixo dele). */
  hasRunning(taskId: string, kind?: TerminalKind): boolean {
    return [...this.live.values()].some(
      (t) =>
        t.view.taskId === taskId &&
        t.view.state === 'running' &&
        (kind === undefined || t.view.kind === kind)
    )
  }

  /** Abre um terminal na pasta (`cwd` resolvida pelo main). */
  open(input: {
    projectId: string
    taskId: string
    cwd: string
    kind: TerminalKind
    /** Obrigatório em `claude`: a sessão retomada. */
    sessionId?: string
    /** `server`: a linha de shell do cadastro (rodada com `-lc`). */
    command?: string
    /** `server`: nome da aba (o nome do servidor). */
    title?: string
    /** `server`: variáveis a mais (porta, URLs dos outros servidores). */
    env?: Record<string, string>
    /** `server`: a saída passa por aqui antes de ir à tela. */
    filter?: (data: string) => string
    /** O processo saiu sozinho (não chamado ao fechar pelo Orkio). */
    onExit?: (exitCode: number) => void
  }): TerminalView {
    const spawnPty = this.deps.spawnPty
    if (!spawnPty || this.stopped) {
      throw new TerminalServiceError('unavailable', TERMINAL_MESSAGES.unavailable)
    }
    if (!this.deps.isDir(input.cwd)) {
      throw new TerminalServiceError('no_workspace', TERMINAL_MESSAGES.noWorkspace)
    }
    // Servidores têm o limite deles (no `ServersService`); aqui contam só shell e Claude.
    const running = [...this.live.values()].filter(
      (t) => t.view.state === 'running' && t.view.kind !== 'server'
    ).length
    if (input.kind !== 'server' && running >= TERMINAL_LIMITS.maxOpen) {
      throw new TerminalServiceError('too_many', TERMINAL_MESSAGES.tooMany)
    }
    const { platform, isFile } = this.deps
    const env = { ...ptyEnv(this.deps.env), ...(input.env ?? {}) }
    let file: string
    let args: string[]
    let title: string
    if (input.kind === 'server') {
      const shell = userShell(env, platform, isFile)
      if (!shell) throw new TerminalServiceError('no_shell', TERMINAL_MESSAGES.noShell)
      file = shell.file
      args = [...shell.args, ...shellCommandArgs(shell.file, input.command ?? '')]
      title = input.title ?? 'servidor'
    } else if (input.kind === 'claude') {
      args = claudeResumeArgs(input.sessionId ?? '')
      const claude = findExecutable('claude', env, platform, isFile)
      if (!claude) throw new TerminalServiceError('no_claude', TERMINAL_MESSAGES.noClaude)
      file = claude
      title = 'Claude'
    } else {
      const shell = userShell(env, platform, isFile)
      if (!shell) throw new TerminalServiceError('no_shell', TERMINAL_MESSAGES.noShell)
      file = shell.file
      args = shell.args
      title = basename(shell.file).replace(/\.exe$/i, '')
    }
    const id = this.deps.newId?.() ?? `t-${randomBytes(8).toString('hex')}`
    const view: TerminalView = {
      id,
      projectId: input.projectId,
      taskId: input.taskId,
      kind: input.kind,
      title,
      state: 'running',
      exitCode: null,
      startedAt: (this.deps.now?.() ?? new Date()).toISOString()
    }
    let pty: PtyProcess
    try {
      pty = spawnPty(file, args, { name: 'xterm-256color', ...INITIAL, cwd: input.cwd, env })
    } catch {
      throw new TerminalServiceError('failed', TERMINAL_MESSAGES.failed)
    }
    const entry: Live = {
      view,
      pty,
      buffer: '',
      emitted: 0,
      pending: '',
      timer: null,
      disposers: [],
      ...(input.filter ? { filter: input.filter } : {}),
      ...(input.onExit ? { onExit: input.onExit } : {})
    }
    this.live.set(id, entry)
    entry.disposers.push(
      pty.onData((data) => this.onData(entry, data)),
      pty.onExit(({ exitCode }) => this.onExit(entry, exitCode))
    )
    this.pruneExited(input.taskId)
    this.changed(view)
    return { ...view }
  }

  /** O que já saiu (fim da saída), para redesenhar o terminal ao voltar à aba. */
  snapshot(id: string): TerminalSnapshot | null {
    const t = this.live.get(id)
    if (!t) return null
    return { data: t.buffer, end: t.emitted }
  }

  write(id: string, data: string): void {
    const t = this.live.get(id)
    // O terminal do servidor é só leitura: parar é pelo Orkio (Parar), nunca Ctrl+C solto.
    if (!t?.pty || t.view.state !== 'running' || t.view.kind === 'server') return
    t.pty.write(data.slice(0, TERMINAL_LIMITS.maxInput))
  }

  resize(id: string, size: { cols: number; rows: number }): void {
    const t = this.live.get(id)
    if (!t?.pty || t.view.state !== 'running') return
    try {
      t.pty.resize(size.cols, size.rows)
    } catch {
      // O processo pode ter acabado entre a checagem e o resize.
    }
  }

  /**
   * Fecha (mata o processo, se ainda roda) e esquece o terminal. Resolve quando o processo saiu
   * (ou depois de 3 s): quem vai usar a mesma sessão do Claude Code logo em seguida espera.
   */
  close(id: string): Promise<void> {
    const t = this.live.get(id)
    if (!t) return Promise.resolve()
    const exited = this.kill(t)
    this.forget(t)
    this.changed(t.view)
    return exited
  }

  /** Fecha os terminais da tarefa (de um tipo, ou todos) e espera os processos saírem. */
  async closeTask(taskId: string, kind?: TerminalKind): Promise<void> {
    const ids = [...this.live.values()]
      .filter((t) => t.view.taskId === taskId && (kind === undefined || t.view.kind === kind))
      .map((t) => t.view.id)
    await Promise.all(ids.map((id) => this.close(id)))
  }

  /** Fecha tudo (app saindo). */
  stopAll(): void {
    this.stopped = true
    for (const t of [...this.live.values()]) {
      const pid = t.pty?.pid
      const group = t.view.kind === 'server' && pid !== undefined && this.deps.killGroup
      void this.kill(t)
      this.forget(t)
      // O app vai fechar sem esperar: o que não saiu com o SIGTERM sai com o SIGKILL no fim.
      if (group) this.deps.atExit?.(() => this.signalGroup(pid, 'SIGKILL'))
    }
  }

  private onData(t: Live, data: string): void {
    if (!this.live.has(t.view.id)) return
    t.pending += data
    if (t.timer) return
    t.timer = setTimeout(() => this.flush(t), this.deps.flushMs ?? 16)
  }

  private flush(t: Live): void {
    if (t.timer) clearTimeout(t.timer)
    t.timer = null
    if (!t.pending) return
    const data = t.filter ? t.filter(t.pending) : t.pending
    t.pending = ''
    const at = t.emitted
    t.buffer = trimScrollback(t.buffer + data)
    t.emitted += data.length
    if (this.live.has(t.view.id)) this.deps.emitData({ id: t.view.id, data, at })
  }

  private onExit(t: Live, exitCode: number): void {
    this.flush(t)
    t.view = { ...t.view, state: 'exited', exitCode }
    t.pty = null
    for (const d of t.disposers.splice(0)) d.dispose()
    if (this.live.has(t.view.id)) this.changed(t.view)
    t.onExit?.(exitCode)
  }

  private kill(t: Live): Promise<void> {
    if (!t.pty) return Promise.resolve()
    const pty = t.pty
    t.pty = null
    for (const d of t.disposers.splice(0)) d.dispose()
    const group = t.view.kind === 'server' && this.deps.killGroup !== undefined
    const exited = new Promise<void>((resolve) => {
      const timers = [setTimeout(done, group ? SERVER_GRACE_MS + 3_000 : 3_000)]
      // Servidor: SIGTERM no grupo (o `pnpm dev` e os filhos); sem sair no prazo, SIGKILL.
      if (group)
        timers.push(setTimeout(() => this.signalGroup(pty.pid, 'SIGKILL'), SERVER_GRACE_MS))
      const sub = pty.onExit(done)
      function done(): void {
        for (const timer of timers) clearTimeout(timer)
        sub.dispose()
        resolve()
      }
    })
    if (group) {
      this.signalGroup(pty.pid, 'SIGTERM')
    } else {
      try {
        pty.kill()
      } catch {
        // Já tinha saído.
      }
    }
    t.view = { ...t.view, state: 'exited' }
    return exited
  }

  private signalGroup(pid: number, signal: 'SIGTERM' | 'SIGKILL'): void {
    try {
      this.deps.killGroup?.(pid, signal)
    } catch {
      // O grupo já saiu (ESRCH).
    }
  }

  private forget(t: Live): void {
    if (t.timer) clearTimeout(t.timer)
    t.timer = null
    this.live.delete(t.view.id)
  }

  private pruneExited(taskId: string): void {
    const exited = [...this.live.values()]
      .filter((t) => t.view.taskId === taskId && t.view.state === 'exited')
      .sort((a, b) => a.view.startedAt.localeCompare(b.view.startedAt))
    for (const t of exited.slice(0, Math.max(0, exited.length - KEEP_EXITED))) this.forget(t)
  }

  private changed(view: TerminalView): void {
    this.deps.emitChanged({ projectId: view.projectId, taskId: view.taskId })
  }
}

/** `-c <linha>` do shell (Windows: PowerShell `-Command`, cmd `/c`). */
export function shellCommandArgs(shellFile: string, command: string): string[] {
  const name = basename(shellFile)
    .toLowerCase()
    .replace(/\.exe$/, '')
  if (name === 'powershell' || name === 'pwsh') return ['-Command', command]
  if (name === 'cmd') return ['/d', '/s', '/c', command]
  return ['-c', command]
}

/** Ambiente do PTY: o do app sem segredos, com cores de terminal de verdade. */
export function ptyEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(sanitizeEnv(env))) if (v !== undefined) out[k] = v
  out['TERM'] = 'xterm-256color'
  out['COLORTERM'] = 'truecolor'
  return out
}
