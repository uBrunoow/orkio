import { createContext, useContext, useState } from 'react'
import { createPortal } from 'react-dom'
import { HStack } from '@astryxdesign/core/HStack'
import { StackItem } from '@astryxdesign/core/Stack'
import { Text } from '@astryxdesign/core/Text'
import { VStack } from '@astryxdesign/core/VStack'
import { Divider } from '@astryxdesign/core/Divider'

/**
 * Barra fina no topo de cada tela (mockup da reestruturação): à esquerda o caminho e o que a tela
 * põe ali (título, Kanban/Lista, fases da tarefa); à direita as ações da tela e o sino. A tela
 * preenche os encaixes com `<ScreenBarStart>`/`<ScreenBarEnd>` (portal), sem conhecer o App.
 */
interface Slots {
  start: HTMLElement | null
  end: HTMLElement | null
}

const SlotsContext = createContext<Slots>({ start: null, end: null })

export function ScreenBarStart({ children }: { children: React.ReactNode }): React.ReactNode {
  const { start } = useContext(SlotsContext)
  return start ? createPortal(children, start) : null
}

export function ScreenBarEnd({ children }: { children: React.ReactNode }): React.ReactNode {
  const { end } = useContext(SlotsContext)
  return end ? createPortal(children, end) : null
}

/** Caminho em texto cinza ("Configurações › Integrações"); o último trecho em texto normal. */
export function Crumbs({ parts }: { parts: readonly string[] }): React.JSX.Element {
  const last = parts.at(-1)
  return (
    <Text type="supporting" color="secondary" maxLines={1}>
      {parts.slice(0, -1).map((p) => `${p} › `)}
      <Text type="supporting">{last}</Text>
    </Text>
  )
}

/**
 * Moldura do conteúdo: a barra (caminho padrão do App + encaixes) e a tela embaixo, ocupando o
 * resto da altura.
 */
export function ScreenFrame({
  crumbs,
  bell,
  children
}: {
  /** Caminho padrão; uma tela que põe o próprio título no encaixe pode passar `null`. */
  crumbs: readonly string[] | null
  bell: React.ReactNode
  children: React.ReactNode
}): React.JSX.Element {
  const [start, setStart] = useState<HTMLElement | null>(null)
  const [end, setEnd] = useState<HTMLElement | null>(null)
  return (
    <SlotsContext.Provider value={{ start, end }}>
      <VStack height="100%">
        <HStack
          gap={4}
          vAlign="center"
          paddingInline={5}
          paddingBlock={2}
          minHeight="calc(var(--spacing-12) + var(--spacing-1))"
          data-testid="top-bar"
        >
          <StackItem size="fill">
            <HStack gap={4} vAlign="center">
              {crumbs && <Crumbs parts={crumbs} />}
              <HStack gap={3} vAlign="center" ref={setStart} />
            </HStack>
          </StackItem>
          <HStack gap={2} vAlign="center" ref={setEnd} />
          {bell}
        </HStack>
        <Divider />
        <StackItem size="fill">{children}</StackItem>
      </VStack>
    </SlotsContext.Provider>
  )
}
