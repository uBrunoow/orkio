import { useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { TextField } from '../components/form'
import { cn } from '@/lib/utils'
import { EditIcon, PlusIcon, SwitchIcon, TrashIcon } from '../components/icons'
import {
  ARRANGEMENTS,
  MAX_DESKTOPS,
  MAX_DESKTOP_NAME,
  arrangementOf,
  type Arrangement,
  type Desktop,
  type DesktopsAction
} from './desktops'
import { ariaKeys, formatKeys } from './keys'
import { useTabTitle } from './TabStrip'
import type { Tab } from './tabs'

const MAX_PREVIEW = 3

function TabTitleText({ tab }: { tab: Tab }): React.JSX.Element {
  const { id, title } = useTabTitle(tab.router.route)
  return <>{id ? `${id} ${title}` : title}</>
}

/** Resumo das abas de um desktop ("Quadro, ORK-2 Listar…, Agentes e mais 2"). */
function TabsPreview({ desktop }: { desktop: Desktop }): React.JSX.Element {
  const tabs = desktop.tabs.tabs
  const shown = tabs.slice(0, MAX_PREVIEW)
  const rest = tabs.length - shown.length
  if (tabs.length === 0) return <>Sem abas</>
  return (
    <>
      {shown.map((t, i) => (
        <span key={t.id}>
          {i > 0 && ', '}
          <TabTitleText tab={t} />
        </span>
      ))}
      {rest > 0 && ` e mais ${rest}`}
    </>
  )
}

/**
 * Seletor de desktops (à esquerda das abas): mostra o atual; abre a lista de todos (com as abas de
 * cada um), criar, renomear e apagar. "Todos os desktops" (Ctrl/⌘+Shift+D) abre esta lista.
 */
export function DesktopSwitcher({
  desktops,
  activeId,
  isMac,
  open,
  onOpenChange,
  dispatch,
  onRename
}: {
  desktops: readonly Desktop[]
  activeId: string
  isMac: boolean
  open: boolean
  onOpenChange(open: boolean): void
  dispatch(action: DesktopsAction): void
  onRename(): void
}): React.JSX.Element {
  const index = Math.max(
    0,
    desktops.findIndex((d) => d.id === activeId)
  )
  const current = desktops[index]!
  const labelId = useId()
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Desktop atual: ${current.name}`}
          aria-keyshortcuts={ariaKeys('mod+shift+d', isMac)}
          title={`Todos os desktops (${formatKeys('mod+shift+d', isMac)})`}
          className="flex h-7 max-w-[11rem] shrink-0 items-center gap-1.5 rounded-md pr-1.5 pl-1 text-sm text-muted-foreground outline-none hover:bg-muted/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 data-[state=open]:bg-muted data-[state=open]:text-foreground"
        >
          <span
            aria-hidden="true"
            className="flex size-5 shrink-0 items-center justify-center rounded-sm bg-muted font-mono text-2xs text-foreground"
          >
            {index + 1}
          </span>
          <span className="min-w-0 truncate">{current.name}</span>
          <SwitchIcon className="size-3.5 text-subtle-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-80" aria-labelledby={labelId}>
        <DropdownMenuLabel
          id={labelId}
          className="text-2xs font-normal tracking-wider text-subtle-foreground uppercase"
        >
          Todos os desktops
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={activeId}
          onValueChange={(id) => dispatch({ type: 'switch', id })}
        >
          {desktops.map((d, i) => (
            <DropdownMenuRadioItem
              key={d.id}
              value={d.id}
              aria-keyshortcuts={ariaKeys(`mod+alt+${i + 1}`, isMac)}
              className="items-start"
            >
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-foreground">{d.name}</span>
                <span className="truncate text-xs text-subtle-foreground">
                  <TabsPreview desktop={d} />
                </span>
              </span>
              <DropdownMenuShortcut aria-hidden="true" className="pt-0.5">
                {formatKeys(`mod+alt+${i + 1}`, isMac)}
              </DropdownMenuShortcut>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={desktops.length >= MAX_DESKTOPS}
          onSelect={() => dispatch({ type: 'create' })}
        >
          <PlusIcon />
          Novo desktop
          <DropdownMenuShortcut aria-hidden="true">
            {formatKeys('mod+alt+n', isMac)}
          </DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onRename}>
          <EditIcon />
          Renomear desktop…
        </DropdownMenuItem>
        <DropdownMenuItem
          variant="destructive"
          disabled={desktops.length < 2}
          onSelect={() => dispatch({ type: 'remove' })}
        >
          <TrashIcon />
          Apagar desktop
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Desenho do arranjo (caixinhas no lugar de cada painel), na cor do texto. */
export function ArrangementGlyph({
  arrangement,
  className
}: {
  arrangement: Arrangement
  className?: string
}): React.JSX.Element {
  const cell = 'rounded-[1.5px] bg-current'
  const frame = cn('grid size-4 shrink-0 gap-[2px] p-px', className)
  switch (arrangement) {
    case 'single':
      return (
        <span aria-hidden="true" className={frame}>
          <span className={cell} />
        </span>
      )
    case 'main-stack':
      return (
        <span aria-hidden="true" className={cn(frame, 'grid-cols-[3fr_2fr] grid-rows-2')}>
          <span className={cn(cell, 'row-span-2')} />
          <span className={cell} />
          <span className={cell} />
        </span>
      )
    case 'columns':
      return (
        <span aria-hidden="true" className={cn(frame, 'grid-cols-3')}>
          <span className={cell} />
          <span className={cell} />
          <span className={cell} />
        </span>
      )
    case 'grid':
      return (
        <span aria-hidden="true" className={cn(frame, 'grid-cols-2 grid-rows-2')}>
          <span className={cell} />
          <span className={cell} />
          <span className={cell} />
          <span className={cell} />
        </span>
      )
  }
}

/** Arranjo do desktop (à direita das abas): Uma aba, Principal + pilha, Colunas, Grade. */
export function ArrangementMenu({
  arrangement,
  dispatch
}: {
  arrangement: Arrangement
  dispatch(action: DesktopsAction): void
}): React.JSX.Element {
  const current = arrangementOf(arrangement)
  const labelId = useId()
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`Arranjo: ${current.label}`}
              className={cn(
                'flex size-7 shrink-0 items-center justify-center rounded-md outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 data-[state=open]:bg-muted',
                arrangement === 'single' ? 'text-subtle-foreground' : 'text-brand'
              )}
            >
              <ArrangementGlyph arrangement={arrangement} />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Dividir a tela: {current.label}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-72" aria-labelledby={labelId}>
        <DropdownMenuLabel
          id={labelId}
          className="text-2xs font-normal tracking-wider text-subtle-foreground uppercase"
        >
          Arranjo das abas
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={arrangement}
          onValueChange={(v) => {
            const next = ARRANGEMENTS.find((a) => a.id === v)
            if (next) dispatch({ type: 'arrange', arrangement: next.id })
          }}
        >
          {ARRANGEMENTS.map((a) => (
            <DropdownMenuRadioItem key={a.id} value={a.id} className="items-start">
              <ArrangementGlyph arrangement={a.id} className="mt-0.5 text-muted-foreground" />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-foreground">{a.label}</span>
                <span className="text-xs text-subtle-foreground">{a.hint}</span>
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Renomear o desktop atual. */
export function RenameDesktopDialog({
  desktop,
  onClose,
  onSave
}: {
  /** `null` = fechado. */
  desktop: Desktop | null
  onClose(): void
  onSave(name: string): void
}): React.JSX.Element {
  return (
    <Dialog open={desktop !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="gap-4 sm:max-w-sm">
        {desktop && (
          <RenameForm
            key={desktop.id}
            initial={desktop.name}
            onCancel={onClose}
            onSave={(name) => {
              onSave(name)
              onClose()
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function RenameForm({
  initial,
  onCancel,
  onSave
}: {
  initial: string
  onCancel(): void
  onSave(name: string): void
}): React.JSX.Element {
  const [name, setName] = useState(initial)
  const valid = name.trim().length > 0
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (valid) onSave(name)
      }}
    >
      <DialogTitle className="text-base font-medium text-foreground">Renomear desktop</DialogTitle>
      <DialogDescription className="text-xs text-muted-foreground">
        Um nome curto ajuda a achar: o projeto ou a atividade deste conjunto de abas.
      </DialogDescription>
      <TextField
        label="Nome do desktop"
        value={name}
        onChange={setName}
        maxLength={MAX_DESKTOP_NAME}
        autoFocus
      />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" disabled={!valid}>
          Salvar
        </Button>
      </div>
    </form>
  )
}
