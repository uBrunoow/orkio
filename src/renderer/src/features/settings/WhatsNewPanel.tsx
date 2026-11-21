import { Button } from '@astryxdesign/core/Button'
import { Card } from '@astryxdesign/core/Card'
import { Heading } from '@astryxdesign/core/Heading'
import { HStack } from '@astryxdesign/core/HStack'
import { Item } from '@astryxdesign/core/Item'
import { List } from '@astryxdesign/core/List'
import { Text } from '@astryxdesign/core/Text'
import { VStack } from '@astryxdesign/core/VStack'
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
    <Card role="region" aria-labelledby="whats-new-title" data-testid="whats-new">
      <VStack gap={3}>
        <Heading level={2} id="whats-new-title">
          O que há de novo na versão {notes.version}
        </Heading>
        {groups.length === 0 ? (
          <Text color="secondary">Esta versão não trouxe notas.</Text>
        ) : (
          groups.map((g, i) =>
            g.type === 'heading' ? (
              <Heading level={3} key={i}>
                {g.text}
              </Heading>
            ) : g.type === 'paragraph' ? (
              <Text key={i}>{g.text}</Text>
            ) : (
              <List key={i} density="compact" aria-label="Mudanças">
                {g.items.map((text, j) => (
                  <Item as="li" key={j} label={text} />
                ))}
              </List>
            )
          )
        )}
        <HStack>
          <Button variant="primary" label={closeLabel} onClick={onClose} />
        </HStack>
      </VStack>
    </Card>
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
