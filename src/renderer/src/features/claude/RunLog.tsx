import { HStack } from '@astryxdesign/core/HStack'
import { Icon } from '@astryxdesign/core/Icon'
import { StackItem } from '@astryxdesign/core/Stack'
import { Text } from '@astryxdesign/core/Text'
import { Token } from '@astryxdesign/core/Token'
import { VStack } from '@astryxdesign/core/VStack'
import type { RunLogEvent, RunStatus } from '../../../../shared/agent-run'
import {
  FinishIcon,
  InfoIcon,
  MessageIcon,
  PermissionIcon,
  PlayIcon,
  QuestionIcon,
  ToolIcon,
  type SvgIcon
} from '../../components/icons'
import { plural } from '../../lib/format'

export const STATUS_LABEL: Record<RunStatus, string> = {
  queued: 'Na fila',
  running: 'Rodando',
  succeeded: 'Concluída',
  failed: 'Falhou',
  cancelled: 'Cancelada'
}
export const STATUS_COLOR: Record<RunStatus, 'yellow' | 'orange' | 'green' | 'red' | 'gray'> = {
  queued: 'yellow',
  running: 'orange',
  succeeded: 'green',
  failed: 'red',
  cancelled: 'gray'
}

interface LogLine {
  icon: SvgIcon | null
  status: RunStatus | null
  text: string
  /** Bloqueio/negação/falha: destaque de erro. */
  isProblem: boolean
}

/** Uma linha por evento (6E): ícone por tipo, texto numa linha só, estados como Token. */
export function toLogLine(e: RunLogEvent): LogLine | null {
  switch (e.kind) {
    case 'status':
      return {
        icon: null,
        status: e.status,
        text: e.message ?? '',
        isProblem: e.status === 'failed'
      }
    case 'init':
      return line(PlayIcon, `Sessão iniciada${e.model ? ` (${e.model})` : ''}`)
    case 'text':
      return line(MessageIcon, e.text.length > 600 ? `${e.text.slice(0, 600)}…` : e.text)
    case 'tool':
      return line(ToolIcon, `${e.tool}: ${e.summary}`)
    case 'tool_result':
      return e.error ? line(ToolIcon, '↳ falhou', true) : null
    case 'permission':
      return e.state === 'pending'
        ? line(PermissionIcon, `Aguardando aprovação: ${e.summary}`)
        : e.state === 'allowed'
          ? line(PermissionIcon, `Aprovado: ${e.summary}`)
          : e.state === 'blocked'
            ? line(
                PermissionIcon,
                `Bloqueado: ${e.summary}${e.reason ? ` (${e.reason})` : ''}`,
                true
              )
            : line(PermissionIcon, `Negado: ${e.summary}`, true)
    case 'question':
      return line(
        QuestionIcon,
        e.state === 'pending'
          ? `Pergunta: ${e.questions.map((q) => q.question).join(' / ')}`
          : e.state === 'answered'
            ? 'Pergunta respondida'
            : 'Pergunta cancelada'
      )
    case 'result':
      return line(
        FinishIcon,
        `Terminou${e.turns !== null ? ` em ${plural(e.turns, 'turno', 'turnos')}` : ''}${e.text ? `: ${e.text.slice(0, 600)}` : ''}`,
        !e.ok
      )
    case 'info':
      return line(InfoIcon, e.text)
  }
}

function line(icon: SvgIcon, text: string, isProblem = false): LogLine {
  return { icon, status: null, text, isProblem }
}

/** Log da execução: denso, legível de cima a baixo, com o mais recente no fim. */
export function RunLog({ lines }: { lines: readonly LogLine[] }): React.JSX.Element {
  return (
    <VStack gap={1} role="list" aria-label="Log da execução" aria-live="polite">
      {lines.map((l, i) => (
        <HStack key={i} gap={2} vAlign="start" role="listitem">
          {l.status ? (
            <Token size="sm" color={STATUS_COLOR[l.status]} label={STATUS_LABEL[l.status]} />
          ) : (
            l.icon && <Icon icon={l.icon} size="sm" color={l.isProblem ? 'error' : 'secondary'} />
          )}
          {l.text && (
            <StackItem size="fill">
              <Text size="sm" {...(l.isProblem ? { color: 'primary', weight: 'medium' } : {})}>
                {l.text}
              </Text>
            </StackItem>
          )}
        </HStack>
      ))}
    </VStack>
  )
}

export type { LogLine }
