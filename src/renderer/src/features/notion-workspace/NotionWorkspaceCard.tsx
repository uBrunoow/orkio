import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { SelectField } from '@/components/form'
import { Spinner } from '@/components/Spinner'
import { cn } from '@/lib/utils'
import {
  MAPPING_FIELDS,
  REQUIRED_FIELDS,
  candidatesFor,
  fieldLabel,
  sameId
} from '../../../../shared/notion-mapping'
import { Alert } from '../../components/Alert'
import { DatabaseIcon, RefreshIcon } from '../../components/icons'
import { PanelHeader } from '../../components/PanelHeader'
import type { UseNotionWorkspace } from './useNotionWorkspace'
import { StatusToken } from '../../components/StatusToken'
import { ErrorAlert } from '../../components/ErrorAlert'
import { ipcResult } from '../../lib/ipc'
import { NOTION_COLOR_TONE, WORKSPACE_HEALTH } from '../../lib/status-text'
import type { ConnectionStatus } from '../../../../shared/connection'
import type {
  NotionDataSourceList,
  NotionMappingField,
  NotionTasksSchemaInfo,
  NotionWorkspaceStatus
} from '../../../../shared/notion'
import type { ResultError } from '../../../../shared/result'

const hint = 'text-xs text-muted-foreground'

type NotionError = ResultError
type MappingDraft = Partial<Record<NotionMappingField, string | null>>

const TYPE_LABELS: Record<string, string> = {
  title: 'título',
  status: 'status',
  select: 'seleção',
  unique_id: 'ID',
  relation: 'relação',
  number: 'número',
  people: 'pessoas'
}

const FIELD_HINTS: Partial<Record<NotionMappingField, string>> = {
  uniqueId:
    'Propriedade do tipo ID (ex.: ORK-142). Opcional: sem ela, a tarefa é a página do Notion.',
  project: 'Relação com o banco de Projetos escolhido.',
  priority: 'Seleção, status ou número.',
  assignee: 'Pessoas. O Orkio mostra só as tarefas em que você é responsável.'
}

export function NotionWorkspaceCard({
  workspace,
  notionStatus,
  onReconnect
}: {
  workspace: UseNotionWorkspace
  notionStatus: ConnectionStatus | null
  /** Reabre a autorização do Notion (OAuth) para escolher mais páginas. */
  onReconnect?: () => Promise<unknown>
}): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const { status } = workspace
  const connected = notionStatus?.state === 'connected'
  const health = status?.config
    ? WORKSPACE_HEALTH[workspace.revalidating ? 'checking' : status.health]
    : null

  return (
    <section
      aria-labelledby="notion-workspace-title"
      aria-busy={workspace.revalidating}
      className="flex flex-col gap-4 rounded-xl border border-border-soft bg-card p-5"
    >
      <PanelHeader
        titleId="notion-workspace-title"
        title="Bancos do Notion"
        description="Onde ficam seus Projetos e Tarefas. O Orkio lê as tarefas e só escreve o status quando você (ou uma automação) move um card."
        icon={<DatabaseIcon className="size-5 text-foreground" />}
        badge={
          health && !editing ? <StatusToken {...health} data-testid="workspace-health" /> : null
        }
      />

      {status === null || notionStatus === null ? (
        <Skeleton className="h-10" aria-label="Carregando bancos do Notion" />
      ) : !connected && !status.config ? (
        <p className="text-sm text-muted-foreground">
          Conecte o Notion acima para escolher os bancos de Projetos e Tarefas.
        </p>
      ) : editing || !status.config ? (
        connected ? (
          <Wizard
            status={status}
            onReconnect={onReconnect}
            onCancel={status.config ? () => setEditing(false) : undefined}
            onSaved={(next) => {
              workspace.setStatus(next)
              setEditing(false)
            }}
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            Conecte o Notion acima para revisar o mapeamento.
          </p>
        )
      ) : (
        <Summary
          status={status}
          revalidating={workspace.revalidating}
          onEdit={() => setEditing(true)}
          onRevalidate={() => void workspace.revalidate()}
        />
      )}
    </section>
  )
}

function Summary({
  status,
  revalidating,
  onEdit,
  onRevalidate
}: {
  status: NotionWorkspaceStatus
  revalidating: boolean
  onEdit(): void
  onRevalidate(): void
}): React.JSX.Element {
  const config = status.config!
  const tone = status.health === 'broken' ? 'danger' : 'warning'
  return (
    <div className="flex flex-col gap-4">
      {status.messages.length > 0 && (
        <Alert tone={tone}>
          <div className="flex flex-col gap-1">
            {status.messages.map((m) => (
              <p key={m}>{m}</p>
            ))}
          </div>
        </Alert>
      )}
      <div role="group" aria-label="Configuração dos bancos do Notion">
        <dl className="grid grid-cols-1 overflow-hidden rounded-lg border border-border-soft sm:grid-cols-2">
          <SummaryItem label="Banco de Projetos" value={config.projectsDataSource.name} />
          <SummaryItem label="Banco de Tarefas" value={config.tasksDataSource.name} />
          {MAPPING_FIELDS.map((field) => {
            const ref = config.mapping[field]
            return ref ? (
              <SummaryItem key={field} label={fieldLabel(field)} value={ref.name} />
            ) : null
          })}
        </dl>
      </div>
      <div className="flex gap-2">
        <Button variant={status.health === 'broken' ? 'default' : 'outline'} onClick={onEdit}>
          Revisar mapeamento
        </Button>
        <Button variant="ghost" disabled={revalidating} onClick={onRevalidate}>
          {revalidating ? <Spinner /> : <RefreshIcon />}
          Verificar de novo
        </Button>
      </div>
    </div>
  )
}

function Wizard({
  status,
  onReconnect,
  onCancel,
  onSaved
}: {
  status: NotionWorkspaceStatus
  onReconnect: (() => Promise<unknown>) | undefined
  onCancel: (() => void) | undefined
  onSaved(status: NotionWorkspaceStatus): void
}): React.JSX.Element {
  const existing = status.config
  const [step, setStep] = useState(0)
  const [list, setList] = useState<NotionDataSourceList | null>(null)
  const [listError, setListError] = useState<NotionError | null>(null)
  const [projectsId, setProjectsId] = useState<string | null>(
    existing?.projectsDataSource.id ?? null
  )
  const [tasksId, setTasksId] = useState<string | null>(existing?.tasksDataSource.id ?? null)
  const [schema, setSchema] = useState<NotionTasksSchemaInfo | null>(null)
  const [schemaError, setSchemaError] = useState<NotionError | null>(null)
  const [loadingSchema, setLoadingSchema] = useState(false)
  const [mapping, setMapping] = useState<MappingDraft>({})
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<NotionError | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let active = true
    void ipcResult(() => window.orkio.notionWorkspace.listDataSources()).then((result) => {
      if (!active) return
      if (result.ok) setList(result.value)
      else setListError(result.error)
    })
    return () => {
      active = false
    }
  }, [reloadKey])

  async function reconnect(): Promise<void> {
    if (!onReconnect) return
    await onReconnect()
    setList(null)
    setListError(null)
    setReloadKey((n) => n + 1)
  }

  async function loadSchema(): Promise<void> {
    if (!tasksId || !projectsId) return
    setLoadingSchema(true)
    setSchemaError(null)
    const result = await ipcResult(() =>
      window.orkio.notionWorkspace.getTasksSchema(tasksId, projectsId)
    )
    setLoadingSchema(false)
    if (!result.ok) {
      setSchemaError(result.error)
      return
    }
    setSchema(result.value)
    // Ao revisar o mesmo par de bancos, mantém o mapeamento salvo; senão, usa a sugestão.
    const keep =
      existing &&
      sameId(existing.tasksDataSource.id, tasksId) &&
      sameId(existing.projectsDataSource.id, projectsId)
    const next: MappingDraft = {}
    for (const field of MAPPING_FIELDS) {
      const valid = candidatesFor(field, result.value.schema.properties, projectsId)
      const preferred = keep ? existing.mapping[field]?.id : result.value.suggestion[field]?.id
      const fallback = result.value.suggestion[field]?.id
      next[field] = [preferred, fallback].find((id) => id && valid.some((p) => p.id === id)) ?? null
    }
    setMapping(next)
    setStep(2)
  }

  async function save(): Promise<void> {
    if (!tasksId || !projectsId) return
    setSaving(true)
    setSaveError(null)
    const result = await ipcResult(() =>
      window.orkio.notionWorkspace.save({
        projectsDataSourceId: projectsId,
        tasksDataSourceId: tasksId,
        mapping
      })
    )
    setSaving(false)
    if (result.ok) onSaved(result.value)
    else setSaveError(result.error)
  }

  const options = (list?.dataSources ?? []).map((d) => ({ value: d.id, label: d.title }))
  const projectsName = list?.dataSources.find((d) => d.id === projectsId)?.title
  const missingRequired = REQUIRED_FIELDS.filter((f) => !mapping[f])
  const lacksUniqueId =
    schema !== null && !schema.schema.properties.some((p) => p.type === 'unique_id')

  return (
    <div className="flex flex-col gap-4">
      <WizardSteps active={step} />

      {list?.connection === 'oauth' && step < 2 && (
        <div className="flex flex-wrap items-center gap-2">
          <p className={hint}>
            Só aparecem os bancos que você escolheu ao autorizar o Orkio no Notion. Falta algum?
            Reconecte e marque as páginas desses bancos.
          </p>
          {onReconnect && (
            <Button variant="ghost" size="sm" onClick={() => void reconnect()}>
              Reconectar com Notion
            </Button>
          )}
        </div>
      )}

      {listError && (
        <ErrorAlert error={listError} onReconnect={onReconnect ? reconnect : undefined} />
      )}

      {step === 0 && (
        <div className="flex flex-col gap-3">
          {list === null && !listError ? (
            <Skeleton className="h-10" aria-label="Carregando bancos" />
          ) : (
            <>
              {list?.truncated && (
                <Alert tone="warning">
                  Há muitos bancos; mostramos os 500 editados mais recentemente. Use a busca.
                </Alert>
              )}
              {list && list.dataSources.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nenhum banco do Notion está compartilhado com o Orkio.
                </p>
              ) : (
                <SelectField
                  label="Banco de Projetos"
                  description="O banco com uma página por projeto."
                  options={options}
                  hasSearch
                  searchPlaceholder="Buscar banco…"
                  placeholder="Escolha o banco de Projetos"
                  value={projectsId}
                  onChange={(value: string) => setProjectsId(value)}
                  className={FIELD_WIDTH}
                />
              )}
            </>
          )}
          <div className="flex gap-2">
            <Button
              disabled={!projectsId}
              onClick={() => {
                if (tasksId && projectsId && sameId(tasksId, projectsId)) setTasksId(null)
                setStep(1)
              }}
            >
              Continuar
            </Button>
            {onCancel && (
              <Button variant="ghost" onClick={onCancel}>
                Cancelar
              </Button>
            )}
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="flex flex-col gap-3">
          <SelectField
            label="Banco de Tarefas"
            description={`As tarefas, com uma relação para ${projectsName ? `“${projectsName}”` : 'o banco de Projetos'}.`}
            options={options.filter((o) => !projectsId || !sameId(o.value, projectsId))}
            hasSearch
            searchPlaceholder="Buscar banco…"
            placeholder="Escolha o banco de Tarefas"
            value={tasksId}
            onChange={(value: string) => setTasksId(value)}
            className={FIELD_WIDTH}
          />
          {schemaError && (
            <ErrorAlert error={schemaError} onReconnect={onReconnect ? reconnect : undefined} />
          )}
          <div className="flex gap-2">
            <Button disabled={!tasksId || loadingSchema} onClick={() => void loadSchema()}>
              {loadingSchema && <Spinner />}
              Continuar
            </Button>
            <Button variant="ghost" onClick={() => setStep(0)}>
              Voltar
            </Button>
          </div>
        </div>
      )}

      {step === 2 && schema && projectsId && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            Confira quais propriedades de “{schema.schema.title}” o Orkio deve usar. Sugerimos pelo
            nome e pelo tipo.
          </p>

          {lacksUniqueId && (
            <div
              role="status"
              data-testid="no-unique-id"
              className="flex flex-col gap-2 border-l-2 border-brand py-1 pl-3"
            >
              <p className={hint}>
                Este banco não tem propriedade de ID, e tudo bem: o Orkio identifica cada tarefa
                pela página do Notion e liga a branch e a PR pela branch que ele cria (feat/…), pelo
                link do Notion no corpo da PR ou por “Vincular branch” na tarefa. Quer IDs como
                TI-42 nos cards e nas branches? Crie no Notion uma propriedade do tipo “ID” com um
                prefixo e recarregue.
              </p>
              <div>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={loadingSchema}
                  onClick={() => void loadSchema()}
                >
                  {loadingSchema && <Spinner />}
                  Recarregar banco
                </Button>
              </div>
            </div>
          )}

          <div className="overflow-hidden rounded-xl border border-border-soft bg-card">
            <div
              aria-hidden="true"
              className="flex gap-3 border-b border-border-soft px-3.5 py-2 text-2xs tracking-wider text-subtle-foreground uppercase"
            >
              <span className="w-40 shrink-0">Campo do Orkio</span>
              <span>Propriedade no Notion</span>
            </div>
            {MAPPING_FIELDS.map((field) => {
              const required = REQUIRED_FIELDS.includes(field)
              const candidates = candidatesFor(field, schema.schema.properties, projectsId)
              const value = mapping[field]
              const noCandidate =
                required && candidates.length === 0 && !(field === 'uniqueId' && lacksUniqueId)
              const description = FIELD_HINTS[field]
              return (
                <div
                  key={field}
                  className="border-b border-border-soft px-3.5 py-2.5 last:border-b-0"
                >
                  <SelectField
                    label={fieldLabel(field)}
                    {...(description ? { description } : {})}
                    {...(required ? { required: true } : {})}
                    options={candidates.map((p) => ({
                      value: p.id,
                      label: p.name,
                      description: TYPE_LABELS[p.type] ?? p.type
                    }))}
                    placeholder={
                      candidates.length === 0 ? 'Nenhuma propriedade compatível' : 'Escolha'
                    }
                    disabled={candidates.length === 0}
                    {...(noCandidate
                      ? {
                          error:
                            field === 'project'
                              ? 'Nenhuma relação aponta para o banco de Projetos escolhido.'
                              : 'Nenhuma propriedade compatível neste banco.'
                        }
                      : {})}
                    {...(!required && value
                      ? {
                          clearLabel: 'Nenhuma (não usar)',
                          onClear: () => setMapping((m) => ({ ...m, [field]: null }))
                        }
                      : {})}
                    value={value ?? null}
                    onChange={(next: string) => setMapping((m) => ({ ...m, [field]: next }))}
                    className={FIELD_WIDTH}
                  />
                </div>
              )
            })}
          </div>

          <StatusPreview schema={schema} statusId={mapping.status ?? null} />

          {saveError && (
            <ErrorAlert error={saveError} onReconnect={onReconnect ? reconnect : undefined} />
          )}

          <div className="flex gap-2">
            <Button disabled={saving || missingRequired.length > 0} onClick={() => void save()}>
              {saving && <Spinner />}
              Salvar
            </Button>
            <Button variant="ghost" onClick={() => setStep(1)}>
              Voltar
            </Button>
          </div>
          {missingRequired.length > 0 && (
            <p className={hint}>
              Para salvar, escolha: {missingRequired.map(fieldLabel).join(', ')}.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

const FIELD_WIDTH = 'max-w-md'

const WIZARD_STEPS = ['Projetos', 'Tarefas', 'Mapeamento'] as const

/** Passos do assistente: círculo numerado (feito = ✓ verde, atual = borda laranja). */
function WizardSteps({ active }: { active: number }): React.JSX.Element {
  return (
    <ol aria-label="Configurar bancos do Notion" className="flex flex-wrap items-center gap-2">
      {WIZARD_STEPS.map((label, i) => {
        const done = i < active
        const current = i === active
        return (
          <li
            key={label}
            {...(current ? { 'aria-current': 'step' as const } : {})}
            className="flex items-center gap-2"
          >
            {i > 0 && <span aria-hidden="true" className="h-px w-6 bg-border" />}
            <span
              aria-hidden="true"
              className={cn(
                'grid size-[22px] place-items-center rounded-full border font-mono text-2xs',
                done && 'border-ok-tint-border bg-ok-tint text-ok',
                current && 'border-brand text-brand',
                !done && !current && 'border-border text-subtle-foreground'
              )}
            >
              {done ? '✓' : i + 1}
            </span>
            <span className={cn('text-xs', current ? 'text-foreground' : 'text-muted-foreground')}>
              {label}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

function SummaryItem({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="flex items-center gap-3 border-b border-border-soft px-3.5 py-2 text-sm">
      <dt className="w-36 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-foreground">{value}</dd>
    </div>
  )
}

function StatusPreview({
  schema,
  statusId
}: {
  schema: NotionTasksSchemaInfo
  statusId: string | null
}): React.JSX.Element | null {
  const property = schema.schema.properties.find((p) => p.id === statusId)
  if (!property?.options || property.options.length === 0) return null
  return (
    <div className="flex flex-col gap-2">
      <p className={hint}>Opções de status:</p>
      <div role="group" aria-label="Opções de status" className="flex flex-wrap gap-x-3 gap-y-1.5">
        {property.options.map((o) => (
          <StatusToken key={o.id || o.name} label={o.name} tone={NOTION_COLOR_TONE[o.color]} />
        ))}
      </div>
    </div>
  )
}
