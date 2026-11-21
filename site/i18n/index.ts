import { ptBR, type Dictionary } from './pt-BR'

export type Locale = 'pt-BR'
export const DEFAULT_LOCALE: Locale = 'pt-BR'

/** Dicionário do idioma. Quando o inglês entrar: `en` com o mesmo formato e rotas /en. */
export function getDictionary(locale: Locale = DEFAULT_LOCALE): Dictionary {
  switch (locale) {
    case 'pt-BR':
      return ptBR
  }
}
