import { useEffect, useState } from 'react'
import { Badge } from '@astryxdesign/core/Badge'
import { Button } from '@astryxdesign/core/Button'
import { Card } from '@astryxdesign/core/Card'
import { Code } from '@astryxdesign/core/Code'
import { Grid } from '@astryxdesign/core/Grid'
import { HStack } from '@astryxdesign/core/HStack'
import { Heading } from '@astryxdesign/core/Heading'
import { Icon } from '@astryxdesign/core/Icon'
import { IconButton } from '@astryxdesign/core/IconButton'
import { Item } from '@astryxdesign/core/Item'
import { List } from '@astryxdesign/core/List'
import { ProgressBar } from '@astryxdesign/core/ProgressBar'
import { Selector } from '@astryxdesign/core/Selector'
import { Skeleton } from '@astryxdesign/core/Skeleton'
import { StackItem } from '@astryxdesign/core/Stack'
import { Text } from '@astryxdesign/core/Text'
import { StatusToken, toneOf } from '../../components/StatusToken'
import { VStack } from '@astryxdesign/core/VStack'
import type { BoardTaskRef } from '../../../../shared/ipc-contract'
import {
  ACTIVITY_GROUP_LABEL,
  PR_REASON_LABEL,
  formatAgo,
  formatDuration,
  type ActivityGroup,
  type HealthLevel,
  type OverviewSnapshot,
  type OverviewTask,
  type ProjectCardView,
  type TaskSection,
  type WaitingKind
} from '../../../../shared/overview'
import { Alert } from '../../components/Alert'
import { PageHeader } from '../../components/PageHeader'
import { ExternalLinkIcon, RefreshIcon } from '../../components/icons'
import { tokenColor, type TokenColor } from '../notion-workspace/notion-colors'
import { useActivity, useOverview } from './useOverview'

const WAITING_LABEL: Record<WaitingKind, { label: string; color: TokenColor }> = {
  gate: { label: 'Gate', color: 'orange' },
  action: { label: 'Aprovação', color: 'orange' },
  choice: { label: 'Escolha', color: 'orange' },
  decision: { label: 'Decisão', color: 'yellow' },
  flow_paused: { label: 'Fluxo pausado', color: 'red' },
  question: { label: 'Pergunta', color: 'orange' },
  permission: { label: 'Permissão', color: 'orange' },
  notion_write: { label: 'Notion', color: 'red' }
}

const HEALTH_COLOR: Record<HealthLevel, TokenColor> = {
  ok: 'green',
  warning: 'yellow',
  problem: 'red',
  off: 'gray'
}

const HEALTH_TEXT: Record<HealthLevel, string> = {
  ok: 'ok',
  warning: 'atenção',
  problem: 'problema',
  off: 'não ligado'
}

/** Relógio para os "há X min" (re-render a cada 30 s). */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(timer)
  }, [])
  return now
}

/**
 * Visão geral (6D): o que espera você, o que está rodando, PRs, projetos, semana e atividade, de
 * todos os projetos. Só dados locais e caches; "Atualizar" faz a verificação completa.
 */
export function OverviewPage({
  onOpenTask,
  onOpenProject,
  onOpenProjects
}: {
  onOpenTask(ref: BoardTaskRef): void
  /** Quadro do projeto (cartão "Por projeto"). */
  onOpenProject(projectId: string): void
  onOpenProjects(): void
}): React.JSX.Element {
  const overview = useOverview()
  const now = useNow()
  const { snapshot } = overview
  const open = (task: OverviewTask, section: TaskSection): void =>
    onOpenTask({ projectId: task.projectId, taskId: task.taskId, section })

  return (
    <VStack gap={6}>
      <PageHeader
        title="Visão geral"
        subtitle="O que espera você e o que está andando em todos os projetos."
        action={
          <Button
            variant="ghost"
            label="Atualizar"
            icon={<Icon icon={RefreshIcon} />}
            isLoading={overview.refreshing}
            onClick={() => void overview.refresh()}
          />
        }
      />
      {overview.error && <Alert tone="danger">{overview.error}</Alert>}
      {!snapshot ? (
        overview.loading ? (
          <VStack gap={3} aria-label="Carregando a Visão geral">
            <Skeleton height={120} />
            <Skeleton height={200} index={1} />
          </VStack>
        ) : null
      ) : (
        <>
          <Text type="supporting" data-testid="overview-updated">
            Atualizado {formatAgo(snapshot.generatedAt, now)}
            {snapshot.notices.length > 0 ? ` · ${snapshot.notices.join(' ')}` : ''}
          </Text>
          <WaitingSection snapshot={snapshot} now={now} onOpen={open} />
          <Grid gap={4} columns={{ minWidth: 320, max: 2, repeat: 'fit' }}>
            <RunningSection snapshot={snapshot} now={now} onOpen={open} />
            <PrSection snapshot={snapshot} onOpen={open} />
          </Grid>
          <ProjectsSection
            projects={snapshot.projects}
            onOpenProject={onOpenProject}
            onOpenProjects={onOpenProjects}
          />
          <WeekSection snapshot={snapshot} />
          <ActivitySection snapshot={snapshot} onOpen={open} />
        </>
      )}
    </VStack>
  )
}

function SectionCard({
  id,
  title,
  count,
  action,
  children
}: {
  id: string
  title: string
  count?: number
  action?: React.ReactNode
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Card role="region" aria-labelledby={id}>
      <VStack gap={3}>
        <HStack gap={2} vAlign="center">
          <Heading level={2} id={id}>
            {title}
          </Heading>
          {count !== undefined && count > 0 && (
            <Badge
              label={String(count)}
              variant={id === 'overview-waiting' ? 'orange' : 'neutral'}
            />
          )}
          <StackItem size="fill" />
          {action}
        </HStack>
        {children}
      </VStack>
    </Card>
  )
}

/** ID (mono) + título; sem cache do Notion ainda, o que houver. */
function TaskName({ task }: { task: OverviewTask }): React.JSX.Element {
  return (
    <HStack gap={2} vAlign="center">
      {task.displayId && <Code>{task.displayId}</Code>}
      <Text weight="medium" maxLines={1}>
        {task.title ?? (task.displayId ? '' : 'Tarefa do Notion')}
      </Text>
    </HStack>
  )
}

function WaitingSection({
  snapshot,
  now,
  onOpen
}: {
  snapshot: OverviewSnapshot
  now: Date
  onOpen(task: OverviewTask, section: TaskSection): void
}): React.JSX.Element {
  return (
    <SectionCard id="overview-waiting" title="Esperando você" count={snapshot.waiting.length}>
      {snapshot.waiting.length === 0 ? (
        <Text color="secondary">Nada esperando por você agora.</Text>
      ) : (
        <List hasDividers density="compact" aria-label="Itens esperando você">
          {snapshot.waiting.map((w) => (
            <Item
              as="li"
              key={w.key}
              data-testid="waiting-item"
              startContent={
                <StatusToken
                  label={WAITING_LABEL[w.kind].label}
                  tone={toneOf(WAITING_LABEL[w.kind].color)}
                />
              }
              label={<TaskName task={w.task} />}
              description={`${w.task.projectName} · ${w.what} · ${formatAgo(w.since, now)}`}
              endContent={
                <Button size="sm" label="Abrir" onClick={() => onOpen(w.task, w.section)} />
              }
            />
          ))}
        </List>
      )}
    </SectionCard>
  )
}

function RunningSection({
  snapshot,
  now,
  onOpen
}: {
  snapshot: OverviewSnapshot
  now: Date
  onOpen(task: OverviewTask, section: TaskSection): void
}): React.JSX.Element {
  return (
    <SectionCard id="overview-running" title="Em execução agora" count={snapshot.running.length}>
      {snapshot.running.length === 0 ? (
        <Text color="secondary">Nenhuma execução do Claude Code nem fluxo rodando.</Text>
      ) : (
        <List hasDividers density="compact" aria-label="Execuções e fluxos rodando">
          {snapshot.running.map((r) => (
            <Item
              as="li"
              key={r.key}
              label={<TaskName task={r.task} />}
              description={`${r.label} · ${r.task.projectName} · ${
                r.state === 'queued'
                  ? 'na fila'
                  : formatDuration(now.getTime() - Date.parse(r.startedAt))
              }`}
              endContent={
                <Button
                  size="sm"
                  variant="ghost"
                  label="Ver log"
                  onClick={() => onOpen(r.task, r.section === 'flow' ? 'flow' : 'claude')}
                />
              }
            />
          ))}
        </List>
      )}
    </SectionCard>
  )
}

function PrSection({
  snapshot,
  onOpen
}: {
  snapshot: OverviewSnapshot
  onOpen(task: OverviewTask, section: TaskSection): void
}): React.JSX.Element {
  return (
    <SectionCard id="overview-prs" title="PRs que precisam de atenção" count={snapshot.prs.length}>
      {snapshot.prs.length === 0 ? (
        <Text color="secondary">Nenhuma PR com CI vermelho, mudanças pedidas ou sem review.</Text>
      ) : (
        <List hasDividers density="compact" aria-label="PRs que precisam de atenção">
          {snapshot.prs.map((p) => (
            <Item
              as="li"
              key={p.key}
              label={
                <HStack gap={2} vAlign="center">
                  <Code>#{p.number}</Code>
                  <TaskName task={p.task} />
                </HStack>
              }
              description={`${p.task.projectName} · ${p.reasons
                .map((r) =>
                  r === 'unresolved_comments' && p.unresolved
                    ? `${p.unresolved} comentário(s) não resolvido(s)`
                    : r === 'stale_review' && p.openDays !== null
                      ? `Sem review há ${p.openDays} d`
                      : PR_REASON_LABEL[r]
                )
                .join(' · ')}`}
              endContent={
                <HStack gap={1}>
                  <IconButton
                    size="sm"
                    variant="ghost"
                    label={`Abrir a PR #${p.number} no GitHub`}
                    icon={<Icon icon={ExternalLinkIcon} />}
                    onClick={() => void window.orkio.openExternal(p.url)}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    label="Abrir"
                    onClick={() => onOpen(p.task, 'flow')}
                  />
                </HStack>
              }
            />
          ))}
        </List>
      )}
    </SectionCard>
  )
}

function ProjectsSection({
  projects,
  onOpenProject,
  onOpenProjects
}: {
  projects: ProjectCardView[]
  onOpenProject(projectId: string): void
  onOpenProjects(): void
}): React.JSX.Element {
  return (
    <VStack gap={3} role="region" aria-labelledby="overview-projects">
      <Heading level={2} id="overview-projects">
        Por projeto
      </Heading>
      {projects.length === 0 ? (
        <Text color="secondary">Nenhum projeto ainda.</Text>
      ) : (
        <Grid gap={4} columns={{ minWidth: 280, max: 3, repeat: 'fill' }}>
          {projects.map((p) => (
            <ProjectCard
              key={p.projectId}
              project={p}
              onOpen={() =>
                p.hasBoard && p.health.notion !== 'off'
                  ? onOpenProject(p.projectId)
                  : onOpenProjects()
              }
            />
          ))}
        </Grid>
      )}
    </VStack>
  )
}

function ProjectCard({
  project: p,
  onOpen
}: {
  project: ProjectCardView
  onOpen(): void
}): React.JSX.Element {
  const max = Math.max(p.total, 1)
  const opensBoard = p.hasBoard && p.health.notion !== 'off'
  return (
    <Card role="group" aria-label={p.name}>
      <VStack gap={3}>
        <HStack gap={2} vAlign="center">
          <StackItem size="fill">
            <Heading level={3}>{p.name}</Heading>
          </StackItem>
          {p.waiting > 0 && <Badge label={String(p.waiting)} variant="orange" />}
        </HStack>
        <HStack gap={1} wrap="wrap">
          {(
            [
              ['Pasta', p.health.folder],
              ['GitHub', p.health.github],
              ['Notion', p.health.notion]
            ] as const
          ).map(([name, level]) => (
            <StatusToken
              key={name}
              tone={toneOf(HEALTH_COLOR[level])}
              label={`${name}: ${HEALTH_TEXT[level]}`}
            />
          ))}
          {p.automationsPaused && <StatusToken tone="warning" label="Automações pausadas" />}
        </HStack>
        {p.health.message && <Text type="supporting">{p.health.message}</Text>}
        {p.hasBoard ? (
          <VStack gap={2} aria-label={`Tarefas por etapa em ${p.name}`}>
            {p.stages.map((s) => (
              <VStack key={s.id} gap={1}>
                <HStack gap={2}>
                  <StackItem size="fill">
                    <Text type="supporting">{s.name}</Text>
                  </StackItem>
                  <Text type="supporting" hasTabularNumbers>
                    {s.count}
                  </Text>
                </HStack>
                <ProgressBar
                  label={`${s.name}: ${s.count} de ${p.total}`}
                  isLabelHidden
                  value={s.count}
                  max={max}
                  variant={s.color && tokenColor(s.color) === 'red' ? 'error' : 'success'}
                />
              </VStack>
            ))}
            <Text type="supporting">
              {p.total} tarefa(s)
              {p.noStage > 0 ? ` · ${p.noStage} sem etapa` : ''}
              {p.blocked > 0 ? ` · ${p.blocked} bloqueada(s)` : ''}
              {p.pausedTasks > 0 ? ` · ${p.pausedTasks} com automação pausada` : ''}
            </Text>
          </VStack>
        ) : (
          <Text type="supporting">
            {p.health.notion === 'off'
              ? 'Vincule a um projeto do Notion para ver o quadro.'
              : 'Quadro ainda não criado.'}
          </Text>
        )}
        <HStack>
          <Button
            size="sm"
            variant="ghost"
            label={opensBoard ? 'Abrir quadro' : 'Ver em Projetos'}
            onClick={onOpen}
          />
        </HStack>
      </VStack>
    </Card>
  )
}

function Metric({
  label,
  value,
  hint
}: {
  label: string
  value: string
  hint?: string
}): React.JSX.Element {
  return (
    <Card role="group" aria-label={label}>
      <VStack gap={1}>
        <Text type="supporting">{label}</Text>
        <Heading level={3}>{value}</Heading>
        {hint && <Text type="supporting">{hint}</Text>}
      </VStack>
    </Card>
  )
}

function WeekSection({ snapshot }: { snapshot: OverviewSnapshot }): React.JSX.Element {
  const w = snapshot.week
  const unknown = '—'
  return (
    <VStack gap={3} role="region" aria-labelledby="overview-week">
      <Heading level={2} id="overview-week">
        Últimos 7 dias
      </Heading>
      <Grid gap={4} columns={{ minWidth: 180, max: 5, repeat: 'fit' }}>
        <Metric label="Tarefas finalizadas" value={String(w.finished)} />
        <Metric
          label="PRs abertas"
          value={w.prsOpened === null ? unknown : String(w.prsOpened)}
          {...(w.prsOpened === null ? { hint: 'Sem dados do GitHub ainda' } : {})}
        />
        <Metric
          label="PRs mergeadas"
          value={w.prsMerged === null ? unknown : String(w.prsMerged)}
        />
        <Metric
          label="Custo do Claude Code"
          value={w.cost.usd.toLocaleString('pt-BR', { style: 'currency', currency: 'USD' })}
          hint={
            w.cost.total === 0
              ? 'Nenhuma execução'
              : `${w.cost.known} de ${w.cost.total} execução(ões) com custo conhecido`
          }
        />
        <Metric
          label="Tempo médio em Revisado"
          value={w.reviewAvgMs === null ? unknown : formatDuration(w.reviewAvgMs)}
          hint={
            w.reviewSamples === 0
              ? 'Nenhuma saída de Revisado'
              : `${w.reviewSamples} passagem(ns) pela etapa`
          }
        />
      </Grid>
    </VStack>
  )
}

const GROUPS = Object.keys(ACTIVITY_GROUP_LABEL) as ActivityGroup[]

function ActivitySection({
  snapshot,
  onOpen
}: {
  snapshot: OverviewSnapshot
  onOpen(task: OverviewTask, section: TaskSection): void
}): React.JSX.Element {
  const [projectId, setProjectId] = useState<string | null>(null)
  const [group, setGroup] = useState<ActivityGroup | null>(null)
  const activity = useActivity(projectId, group, snapshot.generatedAt)
  return (
    <SectionCard
      id="overview-activity"
      title="Atividade recente"
      action={
        <HStack gap={2} wrap="wrap">
          {snapshot.projects.length > 1 && (
            <Selector
              size="sm"
              label="Projeto"
              isLabelHidden
              placeholder="Todos os projetos"
              hasClear
              options={snapshot.projects.map((p) => ({ value: p.projectId, label: p.name }))}
              value={projectId}
              onChange={(value: string | null) => setProjectId(value)}
            />
          )}
          <Selector
            size="sm"
            label="Tipo"
            isLabelHidden
            placeholder="Todos os tipos"
            hasClear
            options={GROUPS.map((g) => ({ value: g, label: ACTIVITY_GROUP_LABEL[g] }))}
            value={group}
            onChange={(value: string | null) => setGroup((value as ActivityGroup | null) ?? null)}
          />
        </HStack>
      }
    >
      {activity.error && <Alert tone="warning">{activity.error}</Alert>}
      {activity.items === null ? (
        <Skeleton height={80} aria-label="Carregando atividade" />
      ) : activity.items.length === 0 ? (
        <Text color="secondary">Nada nos últimos 7 dias.</Text>
      ) : (
        <List hasDividers density="compact" aria-label="Atividade recente">
          {activity.items.map((a) => (
            <Item
              as="li"
              key={a.id}
              label={a.text}
              description={`${new Date(a.at).toLocaleString('pt-BR', {
                dateStyle: 'short',
                timeStyle: 'short'
              })} · ${[a.task.displayId, a.task.title].filter(Boolean).join(' ') || 'Tarefa do Notion'} · ${a.task.projectName} · ${ACTIVITY_GROUP_LABEL[a.group]}`}
              endContent={
                <HStack gap={1}>
                  {a.link && (
                    <IconButton
                      size="sm"
                      variant="ghost"
                      label="Abrir no GitHub"
                      icon={<Icon icon={ExternalLinkIcon} />}
                      onClick={() => void window.orkio.openExternal(a.link!)}
                    />
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    label="Abrir"
                    onClick={() => onOpen(a.task, a.section)}
                  />
                </HStack>
              }
            />
          ))}
        </List>
      )}
      {activity.hasMore && (
        <HStack>
          <Button
            size="sm"
            variant="ghost"
            label="Mostrar mais"
            isLoading={activity.loadingMore}
            onClick={activity.loadMore}
          />
        </HStack>
      )}
    </SectionCard>
  )
}
