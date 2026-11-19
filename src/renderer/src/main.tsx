import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { InternationalizationProvider } from '@astryxdesign/core/i18n'
import ptBR from '@astryxdesign/core/locales/pt-BR.generated.js'
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
// Textos internos da Astryx (Obrigatório, Limpar, busca, ...) em pt-BR.
createRoot(container).render(
  <StrictMode>
    <InternationalizationProvider locale="pt-BR" messages={{ 'pt-BR': ptBR }}>
      <Theme theme={themes[defaultThemeSlug]} mode="dark">
        <App />
      </Theme>
    </InternationalizationProvider>
  </StrictMode>
)
