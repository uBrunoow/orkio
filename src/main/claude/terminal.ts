/**
 * "Abrir terminal aqui": o comando do terminal do sistema para abrir numa pasta. Puro: só monta
 * `{ cmd, args }` (nunca shell); quem executa é o main com `spawn` sem shell e `cwd: dir`.
 */
import { delimiter, join } from 'node:path'

export interface TerminalCommand {
  cmd: string
  args: string[]
}

/** Só caminhos absolutos simples (sem nova linha/NUL) vão para a linha de comando. */
function safeDir(dir: string): boolean {
  return dir.length > 0 && !/[\0\r\n]/.test(dir)
}

/** Nome de executável sem caminho nem espaços (o `$TERMINAL` do usuário). */
function safeCommandName(name: string): boolean {
  return /^[A-Za-z0-9._+][A-Za-z0-9._+-]*$/.test(name) && !name.startsWith('.')
}

/** Candidatos em ordem de preferência para a plataforma. */
export function terminalCandidates(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  dir: string
): TerminalCommand[] {
  if (!safeDir(dir)) return []
  if (platform === 'darwin') return [{ cmd: 'open', args: ['-a', 'Terminal', dir] }]
  if (platform === 'win32') {
    // A pasta NUNCA vai na linha de comando no Windows: `cmd.exe`/`wt` reinterpretam `& | ^ % ;`.
    // Quem executa abre com `cwd: dir`; `wt -d .` e o `cmd.exe` sem argumentos usam esse cwd.
    return [
      { cmd: 'wt', args: ['-d', '.'] },
      { cmd: 'cmd.exe', args: [] }
    ]
  }
  const list: TerminalCommand[] = []
  const custom = env['TERMINAL']?.trim()
  // `$TERMINAL` não tem convenção de pasta: só abrimos com cwd, que o terminal herda.
  if (custom && safeCommandName(custom)) list.push({ cmd: custom, args: [] })
  list.push(
    { cmd: 'x-terminal-emulator', args: [] },
    { cmd: 'gnome-terminal', args: [`--working-directory=${dir}`] },
    { cmd: 'konsole', args: ['--workdir', dir] },
    { cmd: 'xfce4-terminal', args: [`--working-directory=${dir}`] },
    { cmd: 'kitty', args: ['--directory', dir] },
    { cmd: 'alacritty', args: ['--working-directory', dir] }
  )
  return list
}

/**
 * O primeiro candidato que existe (`exists` diz se o executável está no PATH). Quem executa deve
 * sempre passar `cwd: dir`: `$TERMINAL`, `x-terminal-emulator` e os do Windows só usam o cwd.
 */
export function terminalCommand(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  dir: string,
  exists: (cmd: string) => boolean = () => true
): TerminalCommand | null {
  return terminalCandidates(platform, env, dir).find((c) => exists(c.cmd)) ?? null
}

/** Procura um executável nas pastas do PATH (nomes simples; no Windows tenta as extensões). */
export function onPath(
  cmd: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  isFile: (path: string) => boolean
): boolean {
  const dirs = (env['PATH'] ?? env['Path'] ?? '').split(delimiter).filter(Boolean)
  const exts = platform === 'win32' ? ['', '.exe', '.cmd', '.bat'] : ['']
  return dirs.some((d) => exts.some((e) => isFile(join(d, cmd + e))))
}
