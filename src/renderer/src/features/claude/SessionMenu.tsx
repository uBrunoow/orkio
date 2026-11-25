import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import type { RunLogEvent, TaskRunsState } from '../../../../shared/agent-run'
import { CopyIcon, ForkIcon, MoreIcon, PlayIcon, PlusIcon } from '../../components/icons'
import { ipcCall } from '../../lib/ipc'
import { conversationMarkdown, lastAnswer } from './conversation-copy'

/**
 * "…" do campo da sessão (no lugar do "Nova sessão…" solto): começar uma sessão do zero, rodar um
 * comando do catálogo e copiar a conversa (inteira em Markdown ou só a última resposta).
 */
export function SessionMenu({
  state,
  canStartNew,
  onNewSession,
  onRunCommand,
  onSidechat
}: {
  /** Abre a aba Sidechat (pergunta ao lado, sem mexer na sessão). */
  onSidechat?: () => void
  state: TaskRunsState | null
  canStartNew: boolean
  onNewSession(): void
  onRunCommand(): void
}): React.JSX.Element {
  const [copied, setCopied] = useState<string | null>(null)
  const runs = (state?.runs ?? []).filter((r) => !r.side)

  const readLogs = async (ids: readonly string[]): Promise<Map<string, RunLogEvent[]>> =>
    new Map(
      await Promise.all(
        ids.map(
          async (id) => [id, await ipcCall(() => window.orkio.claude.readLog(id), [])] as const
        )
      )
    )

  const copy = async (what: 'all' | 'last'): Promise<void> => {
    let text: string | null
    if (what === 'all') {
      text = conversationMarkdown(runs, await readLogs(runs.map((r) => r.id)))
    } else {
      // A mais recente com resposta (uma execução cancelada antes de responder não conta).
      text = null
      for (const run of runs) {
        text = lastAnswer((await readLogs([run.id])).get(run.id) ?? [])
        if (text) break
      }
    }
    if (!text) {
      setCopied('Nada para copiar ainda.')
      return
    }
    await navigator.clipboard.writeText(text).then(
      () => setCopied(what === 'all' ? 'Conversa copiada.' : 'Resposta copiada.'),
      () => setCopied('Não foi possível copiar.')
    )
  }

  return (
    <>
      {copied && (
        <span role="status" className="shrink-0 text-2xs text-subtle-foreground">
          {copied}
        </span>
      )}
      <DropdownMenu onOpenChange={(open) => open && setCopied(null)}>
        <DropdownMenuTrigger asChild>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Mais ações da sessão"
            title="Mais ações da sessão"
            className="shrink-0 text-subtle-foreground"
          >
            <MoreIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="top" className="w-60">
          <DropdownMenuItem disabled={!canStartNew} onSelect={onNewSession}>
            <PlusIcon />
            <span className="flex flex-col">
              Nova sessão…
              <span className="text-2xs text-muted-foreground">
                Contexto do zero, só com o resumo da tarefa
              </span>
            </span>
          </DropdownMenuItem>
          {onSidechat && (
            <DropdownMenuItem onSelect={onSidechat}>
              <ForkIcon />
              <span className="flex flex-col">
                Abrir sidechat
                <span className="text-2xs text-muted-foreground">
                  Pergunte ao lado, sem mexer na sessão
                </span>
              </span>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={onRunCommand}>
            <PlayIcon />
            Rodar comando…
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={runs.length === 0} onSelect={() => void copy('all')}>
            <CopyIcon />
            Copiar conversa (Markdown)
          </DropdownMenuItem>
          <DropdownMenuItem disabled={runs.length === 0} onSelect={() => void copy('last')}>
            <CopyIcon />
            Copiar última resposta
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )
}
