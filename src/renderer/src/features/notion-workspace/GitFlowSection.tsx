import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { SelectField } from '@/components/form'
import { Spinner } from '@/components/Spinner'
import {
  GIT_STAGE_KEYS,
  GIT_STAGE_LABEL,
  suggestGitFlow,
  type GitFlowConfig,
  type GitFlowInput,
  type GitFlowSetup,
  type GitStageKey
} from '../../../../shared/git-flow'
import type { NotionPropertySummary, NotionWorkspaceStatus } from '../../../../shared/notion'
import type { ResultError } from '../../../../shared/result'
import { Alert } from '../../components/Alert'
import { ErrorAlert } from '../../components/ErrorAlert'
import { StatusToken } from '../../components/StatusToken'
import { ipcResult, unwrap, useIpcResource } from '../../lib/ipc'
import { NOTION_COLOR_TONE } from '../../lib/status-text'
import { gitFlowEntry, savedOptionColor, stageCandidates } from './git-flow-ui'

const NONE = '__none__'
const FIELD_WIDTH = 'max-w-md'
const hint = 'text-xs text-muted-foreground'

const MANUAL_NOTE =
  'PR para main aberta e Em produção continuam no Notion (à mão): a PR da dev para a main não é de uma tarefa.'

interface Draft {
  stage: string | null
  options: Partial<Record<GitStageKey, string>>
  prUrl: string | null
  mergedAt: string | null
}

function draftOf(config: GitFlowConfig | null): Draft {
  return {
    stage: config?.stage.id ?? null,
    options: Object.fromEntries(
      GIT_STAGE_KEYS.flatMap((k) => (config?.options[k] ? [[k, config.options[k].id]] : []))
    ),
    prUrl: config?.prUrl?.id ?? null,
    mergedAt: config?.mergedAt?.id ?? null
  }
}

/** Sugestão de opções para uma propriedade escolhida à mão (pelo nome das opções). */
function optionsFor(prop: NotionPropertySummary | undefined): Draft['options'] {
  if (!prop) return {}
  const suggestion = suggestGitFlow([prop])
  return draftOf(suggestion).options
}

/**
 * Fluxo Git (opcional), no cartão "Bancos do Notion" depois do mapeamento: qual propriedade é a
 * Etapa Git, que opção é cada etapa que o Orkio conhece, e os campos do link da PR e da data do
 * merge. O main valida de novo ao salvar.
 */
export function GitFlowSection({
  status,
  onSaved
}: {
  status: NotionWorkspaceStatus
  onSaved(status: NotionWorkspaceStatus): void
}): React.JSX.Element {
  const saved = status.config?.gitFlow ?? null
  // Por banco: depois de salvar, recarrega mantendo o valor anterior (sem piscar o resumo).
  const key = status.config ? status.config.tasksDataSource.id : null
  // Ao voltar para a janela (ex.: criou a propriedade no Notion), relê o schema.
  const setup = useIpcResource(key, () => window.orkio.notionWorkspace.getGitFlow().then(unwrap), {
    refreshOnFocus: true
  })
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ResultError | null>(null)

  async function submit(input: GitFlowInput | null): Promise<void> {
    setBusy(true)
    setError(null)
    const result = await ipcResult(() => window.orkio.notionWorkspace.saveGitFlow(input))
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setEditing(false)
    onSaved(result.value)
    void setup.reload()
  }
  const entry = gitFlowEntry(setup.value, saved)

  return (
    <section
      aria-labelledby="git-flow-title"
      className="flex flex-col gap-3 border-t border-border-soft pt-4"
    >
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <h3 id="git-flow-title" className="text-sm font-medium text-foreground">
            Fluxo Git (opcional)
          </h3>
          {saved && !editing && <StatusToken label="Ligado" tone="success" />}
        </div>
        <p className={hint}>
          O Orkio preenche a Etapa Git, o link da PR e a data do merge na dev pelos eventos do
          GitHub, nos projetos com quadro e vínculo com o Notion. Ele só avança a etapa (nunca
          desfaz o que alguém pôs à mão mais adiante).
        </p>
      </div>

      {error && <ErrorAlert error={error} />}

      {editing ? (
        setup.value ? (
          <GitFlowForm
            setup={setup.value}
            busy={busy}
            onCancel={() => {
              setEditing(false)
              setError(null)
            }}
            onSave={(input) => void submit(input)}
          />
        ) : setup.error ? (
          <ErrorAlert error={setup.error} />
        ) : (
          <Skeleton className="h-10" aria-label="Carregando propriedades do Notion" />
        )
      ) : saved ? (
        <GitFlowSummary config={saved} setup={setup.value} />
      ) : entry === 'no_property' ? (
        <NoStageProperty />
      ) : setup.error ? (
        <ErrorAlert error={setup.error} />
      ) : null}

      {!editing && entry === 'ready' && (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setEditing(true)}>
            {saved ? 'Revisar Fluxo Git' : 'Configurar Fluxo Git'}
          </Button>
          {saved && (
            <Button variant="ghost" disabled={busy} onClick={() => void submit(null)}>
              {busy && <Spinner />}
              Desligar Fluxo Git
            </Button>
          )}
        </div>
      )}
    </section>
  )
}

function GitFlowSummary({
  config,
  setup
}: {
  config: GitFlowConfig
  setup: GitFlowSetup | null
}): React.JSX.Element {
  // Cor ainda desconhecida (carregando) ou opção que sumiu: tom neutro.
  const toneOf = (id: string) => {
    const color = savedOptionColor(setup, config, id)
    return color ? NOTION_COLOR_TONE[color] : 'neutral'
  }
  return (
    <dl
      aria-label="Configuração do Fluxo Git"
      className="grid grid-cols-1 overflow-hidden rounded-lg border border-border-soft text-sm"
    >
      <Row label="Etapa Git">{config.stage.name}</Row>
      {GIT_STAGE_KEYS.map((k) => {
        const opt = config.options[k]
        return (
          <Row key={k} label={GIT_STAGE_LABEL[k]}>
            {opt ? (
              <StatusToken label={opt.name} tone={toneOf(opt.id)} />
            ) : (
              <span className="text-muted-foreground">Não usar</span>
            )}
          </Row>
        )
      })}
      <Row label="Link da PR">{config.prUrl?.name ?? 'Não usar'}</Row>
      <Row label="Data do merge">{config.mergedAt?.name ?? 'Não usar'}</Row>
    </dl>
  )
}

function NoStageProperty(): React.JSX.Element {
  return (
    <Alert tone="info">
      O banco de Tarefas não tem uma propriedade de seleção ou status para a Etapa Git. Crie no
      Notion (ex.: “Etapa Git” com as opções do seu fluxo) e volte para cá.
    </Alert>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex items-center gap-3 border-b border-border-soft px-3.5 py-2 last:border-b-0">
      <dt className="w-44 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-foreground">{children}</dd>
    </div>
  )
}

function GitFlowForm({
  setup,
  busy,
  onCancel,
  onSave
}: {
  setup: GitFlowSetup
  busy: boolean
  onCancel(): void
  onSave(input: GitFlowInput): void
}): React.JSX.Element {
  const [draft, setDraft] = useState<Draft>(() => draftOf(setup.config ?? setup.suggestion))
  const candidates = stageCandidates(setup)
  const urlCandidates = setup.properties.filter((p) => p.type === 'url')
  const dateCandidates = setup.properties.filter((p) => p.type === 'date')
  const stageProp = candidates.find((p) => p.id === draft.stage)

  if (candidates.length === 0) {
    // A propriedade sumiu depois de abrir a edição: o aviso e um jeito de sair.
    return (
      <div className="flex flex-col gap-3">
        <NoStageProperty />
        <div>
          <Button variant="ghost" onClick={onCancel}>
            Cancelar
          </Button>
        </div>
      </div>
    )
  }

  const optionChoices = [
    { value: NONE, label: 'Não usar' },
    ...(stageProp?.options ?? []).map((o) => ({ value: o.id, label: o.name }))
  ]
  const unmapped = GIT_STAGE_KEYS.filter((k) => !draft.options[k])
  const warnings = [
    ...(stageProp && unmapped.length > 0
      ? [
          `Sem opção para ${unmapped.map((k) => GIT_STAGE_LABEL[k]).join(', ')}: o Orkio não escreve essa etapa.`
        ]
      : []),
    ...(urlCandidates.length === 0
      ? ['O banco não tem propriedade de link (URL): o link da PR não será preenchido.']
      : []),
    ...(dateCandidates.length === 0
      ? ['O banco não tem propriedade de data: a data do merge não será preenchida.']
      : [])
  ]
  const canSave = Boolean(stageProp) && unmapped.length < GIT_STAGE_KEYS.length && !busy

  const optional = (
    label: string,
    description: string,
    candidates: NotionPropertySummary[],
    value: string | null,
    set: (v: string | null) => void
  ) => (
    <SelectField
      label={label}
      description={description}
      options={[
        { value: NONE, label: 'Não usar' },
        ...candidates.map((p) => ({ value: p.id, label: p.name }))
      ]}
      value={value ?? NONE}
      onChange={(v: string) => set(v === NONE ? null : v)}
      disabled={candidates.length === 0}
      className={FIELD_WIDTH}
    />
  )

  return (
    <div className="flex flex-col gap-3">
      <SelectField
        label="Propriedade da Etapa Git"
        description="Seleção ou status do banco de Tarefas. A ordem das opções no Notion é a ordem das etapas."
        options={candidates.map((p) => ({
          value: p.id,
          label: p.name,
          description: p.type === 'status' ? 'status' : 'seleção'
        }))}
        placeholder="Escolha"
        value={draft.stage}
        onChange={(id: string) =>
          setDraft((d) => ({
            ...d,
            stage: id,
            options: optionsFor(candidates.find((p) => p.id === id))
          }))
        }
        className={FIELD_WIDTH}
      />
      {stageProp &&
        GIT_STAGE_KEYS.map((k) => (
          <SelectField
            key={k}
            label={GIT_STAGE_LABEL[k]}
            options={optionChoices}
            value={draft.options[k] ?? NONE}
            onChange={(v: string) =>
              setDraft((d) => {
                const options = { ...d.options }
                if (v === NONE) delete options[k]
                else options[k] = v
                return { ...d, options }
              })
            }
            className={FIELD_WIDTH}
          />
        ))}
      {optional(
        'Link da PR',
        'Propriedade de link (URL). Preenchida só se estiver vazia ou com outra PR do repositório.',
        urlCandidates,
        draft.prUrl,
        (v) => setDraft((d) => ({ ...d, prUrl: v }))
      )}
      {optional(
        'Data do merge na dev',
        'Propriedade de data: recebe o horário do merge no GitHub.',
        dateCandidates,
        draft.mergedAt,
        (v) => setDraft((d) => ({ ...d, mergedAt: v }))
      )}

      <Alert tone="info">{MANUAL_NOTE}</Alert>
      {warnings.length > 0 && (
        <Alert tone="warning">
          <div className="flex flex-col gap-1">
            {warnings.map((w) => (
              <p key={w}>{w}</p>
            ))}
          </div>
        </Alert>
      )}

      <div className="flex gap-2">
        <Button
          disabled={!canSave}
          onClick={() =>
            draft.stage &&
            onSave({
              stagePropertyId: draft.stage,
              options: draft.options,
              prUrlPropertyId: draft.prUrl,
              mergedAtPropertyId: draft.mergedAt
            })
          }
        >
          {busy && <Spinner />}
          Salvar Fluxo Git
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </div>
  )
}
