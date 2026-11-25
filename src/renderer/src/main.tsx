import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { TooltipProvider } from '@/components/ui/tooltip'
import { App } from './App'
import { SourcesProvider } from './app/sources'
import { applySavedAppearance } from './features/settings/appearance'
import { applySavedLayout } from './features/settings/layout-prefs'
import './styles/fonts.css'
import './styles/globals.css'
import './styles/brand.css'

const container = document.getElementById('root')
if (!container) throw new Error('Elemento #root não encontrado')

// Tema, fontes, texto, fundo (Configurações › Aparência) e largura das páginas (Layout) salvos
// neste computador, como atributos no <html> (e a classe `dark` no escuro). Tudo compilado num
// .css estático: nada de <style> em runtime, a CSP de produção continua estrita.
applySavedAppearance()
applySavedLayout()
createRoot(container).render(
  <StrictMode>
    <TooltipProvider delayDuration={300}>
      <SourcesProvider>
        <App />
      </SourcesProvider>
    </TooltipProvider>
  </StrictMode>
)
