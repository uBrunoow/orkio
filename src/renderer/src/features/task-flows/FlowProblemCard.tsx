import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { TextAreaField } from '@/components/form'
import { Spinner } from '@/components/Spinner'
import { ProblemIcon } from '@/components/icons'
import type { ClaudeDiff } from '../../../../shared/agent-run'
import type { FlowProblem } from '../../../../shared/flow-problem'
import { Alert } from '../../components/Alert'
import { DiffView } from '../../components/DiffView'

/**
 * Fluxo parado por um problema: o que o Orkio registrou, o que isso quer dizer e as saídas
 * (retomar, rodar de novo o passo anterior, ver a sessão ou o que falta commitar, pular, cancelar).
 */
export function FlowProblemCard({
  projectId,
  taskId,
  problem,
  busy,
  onResume,
  onRerun,
  onReply,
  onSkip,
  onCancel,
  onOpenRun
}: {
  projectId: string
  taskId: string
  problem: FlowProblem
  busy: boolean
  onResume(): void
  onRerun(stepId: string): void
  /** Responde ao Claude e continua na mesma sessão do passo (só com a execução do passo). */
  onReply(text: string): void
  onSkip(): void
  onCancel(): void
  /** Abre a sessão (log) da execução do passo parado. */
  onOpenRun?: (runId: string) => void
}): React.JSX.Element {
  const [reply, setReply] = useState('')
  const [showChanges, setShowChanges] = useState(false)
  const [changes, setChanges] = useState<ClaudeDiff | { error: string } | null>(null)

  const toggleChanges = async (): Promise<void> => {
    if (showChanges) {
      setShowChanges(false)
      return
    }
    setShowChanges(true)
    if (changes) return
    const r = await window.orkio.claude.diff(projectId, taskId)
    setChanges(r.ok ? r.value : { error: r.error.message })
  }

  return (
    <div
      role="group"
      aria-label="Problema no fluxo"
      className="flex flex-col gap-3 rounded-[10px] border border-danger-tint-border bg-danger-tint p-3.5"
    >
      <p className="flex items-center gap-2 font-medium">
        <ProblemIcon className="text-danger" />
        {problem.title}.
      </p>
      {problem.reason && (
        <div className="flex flex-col gap-1">
          <p className="text-xs text-muted-foreground">O que o Orkio registrou</p>
          <p className="text-sm break-words text-foreground">{problem.reason}</p>
        </div>
      )}
      <p className="text-sm text-muted-foreground">{problem.hint}</p>
      {problem.runId && (
        <div className="flex flex-col gap-2">
          <TextAreaField
            label="Responder ao Claude"
            description="Vai na mesma sessão do passo, sem rodar o comando do zero. Ex.: as respostas das perguntas que ficaram em aberto."
            value={reply}
            onChange={setReply}
            rows={3}
          />
          <div className="flex">
            <Button
              size="sm"
              disabled={busy || !reply.trim()}
              onClick={() => {
                onReply(reply.trim())
                setReply('')
              }}
            >
              {busy && <Spinner />}
              Responder e continuar
            </Button>
          </div>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {problem.rerun && (
          <Button size="sm" disabled={busy} onClick={() => onRerun(problem.rerun!.stepId)}>
            {busy && <Spinner />}
            {problem.rerun.label}
          </Button>
        )}
        <Button
          size="sm"
          variant={problem.rerun ? 'outline' : 'default'}
          disabled={busy}
          onClick={onResume}
        >
          {busy && <Spinner />}
          Retomar deste passo
        </Button>
        {problem.kind === 'uncommitted' && (
          <Button size="sm" variant="outline" onClick={() => void toggleChanges()}>
            {showChanges ? 'Esconder o que falta commitar' : 'Ver o que falta commitar'}
          </Button>
        )}
        {problem.runId && onOpenRun && (
          <Button size="sm" variant="outline" onClick={() => onOpenRun(problem.runId!)}>
            Ver a sessão do passo
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={onSkip}>
          Pular
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancelar fluxo
        </Button>
      </div>
      {showChanges &&
        changes &&
        ('error' in changes ? (
          <Alert tone="danger">{changes.error}</Alert>
        ) : (
          <DiffView
            label="O que falta commitar"
            diff={changes.diff}
            truncated={changes.truncated}
            uncommitted={changes.uncommitted}
            onlyUncommitted
          />
        ))}
    </div>
  )
}
