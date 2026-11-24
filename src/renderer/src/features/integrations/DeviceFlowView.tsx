import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/Spinner'
import { ExternalLinkIcon } from '../../components/icons'
import type { DeviceFlowInfo } from '../../../../shared/connection'

export function DeviceFlowView({
  flow,
  onCancel
}: {
  flow: DeviceFlowInfo | null
  onCancel: () => Promise<void>
}): React.JSX.Element {
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle')
  const remaining = useCountdown(flow?.expiresAt ?? null)

  if (!flow) {
    return (
      <div role="status" className="flex items-center gap-2.5 text-sm text-foreground">
        <Spinner label="Aguardando" />
        Pedindo um código ao GitHub…
      </div>
    )
  }

  async function copyCode(): Promise<void> {
    try {
      await navigator.clipboard.writeText(flow!.userCode)
      setCopy('copied')
    } catch {
      setCopy('failed')
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Abra o GitHub, digite o código abaixo e clique em{' '}
        <span className="font-semibold text-foreground">Authorize</span>. O Orkio conecta sozinho
        assim que você autorizar.
      </p>
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border-soft bg-surface px-4 py-3">
        <span aria-label={`Código: ${flow.userCode}`} className="text-2xl tracking-[0.12em]">
          <code data-testid="device-code" className="font-mono font-medium text-foreground">
            {flow.userCode}
          </code>
        </span>
        <Button variant="outline" onClick={() => void copyCode()}>
          {copy === 'copied' ? 'Copiado' : 'Copiar'}
        </Button>
      </div>
      {copy === 'failed' && (
        <p className="text-xs text-muted-foreground">
          Não foi possível copiar. Selecione o código e copie à mão.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => void window.orkio.openExternal(flow.verificationUri)}>
          <ExternalLinkIcon />
          Abrir GitHub
        </Button>
        <Button variant="outline" onClick={() => void onCancel()}>
          Cancelar
        </Button>
        <div className="flex items-center gap-2" role="timer">
          <Spinner label="Aguardando autorização" className="text-muted-foreground" />
          <span className="text-xs text-muted-foreground">
            {remaining > 0
              ? `Aguardando · expira em ${formatRemaining(remaining)}`
              : 'Código expirado'}
          </span>
        </div>
      </div>
    </div>
  )
}

/** Segundos restantes até `expiresAt`, atualizado a cada segundo. */
function useCountdown(expiresAt: string | null): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!expiresAt) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [expiresAt])

  return expiresAt ? Math.max(0, Math.round((Date.parse(expiresAt) - now) / 1000)) : 0
}

function formatRemaining(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}
