import { useState } from 'react'
import { Button } from '@astryxdesign/core/Button'
import { HStack } from '@astryxdesign/core/HStack'
import { Text } from '@astryxdesign/core/Text'
import { VStack } from '@astryxdesign/core/VStack'
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
  onSkip(): void
  onCancel(): void
  /** Abre a sessão (log) da execução do passo parado. */
  onOpenRun?: (runId: string) => void
}): React.JSX.Element {
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
    <VStack gap={3} role="group" aria-label="Problema no fluxo">
      <Alert tone="warning">{problem.title}.</Alert>
      {problem.reason && (
        <VStack gap={1}>
          <Text type="supporting">O que o Orkio registrou</Text>
          <Text>{problem.reason}</Text>
        </VStack>
      )}
      <Text>{problem.hint}</Text>
      <HStack gap={2} wrap="wrap">
        {problem.rerun && (
          <Button
            size="sm"
            variant="primary"
            label={problem.rerun.label}
            isLoading={busy}
            onClick={() => onRerun(problem.rerun!.stepId)}
          />
        )}
        <Button
          size="sm"
          variant={problem.rerun ? 'secondary' : 'primary'}
          label="Retomar deste passo"
          isLoading={busy}
          onClick={onResume}
        />
        {problem.kind === 'uncommitted' && (
          <Button
            size="sm"
            variant="secondary"
            label={showChanges ? 'Esconder o que falta commitar' : 'Ver o que falta commitar'}
            onClick={() => void toggleChanges()}
          />
        )}
        {problem.runId && onOpenRun && (
          <Button
            size="sm"
            variant="secondary"
            label="Ver a sessão do passo"
            onClick={() => onOpenRun(problem.runId!)}
          />
        )}
        <Button size="sm" variant="secondary" label="Pular" onClick={onSkip} />
        <Button size="sm" variant="ghost" label="Cancelar fluxo" onClick={onCancel} />
      </HStack>
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
    </VStack>
  )
}
