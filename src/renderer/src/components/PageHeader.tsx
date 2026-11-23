import { ScreenTitle } from './ScreenTitle'
import { HStack } from '@astryxdesign/core/HStack'
import { StackItem } from '@astryxdesign/core/Stack'
import { Text } from '@astryxdesign/core/Text'
import { VStack } from '@astryxdesign/core/VStack'

/**
 * Título da seção (o único h1, em tamanho de seção como no mockup), uma linha de descrição e
 * ações à direita (no máximo uma primária). O projeto vai no caminho da barra, não aqui.
 */
export function PageHeader({
  title,
  subtitle,
  meta,
  action
}: {
  title: string
  subtitle?: string
  /** Metadados numa linha cinza separada por "·" (ex.: "Agendada · Projeto x · há 2 sem"). */
  meta?: ReadonlyArray<string | null | undefined | false>
  action?: React.ReactNode
}): React.JSX.Element {
  const metaLine = meta?.filter(Boolean).join(' · ')
  return (
    <HStack gap={4} vAlign="start" justify="between" wrap="wrap">
      <StackItem size="fill">
        <VStack gap={1}>
          {/* O contexto (projeto) já aparece no caminho da barra: aqui só o título. */}
          <ScreenTitle look={3}>{title}</ScreenTitle>
          {subtitle && (
            <Text type="supporting" color="secondary">
              {subtitle}
            </Text>
          )}
          {metaLine && (
            <Text type="supporting" color="secondary" data-testid="page-meta">
              {metaLine}
            </Text>
          )}
        </VStack>
      </StackItem>
      {action}
    </HStack>
  )
}
