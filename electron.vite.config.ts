import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * Em dev, o Vite injeta CSS via <style>, o que a CSP estrita bloqueia.
 * Relaxamos style-src SÓ no dev server; o build de produção mantém a CSP do index.html.
 */
function devOnlyRelaxedStyleCsp(): Plugin {
  return {
    name: 'orkio:dev-only-relaxed-style-csp',
    apply: 'serve',
    transformIndexHtml(html) {
      const relaxed = html.replace("style-src 'self'", "style-src 'self' 'unsafe-inline'")
      if (relaxed === html) throw new Error('CSP de style-src não encontrada no index.html')
      return relaxed
    }
  }
}

export default defineConfig({
  main: {
    build: {
      externalizeDeps: true,
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          // Servidor MCP de permissões do Claude Code (4A): processo separado, sem dependências.
          'permission-mcp': resolve('src/main/claude/bridge/permission-mcp.ts')
        }
      }
    }
  },
  preload: {
    build: { externalizeDeps: true }
  },
  renderer: {
    root: resolve('src/renderer'),
    resolve: { alias: { '@': resolve('src/renderer/src') } },
    plugins: [react(), tailwindcss(), devOnlyRelaxedStyleCsp()],
    build: {
      // Fontes nunca viram data: URI — a CSP só permite font-src 'self'.
      assetsInlineLimit: (file) => (/\.(woff2?|ttf|otf)$/.test(file) ? false : undefined)
    }
  }
})
