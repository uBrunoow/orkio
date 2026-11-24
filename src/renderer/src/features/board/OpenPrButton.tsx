import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/Spinner'
import { Alert } from '../../components/Alert'
import { ExternalLinkIcon, PullRequestIcon } from '../../components/icons'

/**
 * "Abrir PR" (entrega avulsa) na aba PR & CI: inicia o push (com o gate de sempre) e o
 * /alva-flow:pr em modo entrega, sem rodar o fluxo todo de novo. Sem task do Backlog.md vinculada,
 * só o push, e depois o link "Criar a PR no GitHub" (comparação montada no main).
 */
export function useOpenPr(
  projectId: string,
  taskId: string
): {
  busy: boolean
  error: string | null
  compareUrl: string | null
  started: boolean
  start(): Promise<void>
  setError(message: string | null): void
} {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [compareUrl, setCompareUrl] = useState<string | null>(null)
  const [started, setStarted] = useState(true)

  async function start(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      const r = await window.orkio.taskFlows.openPr(projectId, taskId)
      if (r.ok) {
        setCompareUrl(r.value.compareUrl)
        setStarted(r.value.started)
      } else setError(r.error.message)
    } catch {
      setError('Não foi possível começar. Tente novamente.')
    } finally {
      setBusy(false)
    }
  }

  return { busy, error, compareUrl, started, start, setError }
}

/** Link "Criar a PR no GitHub" e erro do "Abrir PR" (iguais no botão e no recibo do bloqueio). */
export function OpenPrFeedback({
  state
}: {
  state: ReturnType<typeof useOpenPr>
}): React.JSX.Element {
  const { compareUrl, started, error, setError } = state
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

export function OpenPrButton({
  projectId,
  taskId,
  flowActive
}: {
  projectId: string
  taskId: string
  /** Há um fluxo ativo na tarefa (uma execução por vez). */
  flowActive: boolean
}): React.JSX.Element {
  const pr = useOpenPr(projectId, taskId)

  return (
    <div className="flex flex-col gap-2" data-panel-section="open-pr">
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={pr.busy || flowActive} onClick={() => void pr.start()}>
          {pr.busy ? <Spinner /> : <PullRequestIcon />}
          Abrir PR
        </Button>
        {flowActive && (
          <span className="text-xs text-muted-foreground">Espere o fluxo atual terminar</span>
        )}
      </div>
      <OpenPrFeedback state={pr} />
    </div>
  )
}

/** Quando "Abrir PR" vale: sem PR ou com a PR fechada (a mesma regra na aba PR & CI e no Ambiente). */
export function canOpenPr(pr: { state: string } | null | undefined): boolean {
  return !pr || pr.state === 'closed'
}
