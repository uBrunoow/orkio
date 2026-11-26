import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Alert } from '../../components/Alert'
import { StatusBadge } from '../../components/StatusToken'
import {
  BoardIcon,
  ChevronRightIcon,
  EditorIcon,
  FolderSearchIcon,
  GaugeIcon,
  GitBranchIcon,
  ProjectsIcon,
  PullRequestIcon,
  ReviewRequestIcon,
  TerminalIcon
} from '../../components/icons'
import { prPills } from '../../lib/status-text'
import { ipcResult } from '../../lib/ipc'
import { plural } from '../../lib/format'
import { OpenPrButton, OpenPrFeedback } from './OpenPrButton'
import { canOpenPr } from './open-pr'
import { contextTone, folderName, latestContextUsage } from './environment'
import type { PanelTab } from './panel-tab'
import { useTaskDiff, useTaskView } from './task-view'
import { StageSelector } from './TaskDetails'
import { TaskServers } from '../servers/TaskServers'

const TITLE = 'px-2 text-xs font-medium text-muted-foreground'
const ROW = 'flex min-h-8 w-full min-w-0 items-center gap-2.5 rounded-md px-2 py-1 text-sm'
const LINK = 'outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40 text-left'
const BAR: Record<'ok' | 'warn' | 'danger', string> = {
  ok: 'bg-ok',
  warn: 'bg-warn',
  danger: 'bg-danger'
}

/** Linha de informação: ícone, texto e (opcional) ações à direita. */
function Row({
  icon,
  children,
  trailing,
  className
}: {
  icon: React.ReactNode
  children: React.ReactNode
  trailing?: React.ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <div className={cn(ROW, className)}>
      <span aria-hidden="true" className="flex size-4 shrink-0 items-center text-subtle-foreground">
        {icon}
      </span>
      <span className="flex min-w-0 flex-1 items-center gap-2">{children}</span>
      {trailing && <span className="flex shrink-0 items-center gap-0.5">{trailing}</span>}
    </div>
  )
}

/** Linha que abre uma subtela do painel (PR & CI, Revisão, Contexto): texto › e o resumo. */
function LinkRow({
  icon,
  label,
  summary,
  onClick
}: {
  icon: React.ReactNode
  label: string
  summary?: React.ReactNode
  onClick(): void
}): React.JSX.Element {
  return (
    <button type="button" aria-label={label} onClick={onClick} className={cn(ROW, LINK)}>
      <span aria-hidden="true" className="flex size-4 shrink-0 items-center text-subtle-foreground">
        {icon}
      </span>
      <span className="flex shrink-0 items-center gap-1 text-foreground">
        {label}
        <ChevronRightIcon aria-hidden="true" className="size-3.5 text-subtle-foreground" />
      </span>
      <span className="flex min-w-0 flex-1 items-center justify-end gap-2 text-xs text-muted-foreground">
        {summary}
      </span>
    </button>
  )
}

/**
 * Topo da coluna Detalhes (como o painel do Claude Desktop): Ambiente (projeto, pasta, branch e os
 * atalhos de editor/terminal), Contexto (abre a subtela) e Mudanças (diff, PR com o estado e a
 * revisão). Cada linha que tem mais coisa abre a subtela dela com `onOpen`.
 */
export function EnvironmentPanel({ onOpen }: { onOpen(tab: PanelTab): void }): React.JSX.Element {
  const view = useTaskView()
  const { projectId, taskId, projectName, signals, runs } = view
  const workspace = runs.state?.workspace ?? null
  const [error, setError] = useState<string | null>(null)
  // `+N −M` da branch contra a base: o mesmo diff da tela (sem ler de novo).
  const stat = useTaskDiff(workspace !== null).value?.shortstat ?? null
  const pr = signals?.pr ?? null
  const latest = runs.state?.runs.find((r) => !r.side) ?? null
  const usage = latest && runs.selectedRunId === latest.id ? latestContextUsage(runs.log) : null
  const files = latest ? (runs.state?.runs.find((r) => r.summary)?.summary?.files.length ?? 0) : 0

  async function open(kind: 'cursor' | 'code' | 'terminal'): Promise<void> {
    const r =
      kind === 'terminal'
        ? await ipcResult(() => window.orkio.claude.openTerminal(projectId, taskId))
        : await ipcResult(() => window.orkio.claude.openEditor(projectId, taskId, kind))
    setError(r.ok ? null : r.error.message)
  }
  const iconButton = (
    label: string,
    icon: React.ReactNode,
    onClick: () => void
  ): React.ReactNode => (
    <Button
      size="icon-xs"
      variant="ghost"
      aria-label={label}
      title={label}
      className="text-subtle-foreground hover:text-foreground"
      onClick={onClick}
    >
      {icon}
    </Button>
  )

  return (
    <div className="flex flex-col gap-4">
      <section
        aria-label="Ambiente"
        data-testid="environment-panel"
        className="flex flex-col gap-0.5"
      >
        <h3 className={TITLE}>Ambiente</h3>
        {projectName && (
          <Row icon={<ProjectsIcon className="size-4" />}>
            <span className="truncate text-foreground">{projectName}</span>
          </Row>
        )}
        {/* Etapa no quadro (antes ficava na barra do topo): trocar aqui move a tarefa. */}
        <Row icon={<BoardIcon className="size-4" />}>
          <StageSelector />
        </Row>
        <Row
          icon={<FolderSearchIcon className="size-4" />}
          trailing={
            workspace && (
              <>
                {iconButton('Abrir no Cursor', <EditorIcon />, () => void open('cursor'))}
                {iconButton('Abrir no VS Code', <EditorIcon />, () => void open('code'))}
                {view.openTerminal &&
                  iconButton('Terminal no Orkio', <TerminalIcon />, view.openTerminal)}
                {iconButton('Abrir terminal aqui', <TerminalIcon />, () => void open('terminal'))}
              </>
            )
          }
        >
          {workspace ? (
            <span
              className="truncate font-mono text-xs text-foreground"
              title={workspace.path}
              data-testid="environment-folder"
            >
              {folderName(workspace.path)}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">
              Pasta criada quando o agente começar
            </span>
          )}
        </Row>
        {workspace && (
          <Row icon={<GitBranchIcon className="size-4" />}>
            <span
              className="truncate font-mono text-xs text-foreground"
              data-testid="environment-branch"
            >
              {workspace.branch}
            </span>
          </Row>
        )}
        {error && <Alert tone="danger">{error}</Alert>}
      </section>

      <TaskServers projectId={projectId} taskId={taskId} hasWorkspace={workspace !== null} />

      <section
        aria-label="Contexto e mudanças"
        className="flex flex-col gap-0.5 border-t border-border-soft pt-3"
      >
        <LinkRow
          icon={<GaugeIcon className="size-4" />}
          label="Contexto"
          onClick={() => onOpen('context')}
          summary={
            usage ? (
              <>
                <span className="tabular-nums" data-testid="environment-context">
                  {usage.percent}%
                </span>
                <span aria-hidden="true" className="h-1 w-10 overflow-hidden rounded-full bg-muted">
                  <span
                    className={cn('block h-full rounded-full', BAR[contextTone(usage.percent)])}
                    style={{ width: `${usage.percent}%` }}
                  />
                </span>
              </>
            ) : (
              'depois do primeiro turno'
            )
          }
        />
        <LinkRow
          icon={<PullRequestIcon className="size-4" />}
          label="PR & CI"
          onClick={() => onOpen('pr')}
          summary={
            pr ? (
              <>
                <span className="truncate font-mono">#{pr.number}</span>
                {prPills(pr)
                  .filter((p) => p.kind !== 'comments')
                  .slice(0, 2)
                  .map((p) => (
                    <StatusBadge key={p.kind} label={p.label} tone={p.tone} />
                  ))}
              </>
            ) : (
              'sem PR'
            )
          }
        />
        {pr && (
          <LinkRow
            icon={<ReviewRequestIcon className="size-4" />}
            label="Revisão"
            onClick={() => onOpen('review')}
            summary={
              pr.unresolvedComments ? (
                <StatusBadge
                  label={plural(pr.unresolvedComments, 'comentário', 'comentários')}
                  tone="warning"
                />
              ) : (
                'comentários da PR'
              )
            }
          />
        )}
      </section>

      {(workspace || files > 0) && (
        <section
          aria-label="Mudanças"
          className="flex flex-col gap-1.5 border-t border-border-soft pt-3"
        >
          <div className="flex items-center justify-between pr-1">
            <h3 className={TITLE}>Mudanças</h3>
            <Button size="xs" variant="ghost" onClick={() => onOpen('changes')}>
              Ver mudanças
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-2 text-xs">
            {stat && (
              <span className="font-mono" data-testid="environment-shortstat">
                <span className="text-ok">+{stat.added}</span>{' '}
                <span className="text-danger">−{stat.removed}</span>
              </span>
            )}
            {files > 0 && (
              <span className="text-muted-foreground">{plural(files, 'arquivo', 'arquivos')}</span>
            )}
            {canOpenPr(pr) && workspace && <OpenPrButton size="sm" hint={false} />}
          </div>
          {canOpenPr(pr) && view.openPr.blocked && (
            <span className="px-2 text-xs text-muted-foreground">
              Espere o fluxo atual terminar
            </span>
          )}
          <div className="px-2">
            <OpenPrFeedback />
          </div>
        </section>
      )}
    </div>
  )
}
