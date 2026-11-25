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

/**
 * Cores ANSI do terminal: as de tom saem do tema; as que o tema não tem (ciano, as "bright" e o
 * par preto/branco) têm uma versão para cada tema, para o texto colorido do shell ler bem nos dois.
 */
const ANSI_EXTRA = {
  dark: {
    black: '#1e1e21',
    brightBlack: '#5e5e63',
    brightRed: '#ff7b80',
    brightGreen: '#6ee7a8',
    brightYellow: '#ffd97a',
    brightBlue: '#94c0ff',
    brightMagenta: '#dcc2ff',
    cyan: '#5fd4d4',
    brightCyan: '#8ce6e6',
    white: '#d6d6d3',
    brightWhite: '#f2f2f0'
  },
  light: {
    black: '#18181b',
    brightBlack: '#5b5b63',
    brightRed: '#a3161d',
    brightGreen: '#0a6b3f',
    brightYellow: '#7a4d00',
    brightBlue: '#1748a3',
    brightMagenta: '#5a2fb0',
    cyan: '#0b7a85',
    brightCyan: '#075a62',
    white: '#a1a1aa',
    brightWhite: '#71717a'
  }
} satisfies Record<'dark' | 'light', ITheme>

function theme(): ITheme {
  const light = document.documentElement.dataset['theme'] === 'light'
  return {
    background: token('--background', '#0a0a0b'),
    foreground: token('--foreground', '#f2f2f0'),
    cursor: token('--brand', '#ff5b1f'),
    cursorAccent: token('--background', '#0a0a0b'),
    selectionBackground: light ? '#ff5b1f33' : '#ff5b1f55',
    red: token('--danger', '#f2555a'),
    green: token('--ok', '#3dd68c'),
    yellow: token('--warn', '#f5c451'),
    blue: token('--info', '#6ca8ff'),
    magenta: token('--purple', '#c9a2ff'),
    ...ANSI_EXTRA[light ? 'light' : 'dark']
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
      fontFamily: token('--app-font-mono', 'monospace'),
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
    // Trocou o tema ou a fonte em Configurações › Aparência: o terminal acompanha na hora.
    const restyle = new MutationObserver(() => {
      term.options.theme = theme()
      term.options.fontFamily = token('--app-font-mono', 'monospace')
    })
    restyle.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'data-code-font']
    })

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
      restyle.disconnect()
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
