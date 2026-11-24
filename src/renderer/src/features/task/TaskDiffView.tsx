import { Skeleton } from '@/components/ui/skeleton'
import { Alert } from '../../components/Alert'
import { DiffView } from '../../components/DiffView'
import { useTaskDiff } from './task-view'

/**
 * Diff da tarefa (o mesmo para a execução, a pasta de trabalho, o gate e o "o que falta commitar"):
 * lido uma vez da tela da tarefa e relido a cada evento dela.
 */
export function TaskDiffView({
  label,
  secrets = false,
  onlyUncommitted = false
}: {
  label: string
  /** Avisa de segredo no diff (gate de aprovação). */
  secrets?: boolean
  onlyUncommitted?: boolean
}): React.JSX.Element {
  const { value, error } = useTaskDiff()
  if (!value) {
    return error ? (
      <Alert tone="danger">{error.message}</Alert>
    ) : (
      <Skeleton className="h-16" aria-label="Carregando o diff" />
    )
  }
  return (
    <>
      {secrets && value.secrets.length > 0 && (
        <Alert tone="danger">
          {`Parece haver um segredo (token, chave ou senha) em ${value.secrets.join(', ')}. O valor está escondido abaixo, mas aprovar segue com ele no código. Recuse e peça para remover, se não for de propósito.`}
        </Alert>
      )}
      {onlyUncommitted ? (
        <DiffView
          label={label}
          diff={value.diff}
          truncated={value.truncated}
          uncommitted={value.uncommitted}
          onlyUncommitted
        />
      ) : (
        <DiffView
          label={label}
          diff={value.diff}
          truncated={value.truncated}
          untracked={value.untracked}
        />
      )}
    </>
  )
}
