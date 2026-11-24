import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/Spinner'
import type { BusyItem, UpdateStatus } from '../../../../shared/updates'
import { isUpdateReady } from '../../lib/status-text'

/**
 * Botões de instalar uma atualização pronta. Nunca reinicia por cima de trabalho em andamento sem
 * a pessoa escolher: mostra o que está rodando e oferece "quando terminar" ou "agora mesmo assim".
 * macOS sem assinatura: só "Baixar" (abre o DMG no navegador).
 */
export function InstallControls({ status }: { status: UpdateStatus }): React.JSX.Element | null {
  const [busy, setBusy] = useState<BusyItem[] | null>(null)
  const [working, setWorking] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function install(mode: 'if_idle' | 'now' | 'when_idle' | 'cancel_wait'): Promise<void> {
    setWorking(true)
    setMessage(null)
    try {
      const r = await window.orkio.updates.install(mode)
      if (r.state === 'busy') setBusy(r.busy)
      else if (r.state === 'unavailable') setMessage(r.message)
      else setBusy(null)
    } finally {
      setWorking(false)
    }
  }

  if (!isUpdateReady(status)) return null
  if (status.mode === 'manual') {
    return (
      <div className="flex">
        <Button onClick={() => void window.orkio.updates.openDownload()}>Baixar</Button>
      </div>
    )
  }

  if (status.installWhenIdle) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm text-foreground">
          Vai reiniciar e atualizar assim que tudo terminar.
        </p>
        <BusyList items={status.busy} />
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={working} onClick={() => void install('now')}>
            Atualizar agora mesmo assim
          </Button>
          <Button variant="ghost" disabled={working} onClick={() => void install('cancel_wait')}>
            Desistir de esperar
          </Button>
        </div>
      </div>
    )
  }

  if (busy) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm text-foreground">
          Ainda tem coisa rodando. Reiniciar agora cancelaria:
        </p>
        <BusyList items={busy} />
        <div className="flex flex-wrap gap-2">
          <Button disabled={working} onClick={() => void install('when_idle')}>
            Atualizar quando terminar
          </Button>
          <Button variant="outline" disabled={working} onClick={() => void install('now')}>
            Atualizar agora mesmo assim
          </Button>
          <Button variant="ghost" onClick={() => setBusy(null)}>
            Cancelar
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <Button disabled={working} onClick={() => void install('if_idle')}>
        {working && <Spinner />}
        Reiniciar e atualizar
      </Button>
      {message && <p className="text-sm text-muted-foreground">{message}</p>}
    </div>
  )
}

function BusyList({ items }: { items: BusyItem[] }): React.JSX.Element | null {
  if (items.length === 0) return null
  return (
    <ul
      aria-label="O que está rodando"
      className="flex flex-col divide-y divide-border-soft rounded-lg border border-border-soft bg-card"
    >
      {items.map((item, i) => (
        <li key={`${item.kind}-${i}`} className="px-3 py-1.5 text-sm text-foreground">
          {item.label}
        </li>
      ))}
    </ul>
  )
}
