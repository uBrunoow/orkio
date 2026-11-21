import { HStack } from '@astryxdesign/core/HStack'
import { Heading } from '@astryxdesign/core/Heading'
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
  action
}: {
  title: string
  subtitle?: string
  /** Linha curta acima do título, ex.: o projeto atual. */
  context?: string
  action?: React.ReactNode
}): React.JSX.Element {
  return (
    <HStack gap={4} vAlign="start" justify="between" wrap="wrap">
      <VStack gap={1}>
        {context && (
          <Text type="supporting" color="secondary" data-testid="page-context">
            {context}
          </Text>
        )}
        <Heading level={1}>{title}</Heading>
        {subtitle && <Text color="secondary">{subtitle}</Text>}
      </VStack>
      {action}
    </HStack>
  )
}
