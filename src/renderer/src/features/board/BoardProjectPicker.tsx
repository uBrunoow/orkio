import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { CheckboxField } from '@/components/form'
import { SwitchIcon } from '../../components/icons'

export interface PickerProject {
  id: string
  name: string
}

/**
 * Seletor de projetos do Quadro: um, vários ou todos os projetos vinculados. O último marcado não
 * desmarca; desmarcar "Todos os projetos" deixa só o projeto atual (`current`).
 */
export function BoardProjectPicker({
  projects,
  selection,
  all,
  current,
  onChange
}: {
  /** Projetos vinculados ao Notion. */
  projects: readonly PickerProject[]
  /** Ids escolhidos agora (com `all`, todos). */
  selection: readonly string[]
  all: boolean
  /** Projeto atual do app (o que fica ao desmarcar "Todos"). */
  current: string | null
  onChange(next: { projectIds: string[] | 'all' }): void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const chosen = all ? projects.map((p) => p.id) : selection.filter((id) => projectOf(id))
  const label = all
    ? 'Todos os projetos'
    : chosen.length === 1
      ? (projectOf(chosen[0]!)?.name ?? '1 projeto')
      : `${chosen.length} projetos`

  function projectOf(id: string): PickerProject | undefined {
    return projects.find((p) => p.id === id)
  }

  function toggle(id: string, checked: boolean): void {
    const next = checked ? [...chosen, id] : chosen.filter((x) => x !== id)
    if (next.length === 0) return
    // Na ordem da lista de projetos (a mesma das colunas e do menu).
    onChange({ projectIds: projects.map((p) => p.id).filter((x) => next.includes(x)) })
  }

  function toggleAll(checked: boolean): void {
    if (checked) {
      onChange({ projectIds: 'all' })
      return
    }
    const keep = (current && projectOf(current)?.id) ?? projects[0]?.id
    if (keep) onChange({ projectIds: [keep] })
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          aria-label="Projetos do quadro"
          aria-haspopup="dialog"
          className="max-w-56 gap-1.5"
        >
          <span className="truncate">{label}</span>
          <SwitchIcon className="size-3.5 text-subtle-foreground" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-2">
        <div role="group" aria-label="Projetos do quadro" className="flex flex-col gap-2">
          <CheckboxField label="Todos os projetos" checked={all} onChange={toggleAll} />
          <div className="flex flex-col gap-2 border-t border-border-soft pt-2">
            {projects.map((p) => {
              const checked = chosen.includes(p.id)
              return (
                <CheckboxField
                  key={p.id}
                  label={p.name}
                  checked={checked}
                  disabled={checked && chosen.length === 1}
                  onChange={(v) => toggle(p.id, v)}
                />
              )
            })}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
