import { Button } from '@astryxdesign/core/Button'
import { HStack } from '@astryxdesign/core/HStack'
import { Icon } from '@astryxdesign/core/Icon'
import { Item } from '@astryxdesign/core/Item'
import { VStack } from '@astryxdesign/core/VStack'
import type { SvgIcon } from '../../components/icons'
import { StatusToken, type StatusTone } from '../../components/StatusToken'

/**
 * Uma linha de Integrações: logo, nome, o que o Orkio faz com o serviço, estado e a ação. A ação
 * abre o fluxo de conexão/configuração dentro da própria linha (`children`); `sub` = linhas
 * recuadas (ex.: Bancos e campos, abaixo do Notion).
 */
export function IntegrationRow({
  id,
  logo,
  name,
  purpose,
  status,
  action,
  isOpen,
  onToggle,
  children,
  sub
}: {
  id: string
  logo: SvgIcon | null
  name: string
  purpose: string
  status: { label: string; tone: StatusTone }
  action: string
  isOpen: boolean
  onToggle(): void
  children?: React.ReactNode
  sub?: React.ReactNode
}): React.JSX.Element {
  return (
    <VStack role="listitem" aria-label={name} data-testid={`catalog-${id}`}>
      <Item
        density="spacious"
        label={name}
        description={purpose}
        descriptionLines={2}
        {...(logo ? { startContent: <Icon icon={logo} size="lg" /> } : {})}
        endContent={
          <HStack gap={4} vAlign="center">
            <StatusToken label={status.label} tone={status.tone} data-testid="integration-status" />
            <Button
              size="sm"
              variant={isOpen ? 'ghost' : 'secondary'}
              label={isOpen ? 'Fechar' : action}
              aria-label={`${isOpen ? 'Fechar' : action} ${name}`}
              aria-expanded={isOpen}
              onClick={onToggle}
            />
          </HStack>
        }
      />
      {isOpen && children && (
        <VStack padding={4} data-integration={id}>
          {children}
        </VStack>
      )}
      {sub && <VStack paddingInlineStart={10}>{sub}</VStack>}
    </VStack>
  )
}
