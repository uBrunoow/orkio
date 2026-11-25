import { cn } from '@/lib/utils'
import type { RunStatus } from '../../../../shared/agent-run'
import { StatusBadge, type StatusTone } from '../../components/StatusToken'
import { formatDuration, formatUsd, plural } from '../../lib/format'
import { contextTone, latestContextUsage, shortTokens } from './environment'
import { runActivity, sessionTotals } from './session-stats'
import { useTaskView } from './task-view'

const TITLE = 'font-medium label-caps'
const BAR: Record<'ok' | 'warn' | 'danger', string> = {
  ok: 'bg-ok',
  warn: 'bg-warn',
  danger: 'bg-danger'
}
const STATUS: Record<RunStatus, { label: string; tone: StatusTone }> = {
  queued: { label: 'Na fila', tone: 'neutral' },
  running: { label: 'Rodando', tone: 'running' },
  succeeded: { label: 'Terminou', tone: 'success' },
  failed: { label: 'Falhou', tone: 'danger' },
  cancelled: { label: 'Parou', tone: 'warning' }
}

/**
 * Aba "Contexto" da tarefa (como o painel do Compozy): quanto da janela a sessão já usou, o custo
 * e o tempo da tarefa e o que a execução mais recente fez. Só o que o Orkio já guarda.
 */
export function SessionContextPanel(): React.JSX.Element {
  const { runs } = useTaskView()
  const list = (runs.state?.runs ?? []).filter((r) => !r.side)
  const latest = list[0] ?? null
  // O log em memória é o da execução selecionada (a ativa ou a mais recente).
  const log = latest && runs.selectedRunId === latest.id ? runs.log : []
  const usage = latestContextUsage(log)
  const totals = sessionTotals(list)
  const activity = runActivity(log)

  if (!latest) {
    return (
      <p className="text-xs text-muted-foreground" data-testid="session-context-empty">
        Ainda não houve conversa com o Claude Code nesta tarefa. O contexto aparece depois do
        primeiro turno.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-6" data-testid="session-context-panel">
      <section aria-label="Contexto da sessão" className="flex flex-col gap-2.5">
        <h3 className={TITLE}>Contexto</h3>
        {usage ? (
          <>
            <p className="flex items-baseline gap-2">
              <span className="text-2xl font-medium text-foreground tabular-nums">
                {usage.percent}%
              </span>
              <span className="font-mono text-2xs text-subtle-foreground">
                {shortTokens(usage.inputTokens)} / {shortTokens(usage.contextWindow)}
              </span>
            </p>
            <div
              role="progressbar"
              aria-label="Contexto usado"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={usage.percent}
              className="h-1.5 overflow-hidden rounded-full bg-muted"
            >
              <div
                className={cn('h-full rounded-full', BAR[contextTone(usage.percent)])}
                style={{ width: `${usage.percent}%` }}
              />
            </div>
            <dl className="flex flex-col gap-1 text-xs">
              <Legend
                dot={BAR[contextTone(usage.percent)]}
                label="Usado"
                value={shortTokens(usage.inputTokens)}
              />
              <Legend
                dot="bg-muted border border-border"
                label="Livre"
                value={shortTokens(Math.max(0, usage.contextWindow - usage.inputTokens))}
              />
            </dl>
            <p className="text-2xs text-subtle-foreground">
              O usado inclui o resumo da tarefa, as instruções e a memória do agente, os arquivos
              lidos e a conversa. Perto de cheio, o Claude Code compacta a conversa; “Nova sessão”
              começa do zero.
            </p>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            Aparece quando a execução mais recente terminar um turno.
          </p>
        )}
      </section>

      <section aria-label="Custo e tempo" className="flex flex-col gap-2.5">
        <div className="flex items-baseline justify-between">
          <h3 className={TITLE}>Custo e tempo</h3>
          <span className="text-2xs text-subtle-foreground">
            {plural(totals.runs, 'execução', 'execuções')}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Tile
            label="Custo total"
            value={totals.costUsd === null ? '—' : formatUsd(totals.costUsd)}
            hint="Informado pelo Claude Code"
          />
          <Tile
            label="Tempo de trabalho"
            value={totals.workMs > 0 ? formatDuration(totals.workMs) : '—'}
            hint="Soma das execuções"
          />
        </div>
      </section>

      <section aria-label="Execução mais recente" className="flex flex-col gap-2.5">
        <h3 className={TITLE}>Execução mais recente</h3>
        <dl className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1.5 text-xs">
          <dt className="text-muted-foreground">Estado</dt>
          <dd className="flex items-center gap-2">
            <StatusBadge label={STATUS[latest.status].label} tone={STATUS[latest.status].tone} />
            {activity.durationMs !== null && (
              <span className="text-subtle-foreground">
                em {formatDuration(activity.durationMs)}
              </span>
            )}
          </dd>
          {activity.model && (
            <>
              <dt className="text-muted-foreground">Modelo</dt>
              <dd className="truncate font-mono text-foreground">{activity.model}</dd>
            </>
          )}
          {activity.turns !== null && (
            <>
              <dt className="text-muted-foreground">Turnos</dt>
              <dd className="text-foreground tabular-nums">{activity.turns}</dd>
            </>
          )}
          <dt className="text-muted-foreground">Ferramentas</dt>
          <dd className="text-foreground tabular-nums">
            {activity.tools}
            {activity.subagents > 0 && (
              <span className="text-subtle-foreground">
                {' '}
                · {plural(activity.subagents, 'subagente', 'subagentes')}
              </span>
            )}
          </dd>
          {latest.costUsd !== null && (
            <>
              <dt className="text-muted-foreground">Custo</dt>
              <dd className="text-foreground tabular-nums">{formatUsd(latest.costUsd)}</dd>
            </>
          )}
        </dl>
      </section>
    </div>
  )
}

function Legend({
  dot,
  label,
  value
}: {
  dot: string
  label: string
  value: string
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-2">
      <span aria-hidden="true" className={cn('size-2 shrink-0 rounded-sm', dot)} />
      <dt className="flex-1 text-muted-foreground">{label}</dt>
      <dd className="font-mono text-2xs text-foreground">{value}</dd>
    </div>
  )
}

function Tile({
  label,
  value,
  hint
}: {
  label: string
  value: string
  hint: string
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border border-border-soft bg-card px-3 py-2.5">
      <span className="text-2xs text-muted-foreground">{label}</span>
      <span className="text-base font-medium text-foreground tabular-nums">{value}</span>
      <span className="text-2xs text-subtle-foreground">{hint}</span>
    </div>
  )
}
