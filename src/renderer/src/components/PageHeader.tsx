import { HStack } from '@astryxdesign/core/HStack'
import { Heading } from '@astryxdesign/core/Heading'
import { StackItem } from '@astryxdesign/core/Stack'
import { Text } from '@astryxdesign/core/Text'
import { VStack } from '@astryxdesign/core/VStack'

/**
 * Título da página (o único h1), contexto acima (ex.: nome do projeto), subtítulo e ações à
 * direita (no máximo uma primária; o resto num menu "Mais").
 */
export function PageHeader({
  title,
  subtitle,
  context,
  meta,
  action
}: {
  title: string
  subtitle?: string
  /** Linha curta acima do título, ex.: o projeto atual. */
  context?: string
  /** Metadados numa linha cinza separada por "·" (ex.: "Agendada · Projeto x · há 2 sem"). */
  meta?: ReadonlyArray<string | null | undefined | false>
  action?: React.ReactNode
}): React.JSX.Element {
  const metaLine = meta?.filter(Boolean).join(' · ')
  return (
    <HStack gap={4} vAlign="start" justify="between" wrap="wrap">
      <StackItem size="fill">
        <VStack gap={1}>
          {context && (
            <Text type="supporting" color="secondary" data-testid="page-context">
              {context}
            </Text>
          )}
          <Heading level={1}>{title}</Heading>
          {subtitle && <Text color="secondary">{subtitle}</Text>}
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
