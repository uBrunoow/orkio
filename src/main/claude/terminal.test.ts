import { describe, expect, it } from 'vitest'
import { onPath, terminalCandidates, terminalCommand } from './terminal'

const DIR = '/home/u/wt/ORK-7'

describe('terminalCommand', () => {
  it('Linux: $TERMINAL seguro primeiro, depois os terminais conhecidos com a pasta', () => {
    const c = terminalCandidates('linux', { TERMINAL: 'foot' }, DIR)
    expect(c[0]).toEqual({ cmd: 'foot', args: [] })
    expect(c.map((x) => x.cmd)).toEqual([
      'foot',
      'x-terminal-emulator',
      'gnome-terminal',
      'konsole',
      'xfce4-terminal',
      'kitty',
      'alacritty'
    ])
    expect(c.find((x) => x.cmd === 'gnome-terminal')?.args).toEqual([`--working-directory=${DIR}`])
    expect(c.find((x) => x.cmd === 'konsole')?.args).toEqual(['--workdir', DIR])
    expect(c.find((x) => x.cmd === 'kitty')?.args).toEqual(['--directory', DIR])
  })
  it('Linux: $TERMINAL com caminho, espaço ou opções é ignorado', () => {
    for (const bad of ['/bin/sh -c x', 'a b', '../x', '-e', '']) {
      expect(terminalCandidates('linux', { TERMINAL: bad }, DIR)[0]?.cmd).not.toBe(bad)
    }
  })
  it('escolhe o primeiro achado no PATH', () => {
    const found = new Set(['konsole', 'kitty'])
    expect(terminalCommand('linux', {}, DIR, (c) => found.has(c))).toEqual({
      cmd: 'konsole',
      args: ['--workdir', DIR]
    })
    expect(terminalCommand('linux', {}, DIR, () => false)).toBeNull()
  })
  it('macOS: open -a Terminal <pasta> (o open sempre existe, sem procurar no PATH)', () => {
    expect(terminalCommand('darwin', {}, DIR, () => false)).toEqual({
      cmd: 'open',
      args: ['-a', 'Terminal', DIR]
    })
  })
  it('Windows: a pasta nunca vai nos argumentos (cmd.exe/wt reinterpretam & | ^ % ;)', () => {
    const evil = 'C:\\Users\\a&b;c^d%PATH%\\wt'
    expect(terminalCommand('win32', {}, evil)).toEqual({ cmd: 'wt', args: ['-d', '.'] })
    expect(terminalCommand('win32', {}, evil, (c) => c === 'cmd.exe')).toEqual({
      cmd: 'cmd.exe',
      args: []
    })
    for (const c of terminalCandidates('win32', {}, evil)) {
      expect(c.args.join(' ')).not.toContain(evil)
      expect(c.args.join(' ')).not.toMatch(/[&|^%;]/)
    }
  })
  it('pasta com quebra de linha não vira comando', () => {
    expect(terminalCandidates('linux', {}, '/x\n/y')).toEqual([])
  })
  it('onPath procura nas pastas do PATH', () => {
    const files = new Set(['/usr/bin/kitty'])
    expect(onPath('kitty', { PATH: '/bin:/usr/bin' }, 'linux', (p) => files.has(p))).toBe(true)
    expect(onPath('foot', { PATH: '/bin:/usr/bin' }, 'linux', (p) => files.has(p))).toBe(false)
  })
})
