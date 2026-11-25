/**
 * "Com você no terminal" (Fase 2): a sessão do Claude Code da tarefa está com você. Mostra o aviso
 * (no terminal valem as configurações do seu Claude, não as regras do Orkio) e os dois jeitos de
 * devolver. Usado na aba Terminal e na conversa da tarefa.
 */
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  HANDOFF_TEXT,
  resumeCommand,
  type HandoffReturn,
  type HandoffView
} from '../../../../shared/handoff'
import { Alert } from '../../components/Alert'
import { CheckIcon, CopyIcon, HandBackIcon, TerminalIcon } from '../../components/icons'
import { StatusDot } from '../../components/StatusToken'

export function HandoffBar({
  handoff,
  busy,
  error,
  terminalAvailable,
  onGiveBack,
  onReopen,
  onOpenTerminal,
  className
}: {
  handoff: HandoffView
  busy: 'start' | 'reopen' | HandoffReturn | null
  error: string | null
  /** O terminal embutido existe (senão, o comando para copiar). */
  terminalAvailable: boolean
  onGiveBack(mode: HandoffReturn): void
  /** Reabrir o Claude no terminal (fechou ou o app reiniciou). */
  onReopen?(): void
  /** Ir para a aba Terminal (na conversa da tarefa). */
  onOpenTerminal?(): void
  className?: string
}): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  const command = resumeCommand(handoff.sessionId)
  const copy = (): void => {
    void navigator.clipboard?.writeText(command).then(
      () => setCopied(true),
      () => setCopied(false)
    )
  }
  return (
    <section
      aria-label={HANDOFF_TEXT.state}
      data-testid="handoff-bar"
      className={cn(
        'flex flex-col gap-2.5 rounded-lg border border-brand-tint-border bg-brand-tint/40 px-3.5 py-3',
        className
      )}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="flex items-center gap-2 text-sm font-medium text-foreground">
          <StatusDot tone="running" />
          {HANDOFF_TEXT.state}
        </span>
        <span className="min-w-0 flex-1 basis-64 text-xs text-muted-foreground">
          {HANDOFF_TEXT.warning}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          {onOpenTerminal && (
            <Button size="sm" variant="ghost" onClick={onOpenTerminal}>
              <TerminalIcon aria-hidden="true" />
              Ir para o terminal
            </Button>
          )}
          {onReopen && terminalAvailable && !handoff.terminalId && (
            <Button size="sm" variant="outline" disabled={busy !== null} onClick={onReopen}>
              <TerminalIcon aria-hidden="true" />
              {busy === 'reopen' ? 'Abrindo…' : 'Abrir o Claude de novo'}
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            title={handoff.flowStep ? HANDOFF_TEXT.doneHint : undefined}
            disabled={busy !== null}
            onClick={() => onGiveBack('done')}
          >
            <CheckIcon aria-hidden="true" />
            {busy === 'done'
              ? 'Devolvendo…'
              : handoff.flowStep
                ? HANDOFF_TEXT.done
                : HANDOFF_TEXT.doneNoFlow}
          </Button>
          <Button
            size="sm"
            title={HANDOFF_TEXT.continueHint}
            disabled={busy !== null}
            onClick={() => onGiveBack('continue')}
          >
            <HandBackIcon aria-hidden="true" />
            {busy === 'continue' ? 'Devolvendo…' : HANDOFF_TEXT.continue}
          </Button>
        </div>
      </div>
      {!terminalAvailable && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>
            O terminal embutido não está disponível aqui. Rode no seu terminal, na pasta da tarefa:
          </span>
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-foreground">
            {command}
          </code>
          <Button size="xs" variant="ghost" onClick={copy}>
            <CopyIcon aria-hidden="true" />
            {copied ? 'Copiado' : 'Copiar'}
          </Button>
        </div>
      )}
      {error && <Alert tone="danger">{error}</Alert>}
    </section>
  )
}
