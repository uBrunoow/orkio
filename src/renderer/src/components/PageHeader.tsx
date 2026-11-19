import { HStack } from '@astryxdesign/core/HStack'
import { Heading } from '@astryxdesign/core/Heading'
import { Text } from '@astryxdesign/core/Text'
import { VStack } from '@astryxdesign/core/VStack'

/** Título da página (h1), subtítulo e ação opcional à direita. */
export function PageHeader({
  title,
  subtitle,
  action
}: {
  title: string
  subtitle: string
  action?: React.ReactNode
}): React.JSX.Element {
  return (
    <HStack gap={4} vAlign="start" justify="between">
      <VStack gap={1}>
        <Heading level={1}>{title}</Heading>
        <Text color="secondary">{subtitle}</Text>
      </VStack>
      {action}
    </HStack>
  )
}
