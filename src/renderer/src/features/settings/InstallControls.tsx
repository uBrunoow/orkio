import { useState } from 'react'
import { Button } from '@astryxdesign/core/Button'
import { HStack } from '@astryxdesign/core/HStack'
import { Item } from '@astryxdesign/core/Item'
import { List } from '@astryxdesign/core/List'
import { Text } from '@astryxdesign/core/Text'
import { VStack } from '@astryxdesign/core/VStack'
import type { BusyItem, UpdateStatus } from '../../../../shared/updates'

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

  if (status.mode === 'manual' && status.phase === 'available') {
    return (
      <Button
        variant="primary"
        label="Baixar"
        onClick={() => void window.orkio.updates.openDownload()}
      />
    )
  }
  if (status.mode !== 'auto' || status.phase !== 'downloaded') return null

  if (status.installWhenIdle) {
    return (
      <VStack gap={2}>
        <Text>Vai reiniciar e atualizar assim que tudo terminar.</Text>
        <BusyList items={status.busy} />
        <HStack gap={2} wrap="wrap">
          <Button
            label="Atualizar agora mesmo assim"
            isDisabled={working}
            onClick={() => void install('now')}
          />
          <Button
            variant="ghost"
            label="Desistir de esperar"
            isDisabled={working}
            onClick={() => void install('cancel_wait')}
          />
        </HStack>
      </VStack>
    )
  }

  if (busy) {
    return (
      <VStack gap={2}>
        <Text>Ainda tem coisa rodando. Reiniciar agora cancelaria:</Text>
        <BusyList items={busy} />
        <HStack gap={2} wrap="wrap">
          <Button
            variant="primary"
            label="Atualizar quando terminar"
            isDisabled={working}
            onClick={() => void install('when_idle')}
          />
          <Button
            label="Atualizar agora mesmo assim"
            isDisabled={working}
            onClick={() => void install('now')}
          />
          <Button variant="ghost" label="Cancelar" onClick={() => setBusy(null)} />
        </HStack>
      </VStack>
    )
  }

  return (
    <VStack gap={1}>
      <Button
        variant="primary"
        label="Reiniciar e atualizar"
        isLoading={working}
        onClick={() => void install('if_idle')}
      />
      {message && <Text color="secondary">{message}</Text>}
    </VStack>
  )
}

function BusyList({ items }: { items: BusyItem[] }): React.JSX.Element | null {
  if (items.length === 0) return null
  return (
    <List hasDividers density="compact" aria-label="O que está rodando">
      {items.map((item, i) => (
        <Item as="li" key={`${item.kind}-${i}`} label={item.label} />
      ))}
    </List>
  )
}
