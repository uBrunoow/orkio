import { useEffect, useState } from 'react'
import { Button } from '@astryxdesign/core/Button'
import { Card } from '@astryxdesign/core/Card'
import { HStack } from '@astryxdesign/core/HStack'
import { Heading } from '@astryxdesign/core/Heading'
import { Icon } from '@astryxdesign/core/Icon'
import { Skeleton } from '@astryxdesign/core/Skeleton'
import { StackItem } from '@astryxdesign/core/Stack'
import { Table } from '@astryxdesign/core/Table'
import { Text } from '@astryxdesign/core/Text'
import { Timestamp } from '@astryxdesign/core/Timestamp'
import { VStack } from '@astryxdesign/core/VStack'
import type { ActivityGroup, ActivityItem } from '../../../shared/overview'
import type { Execution } from './executions'
import { EditIcon } from './icons'
import { StatusToken } from './StatusToken'

/**
 * Detalhe "em frase" de uma regra ou fluxo (fase 6): a frase como título, "Começa" e "Faz",
 * execuções e uma coluna de detalhes. O editor fica atrás de "Editar".
 */
export function SentenceDetail({
  label,
  sentence,
  starts,
  does,
  executions,
  details,
  actions,
  onEdit
}: {
  /** Nome acessível da região (ex.: "Automação PR aprovada"). */
  label: string
  sentence: string
  starts: React.ReactNode
  does: React.ReactNode
  executions: React.ReactNode
  details: readonly { label: string; value: React.ReactNode }[]
  /** Ações extras ao lado de "Editar" (ex.: Ativar/Desativar). */
  actions?: React.ReactNode
  onEdit(): void
}): React.JSX.Element {
  return (
    <Card role="region" aria-label={label} padding={4}>
      <VStack gap={5}>
        <HStack gap={3} vAlign="start">
          <StackItem size="fill">
            <Heading level={2} data-testid="detail-sentence">
              {sentence}
            </Heading>
          </StackItem>
          <HStack gap={1} vAlign="center">
            {actions}
            <Button
              variant="secondary"
              label="Editar"
              icon={<Icon icon={EditIcon} />}
              onClick={onEdit}
            />
          </HStack>
        </HStack>
        <HStack gap={6} vAlign="start">
          <StackItem size="fill" style={{ minWidth: 0 }}>
            <VStack gap={5}>
              <VStack gap={2} role="group" aria-label="Começa">
                <Heading level={3}>Começa</Heading>
                {starts}
              </VStack>
              <VStack gap={2} role="group" aria-label="Faz">
                <Heading level={3}>Faz</Heading>
                {does}
              </VStack>
              <VStack gap={2} role="group" aria-label="Execuções">
                <Heading level={3}>Execuções</Heading>
                {executions}
              </VStack>
            </VStack>
          </StackItem>
          <VStack
            gap={3}
            width="calc(var(--spacing-12) * 4)"
            style={{ flexShrink: 0 }}
            role="group"
            aria-label="Detalhes"
            data-testid="detail-column"
          >
            {details.map((d) => (
              <VStack key={d.label} gap={0.5}>
                <Text type="supporting" color="secondary">
                  {d.label}
                </Text>
                {typeof d.value === 'string' ? <Text>{d.value}</Text> : d.value}
              </VStack>
            ))}
          </VStack>
        </HStack>
      </VStack>
    </Card>
  )
}

/** Atividade recente do projeto num grupo (a mesma da Visão geral), recarregada quando muda. */
export function useProjectActivity(projectId: string, group: ActivityGroup): ActivityItem[] | null {
  const [items, setItems] = useState<ActivityItem[] | null>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let alive = true
    void window.orkio.overview
      .activity({ projectId, group, limit: 200 })
      .then((r) => {
        if (alive) setItems(r.ok ? r.value.items : [])
      })
      .catch(() => {
        if (alive) setItems([])
      })
    return () => {
      alive = false
    }
  }, [projectId, group, tick])
  useEffect(() => window.orkio.overview.onChanged(() => setTick((n) => n + 1)), [])
  return items
}

interface ExecutionRow extends Record<string, unknown> {
  id: number
  at: string
  task: string
  outcome: Execution
}

/** Tabela "Quando · Tarefa · Resultado"; vazio vira uma frase. */
export function ExecutionsTable({
  executions,
  empty
}: {
  executions: readonly Execution[] | null
  empty: string
}): React.JSX.Element {
  if (executions === null) return <Skeleton height={64} aria-label="Carregando execuções" />
  if (executions.length === 0)
    return (
      <Text type="supporting" color="secondary" data-testid="executions-empty">
        {empty}
      </Text>
    )
  const rows: ExecutionRow[] = executions.slice(0, 20).map((e) => ({
    id: e.id,
    at: e.at,
    task: [e.task.displayId, e.task.title].filter(Boolean).join(' ') || e.task.taskId,
    outcome: e
  }))
  return (
    <VStack data-testid="executions">
      <Table<ExecutionRow>
        data={rows}
        idKey="id"
        density="compact"
        columns={[
          {
            key: 'at',
            header: 'Quando',
            renderCell: (r) => <Timestamp value={r.at} format="auto" />
          },
          { key: 'task', header: 'Tarefa' },
          {
            key: 'outcome',
            header: 'Resultado',
            renderCell: (r) => <StatusToken label={r.outcome.outcome} tone={r.outcome.tone} />
          }
        ]}
      />
    </VStack>
  )
}
