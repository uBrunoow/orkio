import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { InfoIcon } from '../../components/icons'
import { InstallControls } from './InstallControls'
import { useUpdates } from './useUpdates'
import { WhatsNewDialog } from './WhatsNewDialog'
import { useIpcResource } from '../../lib/ipc'
import { isUpdateReady } from '../../lib/status-text'

/**
 * Topo do conteúdo: aviso discreto quando há atualização pronta (ou, no macOS sem assinatura,
 * disponível para baixar) e, uma vez depois de atualizar, o "O que há de novo" (modal).
 */
export function UpdateBanner({
  onOpenSettings
}: {
  onOpenSettings?: () => void
}): React.JSX.Element {
  const { status } = useUpdates()
  const [dismissed, setDismissed] = useState<string | null>(null)
  // Lido uma vez ao abrir (o main marca a versão como vista ao responder).
  const notes = useIpcResource('', () => window.orkio.updates.whatsNew())
  const whatsNew = notes.value
  const setWhatsNew = notes.set

  // Esperando para instalar: o aviso continua mesmo depois de "Agora não".
  const show = isUpdateReady(status) && (status.installWhenIdle || dismissed !== status.version)

  return (
    <>
      {show && status && (
        <div className="border-b border-border-soft px-4 py-3">
          <div
            role="status"
            data-testid="update-banner"
            className="flex items-start gap-2.5 rounded-lg border border-border bg-card px-3 py-2.5"
          >
            <InfoIcon className="mt-0.5 text-info" />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <div className="flex flex-col gap-0.5">
                <p className="text-sm font-medium text-foreground">
                  {status.mode === 'manual'
                    ? `Nova versão ${status.version} disponível`
                    : `Atualização ${status.version} pronta`}
                </p>
                <p className="text-xs text-muted-foreground">
                  {status.mode === 'manual'
                    ? 'Baixe e instale por cima da versão atual. Seus dados ficam.'
                    : 'Ela também é instalada quando você fechar o Orkio.'}
                </p>
              </div>
              <InstallControls status={status} />
            </div>
            {!status.installWhenIdle && (
              <div className="flex shrink-0 items-center gap-1">
                {onOpenSettings && (
                  <Button variant="ghost" size="sm" onClick={onOpenSettings}>
                    Detalhes
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={() => setDismissed(status.version)}>
                  Agora não
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
      {whatsNew && (
        <WhatsNewDialog
          notes={whatsNew}
          onClose={() => {
            setWhatsNew(null)
            void window.orkio.updates.markWhatsNewSeen()
          }}
        />
      )}
    </>
  )
}
