import { Button } from '@/components/ui/button'
import { noteBlocks, type NoteBlock, type ReleaseNotes } from '../../../../shared/updates'

/** "O que há de novo": notas da versão (do CHANGELOG embutido), em texto simples. */
export function WhatsNewPanel({
  notes,
  onClose,
  closeLabel = 'Entendi'
}: {
  notes: ReleaseNotes
  onClose(): void
  closeLabel?: string
}): React.JSX.Element {
  const groups = groupBlocks(noteBlocks(notes.notes))
  return (
    <section
      aria-labelledby="whats-new-title"
      data-testid="whats-new"
      className="flex flex-col gap-3 rounded-xl border border-border-soft bg-card p-5"
    >
      <h2 id="whats-new-title" className="text-sm font-medium text-foreground">
        O que há de novo na versão {notes.version}
      </h2>
      {groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">Esta versão não trouxe notas.</p>
      ) : (
        groups.map((g, i) =>
          g.type === 'heading' ? (
            <h3
              key={i}
              className="pt-1 text-xs font-medium tracking-[0.06em] text-muted-foreground uppercase"
            >
              {g.text}
            </h3>
          ) : g.type === 'paragraph' ? (
            <p key={i} className="text-sm text-foreground">
              {g.text}
            </p>
          ) : (
            <ul key={i} aria-label="Mudanças" className="flex flex-col gap-1 pl-1">
              {g.items.map((text, j) => (
                <li key={j} className="flex gap-2 text-sm text-foreground">
                  <span aria-hidden="true" className="text-subtle-foreground">
                    •
                  </span>
                  <span className="min-w-0">{text}</span>
                </li>
              ))}
            </ul>
          )
        )
      )}
      <div className="flex">
        <Button onClick={onClose}>{closeLabel}</Button>
      </div>
    </section>
  )
}

type Group =
  | { type: 'heading'; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; items: string[] }

function groupBlocks(blocks: NoteBlock[]): Group[] {
  const out: Group[] = []
  for (const b of blocks) {
    const last = out.at(-1)
    if (b.type === 'item') {
      if (last?.type === 'list') last.items.push(b.text)
      else out.push({ type: 'list', items: [b.text] })
    } else {
      out.push(b)
    }
  }
  return out
}
