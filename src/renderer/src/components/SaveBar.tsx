import { Button } from '@astryxdesign/core/Button'
import { Card } from '@astryxdesign/core/Card'
import { HStack } from '@astryxdesign/core/HStack'
import { StackItem } from '@astryxdesign/core/Stack'
import { Text } from '@astryxdesign/core/Text'
import { VStack } from '@astryxdesign/core/VStack'

/**
 * Barra de salvar fixa no rodapé da página (6E): quantas alterações há, Descartar e a ação
 * primária. Use como último filho da página (o `position: sticky` depende disso). Avisos e erros
 * que bloqueiam o salvar entram em `children`, acima dos botões.
 */
export function SaveBar({
  label,
  changes,
  saveLabel,
  isSaving,
  isDisabled,
  onSave,
  onDiscard,
  children
}: {
  /** Nome acessível da região. */
  label: string
  changes: number
  saveLabel: string
  isSaving: boolean
  isDisabled: boolean
  onSave(): void
  onDiscard(): void
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <Card
      role="region"
      aria-label={label}
      padding={3}
      style={{
        position: 'sticky',
        insetBlockEnd: 0,
        zIndex: 1,
        boxShadow: 'var(--shadow-high)'
      }}
    >
      <VStack gap={2}>
        {children}
        <HStack gap={2} vAlign="center" wrap="wrap">
          <Text type="supporting" data-testid="unsaved-changes">
            {changes === 0
              ? 'Nenhuma alteração'
              : changes === 1
                ? '1 alteração não salva'
                : `${changes} alterações não salvas`}
          </Text>
          <StackItem size="fill" />
          <Button
            variant="ghost"
            label="Descartar alterações"
            isDisabled={changes === 0}
            onClick={onDiscard}
          />
          <Button
            variant="primary"
            label={saveLabel}
            isLoading={isSaving}
            isDisabled={isDisabled}
            onClick={onSave}
          />
        </HStack>
      </VStack>
    </Card>
  )
}
