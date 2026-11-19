import { Banner } from '@astryxdesign/core/Banner'
import { VStack } from '@astryxdesign/core/VStack'

/**
 * Mensagem de erro/aviso. Erros são `role="alert"` (urgente); avisos, `role="status"`.
 * O papel fica num container único (o Banner o repetiria no título e na descrição).
 * `action`: link/botão ao lado da mensagem (ex.: abrir configurações de acesso).
 */
export function Alert({
  tone,
  children,
  action
}: {
  tone: 'danger' | 'warning'
  children: React.ReactNode
  action?: React.ReactNode
}): React.JSX.Element {
  return (
    <VStack role={tone === 'danger' ? 'alert' : 'status'}>
      <Banner
        status={tone === 'danger' ? 'error' : 'warning'}
        title={children}
        collapsible={false}
        {...(action ? { endContent: action } : {})}
      />
    </VStack>
  )
}
