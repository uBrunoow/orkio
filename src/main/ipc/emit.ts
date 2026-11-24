import type { WebContents } from 'electron'
import { IPC_EVENTS, type IpcEventName, type IpcEventPayload } from '../../shared/ipc/api'
import type { EventEffect } from '../../shared/ipc/define'

/** Envia um evento declarado em `IPC_EVENTS` a todas as janelas (e aplica os efeitos no main). */
export type Emit = <K extends IpcEventName>(name: K, payload: IpcEventPayload<K>) => void

export interface EmitterDeps {
  windows(): { isDestroyed(): boolean; webContents: Pick<WebContents, 'send'> }[]
  /** O que cada efeito faz no main (recalcular "Esperando você", reavaliar "manter acordado"). */
  effects: Record<EventEffect, () => void>
}

export function createEmitter(deps: EmitterDeps): Emit {
  return (name, payload) => {
    const spec = IPC_EVENTS[name]
    for (const win of deps.windows()) {
      if (!win.isDestroyed()) win.webContents.send(spec.channel, payload)
    }
    const when = (spec as { affectsWhen?: (p: typeof payload) => boolean }).affectsWhen
    if (!when || when(payload)) {
      for (const effect of (spec as { affects?: readonly EventEffect[] }).affects ?? []) {
        deps.effects[effect]()
      }
    }
  }
}
