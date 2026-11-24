import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/Spinner'
import { StatusToken, type StatusTone } from '@/components/StatusToken'
import { cn } from '@/lib/utils'
import type { AgentRunView, TaskWorkspace } from '../../../../shared/agent-run'
import type { TaskSignals } from '../../../../shared/ipc-contract'
import { Alert } from '../../components/Alert'
import { EditorIcon, GitBranchIcon, PullRequestIcon, TerminalIcon } from '../../components/icons'
import { OpenPrFeedback, canOpenPr, useOpenPr } from '../board/OpenPrButton'
import { PrHoverCard } from '../board/PrHoverCard'
import { contextTone, folderName, latestContextPercent } from './environment'

const TITLE = 'text-2xs font-medium tracking-wider text-subtle-foreground uppercase'
const BAR: Record<'ok' | 'warn' | 'danger', string> = {
  ok: 'bg-ok',
  warn: 'bg-warn',
  danger: 'bg-danger'
}

/** Contexto (%) da execução mais recente: lê o log e acompanha os eventos ao vivo. */
function useContextPercent(run: AgentRunView | null): number | null {
  const runId = run?.id ?? null
  const [known, setKnown] = useState<{ runId: string; percent: number } | null>(null)
  useEffect(() => {
    let active = true
    if (!runId) return
    void window.orkio.claude
      .readLog(runId)
      .then((log) => {
        const next = latestContextPercent(log)
        if (active && next !== null)
          setKnown((now) => (now && now.runId === runId ? now : { runId, percent: next }))
      })
      .catch(() => undefined)
    const off = window.orkio.claude.onRunEvent((m) => {
      if (m.runId === runId && m.event.kind === 'usage') {
        const next = latestContextPercent([m.event])
        if (next !== null) setKnown({ runId, percent: next })
      }
    })
    return () => {
      active = false
      off()
    }
  }, [runId])
  // Valor de outra execução (a tarefa ganhou uma nova) não vale: some até o primeiro uso.
  return known && known.runId === runId ? known.percent : null
}

/** `+N −M` da branch contra a base, pelo `git diff` do ambiente (sem ler o diff inteiro aqui). */
function useShortstat(
  projectId: string,
  taskId: string,
  enabled: boolean,
  refreshKey: number
): { added: number; removed: number } | null {
  const [stat, setStat] = useState<{ added: number; removed: number } | null>(null)
  useEffect(() => {
    if (!enabled) return
    let active = true
    void window.orkio.claude
      .diff(projectId, taskId)
      .then((r) => {
        if (active) setStat(r.ok ? r.value.shortstat : null)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [projectId, taskId, enabled, refreshKey])
  return stat
}

const CI_LABEL: Record<
  NonNullable<NonNullable<TaskSignals['pr']>['checks']>,
  [string, StatusTone]
> = {
  success: ['CI ok', 'success'],
  failure: ['CI falhou', 'danger'],
  pending: ['CI rodando', 'running']
}

/**
 * "Ambiente" (topo da aba Detalhes), como a coluna do Claude Desktop: onde o agente trabalha
 * (projeto, pasta, branch, editor/terminal), quanto do contexto da conversa já foi usado e o que
 * mudou na branch, com a PR (ou "Abrir PR").
 */
export function EnvironmentPanel({
  projectId,
  taskId,
  projectName,
  workspace,
  latestRun,
  signals,
  flowActive,
  refreshKey
}: {
  projectId: string
  taskId: string
  projectName: string | null
  workspace: TaskWorkspace | null
  latestRun: AgentRunView | null
  signals: TaskSignals | undefined
  flowActive: boolean
  refreshKey: number
}): React.JSX.Element {
  const [error, setError] = useState<string | null>(null)
  const context = useContextPercent(latestRun)
  const stat = useShortstat(projectId, taskId, workspace !== null, refreshKey)
  const openPr = useOpenPr(projectId, taskId)
  const pr = signals?.pr ?? null
  const prOpen = pr !== null && (pr.state === 'open' || pr.state === 'draft')
  const ci = prOpen && pr.checks ? CI_LABEL[pr.checks] : null

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
                {ci && <StatusToken label={ci[0]} tone={ci[1]} />}
              </>
            )}
            {canOpenPr(pr) && (
              <Button
                size="sm"
                disabled={openPr.busy || flowActive}
                onClick={() => void openPr.start()}
              >
                {openPr.busy ? <Spinner /> : <PullRequestIcon />}
                Abrir PR
              </Button>
            )}
          </div>
          {canOpenPr(pr) && flowActive && (
            <span className="text-xs text-muted-foreground">Espere o fluxo atual terminar</span>
          )}
          <OpenPrFeedback state={openPr} />
        </div>
      )}
    </section>
  )
}
