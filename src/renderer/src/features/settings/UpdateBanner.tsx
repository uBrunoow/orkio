import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { InfoIcon } from '../../components/icons'
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
    <div className="flex flex-col gap-3 border-b border-border-soft px-4 py-3">
      {show && status && (
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
    </div>
  )
}
