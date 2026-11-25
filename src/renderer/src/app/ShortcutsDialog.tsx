import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Kbd } from '@/components/ui/kbd'
import { MENUS, shortcutRows, type Command, type CommandState } from './commands'
import { formatKeys } from './keys'

/** Ajuda › Atalhos do teclado: todo comando do registro que tem atalho, pelo menu dele. */
export function ShortcutsDialog({
  open,
  commands,
  ctx,
  onClose
}: {
  open: boolean
  commands: readonly Command[]
  ctx: CommandState
  onClose(): void
}): React.JSX.Element {
  const groups = MENUS.map((m) => ({
    label: m.label,
    items: shortcutRows(commands, m.id, ctx)
  })).filter((g) => g.items.length > 0)
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="gap-4 sm:max-w-lg">
        <DialogTitle className="text-base font-medium text-foreground">
          Atalhos do teclado
        </DialogTitle>
        <DialogDescription className="text-xs text-muted-foreground">
          No Quadro: J/K ou setas andam entre os cards, M abre o menu do card e{' '}
          {formatKeys('mod+enter', ctx.isMac)} abre a tarefa.
        </DialogDescription>
        <div className="grid max-h-[60vh] grid-cols-1 gap-4 overflow-y-auto pr-1 sm:grid-cols-2">
          {groups.map((g) => (
            <section key={g.label} aria-label={g.label} className="flex flex-col gap-1.5">
              <h3 className="label-caps">{g.label}</h3>
              <ul className="flex flex-col gap-1">
                {g.items.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-foreground">{c.label}</span>
                    <Kbd>{c.keys}</Kbd>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
