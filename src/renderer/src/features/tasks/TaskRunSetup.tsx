import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { SegmentedControl, SelectField } from '@/components/form'
import { Alert } from '../../components/Alert'
import { Skeleton } from '@/components/ui/skeleton'
import { LockIcon, PlayIcon } from '../../components/icons'
import { ipcResult, unwrap, useIpcResource } from '../../lib/ipc'
import { agentDisplayName } from '../../../../shared/agent-presets'
import { isUsableAgent } from '../../../../shared/agent'
import { CLAUDE_MODELS } from '../../../../shared/agent-runtime'
import {
  NO_REVIEWER,
  RUN_MODE_TEXT,
  resolveRunSetup,
  setupOriginText,
  type RunSetup,
  type SetupRuns
} from '../../../../shared/task-setup'
import { useAgentsState } from '../agents/useAgents'
import { INHERIT, ModeCards } from './ModeCards'

const INHERITED = '__herdar__'

function runsText(runs: SetupRuns | null): string {
  if (!runs) return 'Nada roda sozinho nesta coluna.'
  switch (runs.kind) {
    case 'native':
      return `${RUN_MODE_TEXT[runs.mode].label}: ${RUN_MODE_TEXT[runs.mode].steps}`
    case 'column_flow':
      return `Fluxo da coluna: ${runs.name}`
    case 'agent_flow':
      return `Fluxo preferido do agente: ${runs.name}`
  }
}

/**
 * "Como deve rodar?" na tela da tarefa (Fase 1): o modo (cartões) e, no Avançado, quem implementa,
 * quem revisa, o modelo e a evidência. Cada item diz de onde vem ("Herdado da coluna X") até você
 * trocar; com fluxo rodando fica travado (vale a cópia do início).
 */
export function TaskRunSetup({
  projectId,
  taskId
}: {
  projectId: string
  taskId: string
}): React.JSX.Element {
  const key = `${projectId}\u0000${taskId}`
  const setup = useIpcResource(
    key,
    () => window.orkio.taskSetup.get(projectId, taskId).then(unwrap),
    {
      subscribe: (reload) => {
        const offs = [
          window.orkio.taskFlows.onChanged((e) => {
            if (e.taskId === taskId) reload()
          }),
          window.orkio.agents.onChanged((e) => {
            if (e.projectId === projectId) reload()
          }),
          window.orkio.board.onChanged((e) => {
            if (e.projectId === projectId) reload()
          })
        ]
        return () => offs.forEach((off) => off())
      }
    }
  )
  const agents = (useAgentsState(projectId).value?.agents ?? []).filter(isUsableAgent)
  const [advanced, setAdvanced] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [started, setStarted] = useState(false)

  const view = setup.value
  if (!view) {
    return setup.error ? (
      <Alert tone="danger">{setup.error.message}</Alert>
    ) : (
      <Skeleton className="h-24" aria-label="Carregando como a tarefa roda" />
    )
  }

  const save = (next: RunSetup): void => {
    setBusy(true)
    setError(null)
    void ipcResult(() => window.orkio.taskSetup.save(projectId, taskId, next)).then((r) => {
      setBusy(false)
      if (r.ok) setup.set(r.value)
      else setError(r.error.message)
    })
  }
  const patch = (field: keyof RunSetup, value: RunSetup[keyof RunSetup] | undefined): void => {
    const next: Record<string, unknown> = { ...view.task }
    if (value === undefined) delete next[field]
    else next[field] = value
    save(next as RunSetup)
  }
  const run = (): void => {
    setBusy(true)
    setError(null)
    void ipcResult(() => window.orkio.taskFlows.start(projectId, taskId)).then((r) => {
      setBusy(false)
      if (r.ok) setStarted(true)
      else setError(r.error.message)
      void setup.reload()
    })
  }

  const column = view.stage?.name ?? null
  const origin = (field: keyof RunSetup): string =>
    setupOriginText(view.effective.from[field], column)
  const inheritTitle = view.column.mode
    ? `Como a coluna manda: ${RUN_MODE_TEXT[view.column.mode].label}`
    : 'Como a coluna manda'
  const inheritDetail =
    view.column.mode || !view.runs || view.task.mode
      ? column
        ? `Padrão da coluna ${column}.`
        : 'A tarefa está sem coluna.'
      : runsText(view.runs)
  const locked = view.locked
  // O que a tarefa herdaria sem a troca dela (coluna, senão o Orkio).
  const inherited = resolveRunSetup(null, view.column).values

  return (
    <section
      aria-label="Como deve rodar?"
      data-testid="task-run-setup"
      className="flex flex-col gap-3"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-medium label-caps">Como deve rodar?</h3>
        <SegmentedControl
          label="Modo do formulário"
          size="sm"
          value={advanced ? 'advanced' : 'simple'}
          onChange={(v) => setAdvanced(v === 'advanced')}
          options={[
            { value: 'simple', label: 'Simples' },
            { value: 'advanced', label: 'Avançado' }
          ]}
        />
      </div>
      {locked && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <LockIcon className="size-3.5" />
          Travado enquanto o fluxo roda: vale a configuração do início.
        </p>
      )}
      <ModeCards
        compact
        value={view.task.mode ?? INHERIT}
        disabled={busy || locked}
        inherit={{ title: inheritTitle, detail: inheritDetail }}
        onChange={(v) => patch('mode', v === INHERIT ? undefined : v)}
      />
      {view.task.mode && <p className="text-xs text-subtle-foreground">{origin('mode')}</p>}

      {advanced && (
        <div className="flex flex-col gap-3 rounded-lg border border-border-soft p-3">
          <div className="flex flex-col gap-0.5">
            <span className="text-xs text-muted-foreground">Quem implementa</span>
            <span className="text-sm">
              {view.implementer ? view.implementer.name : 'Claude Code, sem agente'}
            </span>
            <span className="text-xs text-subtle-foreground">
              {view.implementer
                ? view.implementer.manual
                  ? 'Escolhido para esta tarefa (troque em Agente, abaixo).'
                  : `Da regra da coluna${column ? ` ${column}` : ''} (troque em Agente, abaixo).`
                : 'Atribua um agente em Agente, abaixo.'}
            </span>
          </div>
          <SelectField
            label="Quem revisa"
            description={origin('reviewer')}
            disabled={busy || locked}
            options={[
              {
                value: INHERITED,
                label: `Herdar (${
                  inherited.reviewer
                    ? (agents.find((a) => a.key === inherited.reviewer)?.profile.name ??
                      agentDisplayName(inherited.reviewer))
                    : 'ninguém'
                })`
              },
              { value: NO_REVIEWER, label: 'Ninguém (sem revisão)' },
              ...agents
                .filter((a) => a.key !== view.implementer?.key)
                .map((a) => ({ value: a.key, label: a.profile.name }))
            ]}
            value={view.task.reviewer ?? INHERITED}
            onChange={(v: string) => patch('reviewer', v === INHERITED ? undefined : v)}
          />
          <SelectField
            label="Modelo de quem implementa"
            description={origin('model')}
            disabled={busy || locked}
            options={[
              { value: INHERITED, label: 'Herdar (o da coluna ou do agente)' },
              ...CLAUDE_MODELS.map((m) => ({ value: m.id, label: m.label }))
            ]}
            value={view.task.model ?? INHERITED}
            onChange={(v: string) => patch('model', v === INHERITED ? undefined : v)}
          />
          <SelectField
            label="Pedir evidência"
            description={origin('evidence')}
            disabled={busy || locked}
            options={[
              {
                value: INHERITED,
                label: `Herdar (${inherited.evidence ? 'sim' : 'não'})`
              },
              { value: 'yes', label: 'Sim: mostrar testes e critérios antes do diff' },
              { value: 'no', label: 'Não' }
            ]}
            value={view.task.evidence === undefined ? INHERITED : view.task.evidence ? 'yes' : 'no'}
            onChange={(v: string) => patch('evidence', v === INHERITED ? undefined : v === 'yes')}
          />
        </div>
      )}

      {view.problem && <Alert tone="warning">{view.problem}</Alert>}
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-xs text-muted-foreground" data-testid="setup-runs">
          {runsText(view.runs)}
        </p>
        {!locked && view.runs && (
          <Button size="sm" variant="outline" disabled={busy} onClick={run}>
            <PlayIcon />
            Rodar agora
          </Button>
        )}
        {started && locked && (
          <span role="status" className="text-xs text-muted-foreground">
            Rodando. Acompanhe na conversa.
          </span>
        )}
      </div>
    </section>
  )
}
