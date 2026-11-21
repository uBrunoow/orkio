import { useEffect, useState } from 'react'
import { Banner } from '@astryxdesign/core/Banner'
import { Button } from '@astryxdesign/core/Button'
import { HStack } from '@astryxdesign/core/HStack'
import { VStack } from '@astryxdesign/core/VStack'
import type { ReleaseNotes } from '../../../../shared/updates'
import { InstallControls } from './InstallControls'
import { useUpdates } from './useUpdates'
import { WhatsNewPanel } from './WhatsNewPanel'

/**
 * Topo do conteúdo: aviso discreto quando há atualização pronta (ou, no macOS sem assinatura,
 * disponível para baixar) e, uma vez depois de atualizar, o "O que há de novo".
 */
export function UpdateBanner({
  onOpenSettings
}: {
  onOpenSettings?: () => void
}): React.JSX.Element | null {
  const { status } = useUpdates()
  const [dismissed, setDismissed] = useState<string | null>(null)
  const [whatsNew, setWhatsNew] = useState<ReleaseNotes | null>(null)

  useEffect(() => {
    let alive = true
    void window.orkio.updates.whatsNew().then((n) => {
      if (alive) setWhatsNew(n)
    })
    return () => {
      alive = false
    }
  }, [])

  const ready =
    status &&
    status.version &&
    ((status.mode === 'auto' && status.phase === 'downloaded') ||
      (status.mode === 'manual' && status.phase === 'available'))
  // Esperando para instalar: o aviso continua mesmo depois de "Agora não".
  const show = ready && (status.installWhenIdle || dismissed !== status.version)

  if (!show && !whatsNew) return null
  return (
    <VStack gap={3}>
      {show && status && (
        <VStack role="status" data-testid="update-banner">
          <Banner
            status="info"
            title={
              status.mode === 'manual'
                ? `Nova versão ${status.version} disponível`
                : `Atualização ${status.version} pronta`
            }
            description={
              status.mode === 'manual'
                ? 'Baixe e instale por cima da versão atual. Seus dados ficam.'
                : 'Ela também é instalada quando você fechar o Orkio.'
            }
            collapsible={false}
            endContent={
              status.installWhenIdle ? undefined : (
                <HStack gap={2} vAlign="center">
                  {onOpenSettings && (
                    <Button variant="ghost" size="sm" label="Detalhes" onClick={onOpenSettings} />
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    label="Agora não"
                    onClick={() => setDismissed(status.version)}
                  />
                </HStack>
              )
            }
          >
            <InstallControls status={status} />
          </Banner>
        </VStack>
      )}
      {whatsNew && (
        <WhatsNewPanel
          notes={whatsNew}
          onClose={() => {
            setWhatsNew(null)
            void window.orkio.updates.markWhatsNewSeen()
          }}
        />
      )}
    </VStack>
  )
}
