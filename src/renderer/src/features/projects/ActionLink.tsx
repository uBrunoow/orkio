import { Link } from '@astryxdesign/core/Link'
import type { ProjectAction } from '../../../../shared/ipc-contract'

/** Link externo sugerido pelo main (ex.: aprovar acesso da organização). Abre no navegador. */
export function ActionLink({ action }: { action: ProjectAction }): React.JSX.Element {
  return (
    <Link
      label={`${action.label} ↗`}
      weight="semibold"
      onClick={() => void window.orkio.openExternal(action.url)}
    >
      {action.label} ↗
    </Link>
  )
}
