import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { StatusToken } from '@/components/StatusToken'
import { cn } from '@/lib/utils'
import { Alert } from '../../components/Alert'
import { EditorIcon, GitBranchIcon, PullRequestIcon, TerminalIcon } from '../../components/icons'
import { OpenPrButton, OpenPrFeedback } from './OpenPrButton'
import { canOpenPr } from './open-pr'
import { PrHoverCard } from '../../components/PrHoverCard'
import { CI_STATUS, isPrOpen } from '../../lib/status-text'
import { useTaskDiff, useTaskView } from './task-view'
import { contextTone, folderName, latestContextPercent } from './environment'

const TITLE = 'text-2xs font-medium tracking-wider text-subtle-foreground uppercase'
const BAR: Record<'ok' | 'warn' | 'danger', string> = {
  ok: 'bg-ok',
  warn: 'bg-warn',
  danger: 'bg-danger'
}

/**
 * "Ambiente" (topo da aba Detalhes), como a coluna do Claude Desktop: onde o agente trabalha
 * (projeto, pasta, branch, editor/terminal), quanto do contexto da conversa já foi usado e o que
 * mudou na branch, com a PR (ou "Abrir PR").
 */
export function EnvironmentPanel(): React.JSX.Element {
  const view = useTaskView()
  const { projectId, taskId, projectName, signals, runs } = view
  const workspace = runs.state?.workspace ?? null
  const [error, setError] = useState<string | null>(null)
  // Contexto (%) da execução mais recente: o log ao vivo dela (a conversa já o acompanha).
  const latestId = runs.state?.runs[0]?.id ?? null
  const context =
    latestId && runs.selectedRunId === latestId ? latestContextPercent(runs.log) : null
  // `+N −M` da branch contra a base: o mesmo diff da tela (sem ler de novo).
  const stat = useTaskDiff(workspace !== null).value?.shortstat ?? null
  const pr = signals?.pr ?? null
  const ci = isPrOpen(pr) && pr?.checks ? CI_STATUS[pr.checks] : null

  async function open(kind: 'cursor' | 'code' | 'terminal'): Promise<void> {
    const r =
      kind === 'terminal'
        ? await window.orkio.claude.openTerminal(projectId, taskId)
        : await window.orkio.claude.openEditor(projectId, taskId, kind)
    setError(r.ok ? null : r.error.message)
  }

  return (
    <section
      aria-label="Ambiente"
      data-testid="environment-panel"
      className="flex flex-col gap-4 border-b border-border-soft pb-5"
    >
      <div className="flex flex-col gap-2">
        <h3 className={TITLE}>Ambiente</h3>
        <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-1 text-xs">
          {projectName && (
            <>
              <dt className="text-muted-foreground">Projeto</dt>
              <dd className="truncate text-foreground">{projectName}</dd>
            </>
          )}
          {workspace ? (
            <>
              <dt className="text-muted-foreground">Pasta</dt>
              <dd className="truncate font-mono text-foreground" title={workspace.path}>
                <span data-testid="environment-folder">{folderName(workspace.path)}</span>
              </dd>
              <dt className="text-muted-foreground">Branch</dt>
              <dd className="flex min-w-0 items-center gap-1.5 font-mono text-foreground">
                <GitBranchIcon className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate" data-testid="environment-branch">
                  {workspace.branch}
                </span>
              </dd>
            </>
          ) : (
            <>
              <dt className="text-muted-foreground">Pasta</dt>
              <dd className="text-muted-foreground">Criada quando o agente começar.</dd>
            </>
          )}
        </dl>
        {workspace && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => void open('cursor')}>
              <EditorIcon />
              Cursor
            </Button>
            <Button size="sm" variant="outline" onClick={() => void open('code')}>
              <EditorIcon />
              VS Code
            </Button>
            <Button size="sm" variant="outline" onClick={() => void open('terminal')}>
              <TerminalIcon />
              Abrir terminal aqui
            </Button>
          </div>
        )}
        {error && <Alert tone="danger">{error}</Alert>}
      </div>

      {context !== null && (
        <div className="flex flex-col gap-1.5" data-testid="environment-context">
          <div className="flex items-center justify-between text-xs">
            <h3 className={TITLE}>Contexto</h3>
            <span className="text-foreground tabular">{context}%</span>
          </div>
          <div
            role="progressbar"
            aria-label="Contexto usado"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={context}
            className="h-1 overflow-hidden rounded-full bg-muted"
          >
            <div
              className={cn('h-full rounded-full', BAR[contextTone(context)])}
              style={{ width: `${context}%` }}
            />
          </div>
          <span className="sr-only">Contexto: {context}%</span>
        </div>
      )}

      {workspace && (
        <div className="flex flex-col gap-2">
          <h3 className={TITLE}>Mudanças</h3>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
            {stat && (
              <span className="font-mono" data-testid="environment-shortstat">
                <span className="text-ok">+{stat.added}</span>{' '}
                <span className="text-danger">−{stat.removed}</span>
              </span>
            )}
            {pr && (
              <>
                <PrHoverCard pr={pr}>
                  <Button
                    size="xs"
                    variant="ghost"
                    className="font-mono"
                    aria-label={`Abrir a PR #${pr.number} no GitHub`}
                    onClick={() => void window.orkio.openExternal(pr.url)}
                  >
                    <PullRequestIcon />#{pr.number}
                  </Button>
                </PrHoverCard>
                {pr.additions !== undefined && pr.deletions !== undefined && (
                  <span className="font-mono text-muted-foreground">
                    +{pr.additions} −{pr.deletions}
                  </span>
                )}
                {ci && <StatusToken {...ci} />}
              </>
            )}
            {canOpenPr(pr) && <OpenPrButton size="sm" hint={false} />}
          </div>
          {canOpenPr(pr) && view.openPr.blocked && (
            <span className="text-xs text-muted-foreground">Espere o fluxo atual terminar</span>
          )}
          <OpenPrFeedback />
        </div>
      )}
    </section>
  )
}
