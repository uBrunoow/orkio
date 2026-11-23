import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { TooltipProvider } from '@/components/ui/tooltip'
import { App } from './App'
import './styles/fonts.css'
import './styles/globals.css'
import './styles/brand.css'

const container = document.getElementById('root')
if (!container) throw new Error('Elemento #root não encontrado')

// Tema escuro único (styles/globals.css). Tudo compilado num .css estático: nada de <style> em
// runtime, a CSP de produção continua estrita (style-src 'self').
document.documentElement.classList.add('dark')
createRoot(container).render(
  <StrictMode>
    <TooltipProvider delayDuration={300}>
      <App />
    </TooltipProvider>
  </StrictMode>
)
