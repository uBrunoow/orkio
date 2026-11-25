import type { ORKIO_API } from '../../shared/ipc/api'
import type { Impl } from './register'
import type { ClaudeUsageService } from '../claude/usage'
import type { ConfigStore } from '../storage/config-store'
import type { OrkioConfig } from '../config/orkio-config'
import { USAGE_HOLD_DEFAULT, type UsageHold } from '../../shared/claude-usage'

/** Medidor de uso do Claude (Fase 0): o renderer só lê % e horários e liga/desliga o medidor. */
export function usageHandlers(
  usage: Pick<ClaudeUsageService, 'get' | 'reset'>,
  config: Pick<ConfigStore<OrkioConfig>, 'get' | 'update' | 'readOnly'>
): Impl<typeof ORKIO_API.usage> {
  const enabled = (): boolean => config.get().usageMeter !== false
  const hold = (): UsageHold => config.get().usageHold ?? USAGE_HOLD_DEFAULT
  return {
    claude: async () => {
      if (!enabled()) return { enabled: false, usage: null, hold: hold() }
      return { enabled: true, usage: await usage.get(), hold: hold() }
    },
    setHold: async (next) => {
      if (config.readOnly) return hold()
      await config.update((c) => ({ ...c, usageHold: next }))
      return hold()
    },
    setEnabled: async (on) => {
      if (config.readOnly) return enabled()
      await config.update((c) => {
        const next = { ...c }
        if (on) delete next.usageMeter
        else next.usageMeter = false
        return next
      })
      usage.reset()
      return enabled()
    }
  }
}
