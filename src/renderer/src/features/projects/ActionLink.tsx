import type { ProjectAction } from '../../../../shared/ipc-contract'

/** Link externo sugerido pelo main (ex.: aprovar acesso da organização). Abre no navegador. */
export function ActionLink({ action }: { action: ProjectAction }): React.JSX.Element {
  return (
    <button
      type="button"
      className="link-button action-link"
      onClick={() => void window.orkio.openExternal(action.url)}
    >
      {action.label} ↗
    </button>
  )
}
