import { useEffect, type RefObject } from 'react'
import { isTextField } from '../app/shortcuts'

/** "/" foca o campo de busca (fora de campos de texto), como nas listas das referências. */
export function useSlashFocus(target: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || isTextField(e.target)) return
      const el = target.current
      const input = el instanceof HTMLInputElement ? el : el?.querySelector('input')
      if (!input) return
      e.preventDefault()
      input.focus()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [target])
}
