import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table'
import type { Execution } from './executions'
import { EditIcon } from './icons'
import { StatusToken } from './StatusToken'
import { Timestamp } from './Timestamp'

export function SentenceDetail({
  label,
  sentence,
  starts,
  does,
  executions,
  details,
  actions,
  onEdit,
  compactSentence = false
}: {
  /** A frase vira um resumo pequeno (quando já há um "o que faz" em cima, ex.: Fluxos). */
  compactSentence?: boolean
  label: string
  sentence: string
  starts: React.ReactNode
  does: React.ReactNode
  executions: React.ReactNode
  details: readonly { label: string; value: React.ReactNode }[]
  actions?: React.ReactNode
  onEdit(): void
}): React.JSX.Element {
  return (
    <section
      role="region"
      aria-label={label}
      className="flex flex-col gap-5 rounded-xl border border-border-soft bg-card p-4"
    >
      <div className="flex items-start gap-3">
        <h2
          className={
            compactSentence
              ? 'min-w-0 flex-1 font-mono text-xs text-muted-foreground'
              : 'min-w-0 flex-1 text-base font-medium'
          }
          data-testid="detail-sentence"
        >
          {sentence}
        </h2>
        <div className="flex items-center gap-1">
          {actions}
          <Button variant="outline" onClick={onEdit}>
            <EditIcon />
            Editar
          </Button>
        </div>
      </div>
      <div className="flex items-start gap-6">
        <div className="flex min-w-0 flex-1 flex-col gap-5">
          <div role="group" aria-label="Começa" className="flex flex-col gap-2">
            <h3 className="text-xs font-medium text-muted-foreground">Começa</h3>
            {starts}
          </div>
          <div role="group" aria-label="Faz" className="flex flex-col gap-2">
            <h3 className="text-xs font-medium text-muted-foreground">Faz</h3>
            {does}
          </div>
          <div role="group" aria-label="Execuções" className="flex flex-col gap-2">
            <h3 className="text-xs font-medium text-muted-foreground">Execuções</h3>
            {executions}
          </div>
        </div>
        <div
          role="group"
          aria-label="Detalhes"
          data-testid="detail-column"
          className="flex w-48 shrink-0 flex-col gap-3 border-l border-border-soft pl-4"
        >
          {details.map((d) => (
            <div key={d.label} className="flex flex-col gap-0.5">
              <p className="text-xs text-muted-foreground">{d.label}</p>
              {typeof d.value === 'string' ? <p>{d.value}</p> : d.value}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

export function ExecutionsTable({
  executions,
  empty
}: {
  executions: readonly Execution[] | null
  empty: string
}): React.JSX.Element {
  if (executions === null) return <Skeleton className="h-16" aria-label="Carregando execuções" />
  if (executions.length === 0)
    return (
      <p className="text-xs text-muted-foreground" data-testid="executions-empty">
        {empty}
      </p>
    )
  return (
    <div data-testid="executions" className="overflow-hidden rounded-lg border border-border-soft">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Quando</TableHead>
            <TableHead>Tarefa</TableHead>
            <TableHead>Resultado</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {executions.slice(0, 20).map((e) => (
            <TableRow key={e.id}>
              <TableCell className="text-muted-foreground">
                <Timestamp value={e.at} />
              </TableCell>
              <TableCell>
                {[e.task.displayId, e.task.title].filter(Boolean).join(' ') || e.task.taskId}
              </TableCell>
              <TableCell>
                <StatusToken label={e.outcome} tone={e.tone} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
