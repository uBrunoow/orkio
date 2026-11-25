import type { ORKIO_API } from '../../shared/ipc/api'
import type { Impl } from './register'
import type { ClaudeUsageService } from '../claude/usage'
import type { ConfigStore } from '../storage/config-store'
import type { OrkioConfig } from '../config/orkio-config'

/** Medidor de uso do Claude (Fase 0): o renderer só lê % e horários e liga/desliga o medidor. */
export function usageHandlers(
  usage: Pick<ClaudeUsageService, 'get' | 'reset'>,
  config: Pick<ConfigStore<OrkioConfig>, 'get' | 'update' | 'readOnly'>
): Impl<typeof ORKIO_API.usage> {
  const enabled = (): boolean => config.get().usageMeter !== false
  return {
    claude: async () => {
      if (!enabled()) return { enabled: false, usage: null }
      return { enabled: true, usage: await usage.get() }
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
