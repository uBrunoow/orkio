import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle
} from '@/components/ui/dialog'
import { CheckboxField, SegmentedControl, SelectField } from '@/components/form'
import { Alert } from '../../components/Alert'
import { PageState } from '../../components/PageState'
import { ipcResult, unwrap, useIpcResource } from '../../lib/ipc'
import { isUsableAgent } from '../../../../shared/agent'
import { CLAUDE_MODELS } from '../../../../shared/agent-runtime'
import {
  NO_REVIEWER,
  RUN_MODE_TEXT,
  type ColumnSetupsView,
  type RunSetup
} from '../../../../shared/task-setup'
import { useAgentsState } from '../agents/useAgents'
import { INHERIT, ModeCards, type ModeChoice } from './ModeCards'

const APP = '__orkio__'

/**
 * "Como as colunas rodam" (Fase 1): o padrão de cada coluna do quadro. Simples = só o modo;
 * Avançado = revisor, modelo e evidência. Cada tarefa troca o que quiser na tela dela.
 */
export function ColumnSetupsDialog({
  projectId,
  initialStage,
  onClose
}: {
  projectId: string
  /** Coluna aberta ao entrar (ex.: a de trabalho, vindo de um modelo). */
  initialStage?: string | null
  onClose(): void
}): React.JSX.Element {
  const columns = useIpcResource(projectId, (id) => window.orkio.taskSetup.columns(id).then(unwrap))
  const agents = (useAgentsState(projectId).value?.agents ?? []).filter(isUsableAgent)
  const [stageId, setStageId] = useState<string | null>(initialStage ?? null)
  const [advanced, setAdvanced] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const view = columns.value
  const stages = view?.stages ?? []
  // Sem coluna escolhida: a de trabalho (papel `work`), onde o modo costuma valer.
  const current =
    stages.find((s) => s.id === stageId) ??
    stages.find((s) => s.role === 'work') ??
    stages[0] ??
    null
  const save = (setup: RunSetup): void => {
    if (!current) return
    setBusy(true)
    setError(null)
    void ipcResult(() => window.orkio.taskSetup.saveColumn(projectId, current.id, setup)).then(
      (r) => {
        setBusy(false)
        if (r.ok) columns.set(r.value)
        else setError(r.error.message)
      }
    )
  }
  const patch = (key: keyof RunSetup, value: RunSetup[keyof RunSetup] | undefined): void => {
    if (!current) return
    const next: Record<string, unknown> = { ...current.setup }
    if (value === undefined) delete next[key]
    else next[key] = value
    save(next as RunSetup)
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="gap-4 sm:max-w-2xl" data-testid="column-setups">
        <DialogTitle className="text-base font-medium text-foreground">
          Como as colunas rodam
        </DialogTitle>
        <DialogDescription className="text-xs text-muted-foreground">
          Vale para todas as tarefas que entram na coluna. Cada tarefa pode trocar na tela dela.
        </DialogDescription>
        {!view ? (
          columns.error ? (
            <Alert tone="danger">{columns.error.message}</Alert>
          ) : (
            <PageState kind="loading" label="Carregando colunas" rows={1} />
          )
        ) : stages.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Este projeto ainda não tem quadro. Crie o quadro em Configurações › Quadro e automações.
          </p>
        ) : (
          current && (
            <ColumnEditor
              view={view}
              current={current}
              onStage={setStageId}
              advanced={advanced}
              onAdvanced={setAdvanced}
              busy={busy}
              agents={agents.map((a) => ({ value: a.key, label: a.profile.name }))}
              onMode={(mode) => patch('mode', mode === INHERIT ? undefined : mode)}
              onPatch={patch}
            />
          )
        )}
        {error && <Alert tone="danger">{error}</Alert>}
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ColumnEditor({
  view,
  current,
  onStage,
  advanced,
  onAdvanced,
  busy,
  agents,
  onMode,
  onPatch
}: {
  view: ColumnSetupsView
  current: ColumnSetupsView['stages'][number]
  onStage(id: string): void
  advanced: boolean
  onAdvanced(v: boolean): void
  busy: boolean
  agents: { value: string; label: string }[]
  onMode(mode: ModeChoice): void
  onPatch(key: keyof RunSetup, value: RunSetup[keyof RunSetup] | undefined): void
}): React.JSX.Element {
  const setup = current.setup
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <SelectField
          className="w-56"
          label="Coluna"
          options={view.stages.map((s) => ({
            value: s.id,
            label: s.setup.mode ? `${s.name} · ${RUN_MODE_TEXT[s.setup.mode].label}` : s.name
          }))}
          value={current.id}
          onChange={onStage}
        />
        <SegmentedControl
          label="Modo do formulário"
          size="sm"
          value={advanced ? 'advanced' : 'simple'}
          onChange={(v) => onAdvanced(v === 'advanced')}
          options={[
            { value: 'simple', label: 'Simples' },
            { value: 'advanced', label: 'Avançado' }
          ]}
        />
      </div>
      <ModeCards
        label={`Como as tarefas rodam em ${current.name}`}
        value={setup.mode ?? INHERIT}
        disabled={busy}
        onChange={onMode}
        inherit={{
          title: current.flow ? `Fluxo da coluna: ${current.flow.name}` : 'Nada roda sozinho',
          detail: current.flow
            ? 'Ao entrar, roda o fluxo ligado a esta coluna (Quadro e automações › Fluxos).'
            : 'Tarefas que entram aqui esperam você. Cada tarefa ainda pode escolher como rodar.'
        }}
      />
      {advanced && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <SelectField
            label="Quem revisa"
            description="Outro agente, só leitura. Quem implementa nunca revisa o próprio trabalho."
            options={[
              { value: APP, label: 'Padrão do Orkio (Revisor)' },
              { value: NO_REVIEWER, label: 'Ninguém (sem revisão)' },
              ...agents
            ]}
            value={setup.reviewer ?? APP}
            disabled={busy}
            onChange={(v: string) => onPatch('reviewer', v === APP ? undefined : v)}
          />
          <SelectField
            label="Modelo de quem implementa"
            options={[
              { value: APP, label: 'O do agente' },
              ...CLAUDE_MODELS.map((m) => ({ value: m.id, label: m.label }))
            ]}
            value={setup.model ?? APP}
            disabled={busy}
            onChange={(v: string) => onPatch('model', v === APP ? undefined : v)}
          />
          <CheckboxField
            label="Pedir evidência"
            description="Quem implementa mostra os testes que rodou e como verificou cada critério; você confere antes do diff."
            checked={setup.evidence === true}
            disabled={busy}
            onChange={(checked) => onPatch('evidence', checked ? true : undefined)}
          />
        </div>
      )}
    </div>
  )
}
