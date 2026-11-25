/**
 * Um terminal embutido na tela (xterm.js). O processo vive no main: ao montar, desenha o que já
 * saiu (`snapshot`) e segue a saída por evento (sem repetir o que a foto já tinha, pela posição de
 * cada lote); teclas e tamanho vão para o main pelo id. Desmontar (trocar de aba) não fecha o
 * processo.
 */
import { useEffect, useRef } from 'react'
import { Terminal, type ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import '@xterm/xterm/css/xterm.css'
import { unseenPart } from '../../../../shared/terminal'
import { ipcCall } from '../../lib/ipc'
import { acquireXtermCsp } from './xterm-csp'

function token(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

function theme(): ITheme {
  return {
    background: token('--background', '#0a0a0b'),
    foreground: token('--foreground', '#f2f2f0'),
    cursor: token('--brand', '#ff5b1f'),
    cursorAccent: token('--background', '#0a0a0b'),
    selectionBackground: '#ff5b1f55',
    black: '#1e1e21',
    brightBlack: '#5e5e63',
    red: token('--danger', '#f2555a'),
    brightRed: '#ff7b80',
    green: token('--ok', '#3dd68c'),
    brightGreen: '#6ee7a8',
    yellow: token('--warn', '#f5c451'),
    brightYellow: '#ffd97a',
    blue: token('--info', '#6ca8ff'),
    brightBlue: '#94c0ff',
    magenta: token('--purple', '#c9a2ff'),
    brightMagenta: '#dcc2ff',
    cyan: '#5fd4d4',
    brightCyan: '#8ce6e6',
    white: '#d6d6d3',
    brightWhite: '#f2f2f0'
  }
}

export function TerminalView({
  id,
  running,
  label
}: {
  id: string
  /** Processo vivo (senão, só leitura da saída). */
  running: boolean
  /** Nome acessível ("Terminal zsh de ORK-1"). */
  label: string
}): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)

  useEffect(() => {
    const el = host.current
    if (!el) return
    const release = acquireXtermCsp()
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    const term = new Terminal({
      fontFamily: token('--font-mono', 'monospace'),
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: !reduced,
      scrollback: 5000,
      theme: theme()
    })
    termRef.current = term
    const fit = new FitAddon()
    term.loadAddon(fit)
    // WebGL antes de abrir: o xterm nem cria o renderizador DOM. Sem WebGL, fica o DOM.
    try {
      const webgl = new WebglAddon()
      webgl.onContextLoss(() => webgl.dispose())
      term.loadAddon(webgl)
    } catch {
      // Sem WebGL neste computador.
    }
    term.open(el)

    let disposed = false
    let end: number | null = null
    const early: Parameters<typeof unseenPart>[0][] = []
    const off = window.orkio.terminal.onData((e) => {
      if (e.id !== id) return
      if (end === null) {
        early.push(e)
        return
      }
      const part = unseenPart(e, end)
      if (part) {
        term.write(part)
        end = e.at + e.data.length
      }
    })
    void ipcCall(() => window.orkio.terminal.snapshot(id), null).then((snap) => {
      if (disposed) return
      end = snap?.end ?? 0
      if (snap?.data) term.write(snap.data)
      for (const e of early.splice(0)) {
        const part = unseenPart(e, end)
        if (part) {
          term.write(part)
          end = e.at + e.data.length
        }
      }
    })

    const input = term.onData((data) => void window.orkio.terminal.write(id, data))
    const binary = term.onBinary((data) => void window.orkio.terminal.write(id, data))
    const resize = term.onResize(({ cols, rows }) => {
      void window.orkio.terminal.resize(id, { cols, rows })
    })
    let frame = 0
    const refit = (): void => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        if (disposed || el.clientWidth === 0 || el.clientHeight === 0) return
        try {
          fit.fit()
        } catch {
          // Medidas ainda indisponíveis.
        }
      })
    }
    const observer = new ResizeObserver(refit)
    observer.observe(el)
    refit()
    // A fonte mono pode chegar depois: mede de novo com ela.
    void document.fonts?.ready.then(refit)
    term.focus()

    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      observer.disconnect()
      off()
      input.dispose()
      binary.dispose()
      resize.dispose()
      term.dispose()
      termRef.current = null
      release()
    }
  }, [id])

  useEffect(() => {
    const term = termRef.current
    if (term) term.options.disableStdin = !running
  }, [running])

  return (
    <div
      ref={host}
      role="group"
      aria-label={label}
      data-terminal-id={id}
      className="orkio-terminal h-full min-h-0 w-full overflow-hidden bg-background px-3 py-2"
    />
  )
}
