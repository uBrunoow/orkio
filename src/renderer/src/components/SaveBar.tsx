import { Button } from '@/components/ui/button'
import { Spinner } from './Spinner'

/**
 * Barra de salvar fixa no rodapé da página: quantas alterações há, Descartar e a ação primária.
 * Use como último filho da página (o `sticky` depende disso). Avisos e erros que bloqueiam o
 * salvar entram em `children`, acima dos botões.
 */
export function SaveBar({
  label,
  changes,
  saveLabel,
  isSaving,
  isDisabled,
  onSave,
  onDiscard,
  children
}: {
  label: string
  changes: number
  saveLabel: string
  isSaving: boolean
  isDisabled: boolean
  onSave(): void
  onDiscard(): void
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <section
      role="region"
      aria-label={label}
      className="sticky -bottom-6 z-10 -mb-6 flex flex-col gap-2 border-t border-border-soft bg-background pt-2.5 pb-6"
    >
      {children}
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs text-muted-foreground" data-testid="unsaved-changes">
          {changes === 0
            ? 'Nenhuma alteração'
            : changes === 1
              ? '1 alteração não salva'
              : `${changes} alterações não salvas`}
        </p>
        <div className="flex-1" />
        <Button variant="ghost" disabled={changes === 0} onClick={onDiscard}>
          Descartar alterações
        </Button>
        <Button disabled={isDisabled || isSaving} onClick={onSave}>
          {isSaving && <Spinner />}
          {saveLabel}
        </Button>
      </div>
    </section>
  )
}
