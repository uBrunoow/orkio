import localFont from 'next/font/local'

// Fontes locais (arquivos do @fontsource, licença OFL): sem CDN, sem requisição a terceiros.
export const jost = localFont({
  src: [
    { path: './fonts/jost-latin-300-normal.woff2', weight: '300', style: 'normal' },
    { path: './fonts/jost-latin-400-normal.woff2', weight: '400', style: 'normal' },
    { path: './fonts/jost-latin-500-normal.woff2', weight: '500', style: 'normal' }
  ],
  variable: '--font-brand',
  display: 'swap'
})

export const inter = localFont({
  src: [
    { path: './fonts/inter-latin-400-normal.woff2', weight: '400', style: 'normal' },
    { path: './fonts/inter-latin-500-normal.woff2', weight: '500', style: 'normal' },
    { path: './fonts/inter-latin-600-normal.woff2', weight: '600', style: 'normal' }
  ],
  variable: '--font-ui',
  display: 'swap'
})

export const mono = localFont({
  src: [{ path: './fonts/jetbrains-mono-latin-400-normal.woff2', weight: '400', style: 'normal' }],
  variable: '--font-mono',
  display: 'swap'
})

// Títulos da landing: Geist (Vercel, licença OFL em fonts/GEIST-LICENSE.txt), uma grotesca técnica.
// Jost continua só no logo.
export const display = localFont({
  src: [{ path: './fonts/geist-variable.woff2', weight: '100 900', style: 'normal' }],
  variable: '--font-display',
  display: 'swap'
})
