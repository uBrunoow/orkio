import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Theme } from '@astryxdesign/core/theme'
import { defaultThemeSlug, themes } from '../../astryx-themes'
import { App } from './App'
import './styles/fonts.css'
import './styles/astryx.css'
import './styles/brand.css'

const container = document.getElementById('root')
if (!container) throw new Error('Elemento #root não encontrado')

// Tema Orkio pré-compilado (`__built: true`): o <Theme> não injeta <style> em runtime,
// o que mantém a CSP de produção estrita (style-src 'self').
createRoot(container).render(
  <StrictMode>
    <Theme theme={themes[defaultThemeSlug]} mode="dark">
      <App />
    </Theme>
  </StrictMode>
)
