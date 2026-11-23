import { useEffect, useState } from 'react'
import { Button } from '@astryxdesign/core/Button'
import { Card } from '@astryxdesign/core/Card'
import { HStack } from '@astryxdesign/core/HStack'
import { Icon } from '@astryxdesign/core/Icon'
import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList'
import { Selector } from '@astryxdesign/core/Selector'
import { Skeleton } from '@astryxdesign/core/Skeleton'
import { Step, Stepper } from '@astryxdesign/core/Stepper'
import { Text } from '@astryxdesign/core/Text'
import { Token } from '@astryxdesign/core/Token'
import { VStack } from '@astryxdesign/core/VStack'
import type {
  ConnectionStatus,
  NotionDataSourceList,
  NotionMappingField,
  NotionResult,
  NotionTasksSchemaInfo,
  NotionWorkspaceStatus
} from '../../../../shared/ipc-contract'
import {
  MAPPING_FIELDS,
  REQUIRED_FIELDS,
  candidatesFor,
  fieldLabel,
  sameId
} from '../../../../shared/notion-mapping'
import { Alert } from '../../components/Alert'
import { DatabaseIcon, RefreshIcon } from '../../components/icons'
import { CardHeader } from '../integrations/connection-ui'
import { tokenColor } from './notion-colors'
import type { UseNotionWorkspace } from './useNotionWorkspace'
import { StatusToken, toneOf } from '../../components/StatusToken'

type NotionError = Extract<NotionResult<never>, { ok: false }>['error']
type MappingDraft = Partial<Record<NotionMappingField, string | null>>

const HEALTH: Record<
  NotionWorkspaceStatus['health'],
  { label: string; color: 'default' | 'green' | 'yellow' | 'red' }
> = {
  checking: { label: 'Verificando…', color: 'default' },
  ok: { label: 'OK', color: 'green' },
  warning: { label: 'Atenção', color: 'yellow' },
  broken: { label: 'Revisar mapeamento', color: 'red' },
  unverified: { label: 'Não verificado', color: 'yellow' }
}

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
  uniqueId: 'Propriedade do tipo ID (unique_id), ex.: ORK-142.',
  project: 'Relação com o banco de Projetos escolhido.',
  priority: 'Seleção, status ou número.',
  assignee: 'Pessoas.'
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
  const health = status?.config ? HEALTH[workspace.revalidating ? 'checking' : status.health] : null

  return (
    <Card role="region" aria-labelledby="notion-workspace-title" aria-busy={workspace.revalidating}>
      <VStack gap={4}>
        <CardHeader
          titleId="notion-workspace-title"
          title="Bancos do Notion"
          description="Onde ficam seus Projetos e Tarefas. O Orkio lê as tarefas e só escreve o status quando você (ou uma automação) move um card."
          icon={<Icon icon={DatabaseIcon} color="primary" size="lg" />}
          badge={
            health && !editing ? (
              <StatusToken
                label={health.label}
                tone={toneOf(health.color)}
                data-testid="workspace-health"
              />
            ) : null
          }
        />

        {status === null || notionStatus === null ? (
          <Skeleton height={40} aria-label="Carregando bancos do Notion" />
        ) : !connected && !status.config ? (
          <Text color="secondary">
            Conecte o Notion acima para escolher os bancos de Projetos e Tarefas.
          </Text>
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
            <Text color="secondary">Conecte o Notion acima para revisar o mapeamento.</Text>
          )
        ) : (
          <Summary
            status={status}
            revalidating={workspace.revalidating}
            onEdit={() => setEditing(true)}
            onRevalidate={() => void workspace.revalidate()}
          />
        )}
      </VStack>
    </Card>
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
    <VStack gap={4}>
      {status.messages.length > 0 && (
        <Alert tone={tone}>
          <VStack gap={1}>
            {status.messages.map((m) => (
              // Esta tela já é Integrações: o card do Notion está logo acima.
              <Text key={m}>{m.replace(' em Integrações', ' acima')}</Text>
            ))}
          </VStack>
        </Alert>
      )}
      <VStack role="group" aria-label="Configuração dos bancos do Notion">
        <MetadataList columns={2} label={{ position: 'start' }}>
          <MetadataListItem label="Banco de Projetos">
            {config.projectsDataSource.name}
          </MetadataListItem>
          <MetadataListItem label="Banco de Tarefas">
            {config.tasksDataSource.name}
          </MetadataListItem>
          {MAPPING_FIELDS.map((field) => {
            const ref = config.mapping[field]
            return ref ? (
              <MetadataListItem key={field} label={fieldLabel(field)}>
                {ref.name}
              </MetadataListItem>
            ) : null
          })}
        </MetadataList>
      </VStack>
      <HStack gap={2}>
        <Button
          variant={status.health === 'broken' ? 'primary' : 'secondary'}
          label="Revisar mapeamento"
          onClick={onEdit}
        />
        <Button
          variant="ghost"
          label="Verificar de novo"
          icon={<Icon icon={RefreshIcon} />}
          isLoading={revalidating}
          onClick={onRevalidate}
        />
      </HStack>
    </VStack>
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
    void call(() => window.orkio.notionWorkspace.listDataSources()).then((result) => {
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
    const result = await call(() =>
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
    const result = await call(() =>
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
    <VStack gap={4}>
      <Stepper activeStep={step} label="Configurar bancos do Notion">
        <Step step={0} label="Projetos" />
        <Step step={1} label="Tarefas" />
        <Step step={2} label="Mapeamento" />
      </Stepper>

      {list?.connection === 'oauth' && step < 2 && (
        <HStack gap={2} vAlign="center" wrap="wrap">
          <Text type="supporting">
            Só aparecem os bancos que você escolheu ao autorizar o Orkio no Notion. Falta algum?
            Reconecte e marque as páginas desses bancos.
          </Text>
          {onReconnect && (
            <Button
              variant="ghost"
              size="sm"
              label="Reconectar com Notion"
              onClick={() => void reconnect()}
            />
          )}
        </HStack>
      )}

      {listError && (
        <ErrorAlert error={listError} onReconnect={onReconnect ? reconnect : undefined} />
      )}

      {step === 0 && (
        <VStack gap={3}>
          {list === null && !listError ? (
            <Skeleton height={40} aria-label="Carregando bancos" />
          ) : (
            <>
              {list?.truncated && (
                <Alert tone="warning">
                  Há muitos bancos; mostramos os 500 editados mais recentemente. Use a busca.
                </Alert>
              )}
              {list && list.dataSources.length === 0 ? (
                <Text color="secondary">
                  Nenhum banco do Notion está compartilhado com o Orkio.
                </Text>
              ) : (
                <Selector
                  label="Banco de Projetos"
                  description="O banco com uma página por projeto."
                  options={options}
                  hasSearch
                  searchPlaceholder="Buscar banco…"
                  placeholder="Escolha o banco de Projetos"
                  emptySearchText="Nenhum banco encontrado"
                  {...(projectsId ? { value: projectsId } : {})}
                  onChange={(value: string) => setProjectsId(value)}
                />
              )}
            </>
          )}
          <HStack gap={2}>
            <Button
              variant="primary"
              label="Continuar"
              isDisabled={!projectsId}
              onClick={() => {
                if (tasksId && projectsId && sameId(tasksId, projectsId)) setTasksId(null)
                setStep(1)
              }}
            />
            {onCancel && <Button variant="ghost" label="Cancelar" onClick={onCancel} />}
          </HStack>
        </VStack>
      )}

      {step === 1 && (
        <VStack gap={3}>
          <Selector
            label="Banco de Tarefas"
            description={`As tarefas, com uma relação para ${projectsName ? `“${projectsName}”` : 'o banco de Projetos'}.`}
            options={options.filter((o) => !projectsId || !sameId(o.value, projectsId))}
            hasSearch
            searchPlaceholder="Buscar banco…"
            placeholder="Escolha o banco de Tarefas"
            emptySearchText="Nenhum banco encontrado"
            {...(tasksId ? { value: tasksId } : {})}
            onChange={(value: string) => setTasksId(value)}
          />
          {schemaError && (
            <ErrorAlert error={schemaError} onReconnect={onReconnect ? reconnect : undefined} />
          )}
          <HStack gap={2}>
            <Button
              variant="primary"
              label="Continuar"
              isDisabled={!tasksId}
              isLoading={loadingSchema}
              onClick={() => void loadSchema()}
            />
            <Button variant="ghost" label="Voltar" onClick={() => setStep(0)} />
          </HStack>
        </VStack>
      )}

      {step === 2 && schema && projectsId && (
        <VStack gap={4}>
          <Text color="secondary">
            Confira quais propriedades de “{schema.schema.title}” o Orkio deve usar. Sugerimos pelo
            nome e pelo tipo.
          </Text>

          {lacksUniqueId && (
            <Alert
              tone="danger"
              action={
                <Button
                  size="sm"
                  label="Recarregar banco"
                  isLoading={loadingSchema}
                  onClick={() => void loadSchema()}
                />
              }
            >
              <VStack gap={1}>
                <Text weight="semibold">O banco de Tarefas precisa de uma propriedade de ID.</Text>
                <Text>
                  O Orkio identifica cada tarefa por um ID estável (ex.: ORK-142). No Notion, abra o
                  banco de Tarefas, clique em “+” no cabeçalho da tabela, escolha o tipo “ID” e, se
                  quiser, defina um prefixo. Depois clique em “Recarregar banco”.
                </Text>
              </VStack>
            </Alert>
          )}

          {MAPPING_FIELDS.map((field) => {
            const required = REQUIRED_FIELDS.includes(field)
            const candidates = candidatesFor(field, schema.schema.properties, projectsId)
            const value = mapping[field]
            const noCandidate =
              required && candidates.length === 0 && !(field === 'uniqueId' && lacksUniqueId)
            const description = FIELD_HINTS[field]
            const common = {
              label: fieldLabel(field),
              ...(description ? { description } : {}),
              options: candidates.map((p) => ({
                value: p.id,
                label: p.name,
                description: TYPE_LABELS[p.type] ?? p.type
              })),
              placeholder: candidates.length === 0 ? 'Nenhuma propriedade compatível' : 'Escolha',
              isDisabled: candidates.length === 0,
              ...(noCandidate
                ? {
                    status: {
                      type: 'error' as const,
                      message:
                        field === 'project'
                          ? 'Nenhuma relação aponta para o banco de Projetos escolhido.'
                          : 'Nenhuma propriedade compatível neste banco.'
                    }
                  }
                : {})
            }
            return required ? (
              <Selector
                key={field}
                {...common}
                isRequired
                {...(value ? { value } : {})}
                onChange={(next: string) => setMapping((m) => ({ ...m, [field]: next }))}
              />
            ) : (
              <Selector
                key={field}
                {...common}
                isOptional
                hasClear
                value={value ?? null}
                onChange={(next: string | null) => setMapping((m) => ({ ...m, [field]: next }))}
              />
            )
          })}

          <StatusPreview schema={schema} statusId={mapping.status ?? null} />

          {saveError && (
            <ErrorAlert error={saveError} onReconnect={onReconnect ? reconnect : undefined} />
          )}

          <HStack gap={2}>
            <Button
              variant="primary"
              label="Salvar"
              isLoading={saving}
              isDisabled={missingRequired.length > 0 || lacksUniqueId}
              onClick={() => void save()}
            />
            <Button variant="ghost" label="Voltar" onClick={() => setStep(1)} />
          </HStack>
          {(missingRequired.length > 0 || lacksUniqueId) && (
            <Text type="supporting">
              Para salvar, escolha: {missingRequired.map(fieldLabel).join(', ')}.
            </Text>
          )}
        </VStack>
      )}
    </VStack>
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
    <VStack gap={2}>
      <Text type="supporting">Opções de status:</Text>
      <HStack gap={2} wrap="wrap" aria-label="Opções de status">
        {property.options.map((o) => (
          <Token key={o.id || o.name} label={o.name} color={tokenColor(o.color)} size="sm" />
        ))}
      </HStack>
    </VStack>
  )
}

export function ErrorAlert({
  error,
  onReconnect
}: {
  error: NotionError
  onReconnect: (() => Promise<unknown>) | undefined
}): React.JSX.Element {
  return (
    <Alert
      tone="danger"
      {...(error.canReconnect && onReconnect
        ? {
            action: (
              <Button size="sm" label="Reconectar com Notion" onClick={() => void onReconnect()} />
            )
          }
        : {})}
    >
      {error.message}
    </Alert>
  )
}

const IPC_FAILURE: NotionError = {
  code: 'ipc',
  message: 'Não foi possível falar com o processo principal do Orkio. Reinicie o app.'
}

export async function call<T>(fn: () => Promise<NotionResult<T>>): Promise<NotionResult<T>> {
  try {
    return await fn()
  } catch {
    return { ok: false, error: IPC_FAILURE }
  }
}
