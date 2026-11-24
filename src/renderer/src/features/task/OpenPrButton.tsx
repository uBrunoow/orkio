import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/Spinner'
import { Alert } from '../../components/Alert'
import { ExternalLinkIcon, PullRequestIcon } from '../../components/icons'
import { useTaskView } from './task-view'

/** Link "Criar a PR no GitHub" e erro do "Abrir PR" (iguais no botão e no recibo do bloqueio). */
export function OpenPrFeedback(): React.JSX.Element {
  const { compareUrl, started, error, setError } = useTaskView().openPr
  return (
    <>
      {compareUrl && (
        <p className="text-xs text-muted-foreground">
          {started
            ? 'Sem task do Backlog.md vinculada, o Orkio só envia a branch (aprove o push na conversa). Depois, '
            : 'A branch já está no GitHub e não há task do Backlog.md vinculada. '}
          <button
            type="button"
            className="inline-flex items-center gap-1 text-foreground underline underline-offset-2"
            onClick={() =>
              void window.orkio.openExternal(compareUrl).then((ok) => {
                if (!ok) setError('Não foi possível abrir o GitHub. Abra a página da branch à mão.')
              })
            }
          >
            Criar a PR no GitHub
            <ExternalLinkIcon className="size-3" />
          </button>
        </p>
      )}
      {error && <Alert tone="danger">{error}</Alert>}
    </>
  )
}

/**
 * Botão "Abrir PR" (aba PR & CI, Ambiente, recibo do bloqueio de push): o mesmo estado nos três.
 * `hint` mostra "Espere o fluxo atual terminar" ao lado quando um fluxo está em andamento.
 */
export function OpenPrButton({
  size = 'default',
  hint = true
}: {
  size?: 'default' | 'sm'
  hint?: boolean
}): React.JSX.Element {
  const pr = useTaskView().openPr
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size={size} disabled={pr.busy || pr.blocked} onClick={() => void pr.start()}>
        {pr.busy ? <Spinner /> : <PullRequestIcon />}
        Abrir PR
      </Button>
      {hint && pr.blocked && (
        <span className="text-xs text-muted-foreground">Espere o fluxo atual terminar</span>
      )}
    </div>
  )
}
