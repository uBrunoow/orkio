import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@astryxdesign/core/Button'
import { Code } from '@astryxdesign/core/Code'
import { Collapsible } from '@astryxdesign/core/Collapsible'
import { Item } from '@astryxdesign/core/Item'
import { List } from '@astryxdesign/core/List'
import { HStack } from '@astryxdesign/core/HStack'
import { Icon } from '@astryxdesign/core/Icon'
import { StackItem } from '@astryxdesign/core/Stack'
import { Text } from '@astryxdesign/core/Text'
import { Timestamp } from '@astryxdesign/core/Timestamp'
import { VStack } from '@astryxdesign/core/VStack'
import type { AgentBadge } from '../../../../shared/agent'
import type { AgentRunView, RunLogEvent, RunSummary } from '../../../../shared/agent-run'
import { StatusToken, toneOf } from '../../components/StatusToken'
import { Alert } from '../../components/Alert'
import { DiffView } from '../../components/DiffView'
import { ClaudeLogo, DiffIcon, ReadIcon, UserIcon } from '../../components/icons'
import { BacklogDocumentView } from '../alva/BacklogDocumentView'
import { formatUsd, plural } from '../../lib/format'
import { AgentAvatar } from '../agents/AgentAvatar'
import { RunTranscript } from './RunTranscript'
import { buildTranscript } from './run-transcript'
import { STATUS_COLOR, STATUS_LABEL } from './run-status'

/** Duração curta: "40 s", "4 min", "1 h 12 min". */
export function shortDuration(start: string, end: string | null): string | null {
  if (!end) return null
  const s = Math.max(0, Math.round((Date.parse(end) - Date.parse(start)) / 1000))
  if (s < 60) return `${s} s`
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min`
  return `${Math.floor(m / 60)} h ${m % 60} min`
}

/**
 * Uma execução do Claude Code dentro da sessão da tarefa: quem falou (agente ou Claude Code), o
 * comando, o estado, a mensagem que você mandou (prompt) e a conversa inteira (respostas em
 * markdown, ferramentas agrupadas numa frase). Depois dela, o que ela produziu: a spec ou o plano
 * (alva-flow) e as mudanças no código (arquivos, commits, diff).
 */
export function RunBlock({
  run,
  agent,
  liveLog,
  onRerun,
  focused = false,
  projectId,
  showDocument = false,
  changesOpen = false
}: {
  run: AgentRunView
  /** Agente da tarefa: se foi ele que rodou, mostra o avatar e o nome. */
  agent: AgentBadge | null
  /** Log ao vivo (só para a execução mais recente, vindo do `useTaskRuns`). */
  liveLog: readonly RunLogEvent[] | null
  /** "Rodar de novo": abre a nova sessão com o mesmo modo, comando e texto (só sem nada rodando). */
  onRerun?: () => void
  /** Pedido para mostrar esta execução ("Ver a sessão do passo"): abre e rola até ela. */
  focused?: boolean
  projectId: string
  /**
   * Execução que criou/atualizou a spec ou o plano (alva-flow): mostra a task do Backlog.md logo
   * abaixo da conversa (aberta na mais recente; as anteriores recolhidas, porque é o mesmo arquivo).
   */
  showDocument?: boolean | 'open'
  /** Mudanças (arquivos, commits, diff) abertas por padrão (a execução mais recente que mudou código). */
  changesOpen?: boolean
}): React.JSX.Element {
  const [loaded, setLoaded] = useState<RunLogEvent[] | null>(null)
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [focused])
  const live = run.status === 'running' || run.status === 'queued'
  // Execuções anteriores: lê o log uma vez para mostrar a última fala.
  useEffect(() => {
    if (liveLog) return
    let active = true
    void window.orkio.claude.readLog(run.id).then((events) => {
      if (active) setLoaded(events)
    })
    return () => {
      active = false
    }
  }, [run.id, liveLog, run.status])
  const items = useMemo(
    () => buildTranscript(liveLog ?? loaded ?? [], live),
    [liveLog, loaded, live]
  )
  const byAgent = !!agent && !!run.agentKey && run.agentKey === agent.key
  const who = byAgent ? agent.name : 'Claude Code'
  const meta = [
    shortDuration(run.startedAt, run.endedAt),
    run.costUsd !== null ? formatUsd(run.costUsd) : null
  ]
    .filter(Boolean)
    .join(' · ')
  const youSaid = run.mode === 'prompt' && run.text ? run.text : null

  return (
    <VStack
      ref={ref}
      gap={2}
      role="article"
      aria-label={`${who}${run.command ? ` · /${run.command}` : ''} · ${STATUS_LABEL[run.status]}`}
      data-testid="session-run"
      data-run-id={run.id}
    >
      {youSaid && (
        <HStack gap={2} vAlign="start">
          <Icon icon={UserIcon} color="secondary" />
          <StackItem size="fill">
            <VStack gap={0}>
              <HStack gap={1} vAlign="center">
                <Text type="supporting" weight="medium">
                  Você ·
                </Text>
                <Timestamp value={run.startedAt} format="auto" />
              </HStack>
              <Text>{youSaid}</Text>
            </VStack>
          </StackItem>
        </HStack>
      )}
      <HStack gap={2} vAlign="center" wrap="wrap">
        {byAgent ? (
          <AgentAvatar name={agent.name} color={agent.color} seed={agent.key} />
        ) : (
          <Icon icon={ClaudeLogo} color="secondary" />
        )}
        <Text weight="semibold">{who}</Text>
        {run.command && <Code>/{run.command}</Code>}
        {!youSaid && <Timestamp value={run.startedAt} format="auto" />}
        <StackItem size="fill" />
        <StatusToken
          tone={toneOf(STATUS_COLOR[run.status])}
          label={STATUS_LABEL[run.status]}
          data-testid="run-status"
        />
        {meta && (
          <Text type="supporting" color="secondary">
            {meta}
          </Text>
        )}
      </HStack>

      <RunTranscript items={items} />

      {showDocument && !live && (
        <RunDocument
          projectId={projectId}
          taskId={run.taskId}
          command={run.command ?? ''}
          defaultOpen={showDocument === 'open'}
          refreshKey={run.endedAt ?? ''}
        />
      )}

      {run.summary && !live && (
        <RunChanges
          projectId={projectId}
          taskId={run.taskId}
          summary={run.summary}
          defaultOpen={changesOpen}
        />
      )}

      {onRerun && !live && (
        <HStack>
          <Button size="sm" variant="ghost" label="Rodar de novo" onClick={onRerun} />
        </HStack>
      )}
    </VStack>
  )
}

/** Spec ou plano (task do Backlog.md) logo depois da execução que o criou ou atualizou. */
function RunDocument({
  projectId,
  taskId,
  command,
  defaultOpen,
  refreshKey
}: {
  projectId: string
  taskId: string
  command: string
  defaultOpen: boolean
  refreshKey: string
}): React.JSX.Element {
  const [open, setOpen] = useState(defaultOpen)
  const what = /plan$/.test(command) ? 'Plano' : 'Spec'
  return (
    <VStack
      role="region"
      aria-label={`${what} criado(a) por /${command}`}
      data-testid="run-document"
    >
      <Collapsible
        chevronPosition="start"
        isOpen={open}
        onOpenChange={setOpen}
        trigger={
          <HStack gap={2} vAlign="center">
            <Icon icon={ReadIcon} color="secondary" size="sm" />
            <Text weight="medium">
              {what === 'Plano' ? 'Plano no Backlog.md' : 'Spec no Backlog.md'}
            </Text>
            <Text type="supporting" color="secondary">
              versão atual do arquivo
            </Text>
          </HStack>
        }
      >
        {open && (
          <BacklogDocumentView
            projectId={projectId}
            taskId={taskId}
            refreshKey={refreshKey.length}
          />
        )}
      </Collapsible>
    </VStack>
  )
}

/** O que a execução mudou: arquivos, commits, testes e o diff da tarefa. */
function RunChanges({
  projectId,
  taskId,
  summary,
  defaultOpen
}: {
  projectId: string
  taskId: string
  summary: RunSummary
  defaultOpen: boolean
}): React.JSX.Element {
  const [open, setOpen] = useState(defaultOpen && summary.files.length > 0)
  const [diff, setDiff] = useState<{
    diff: string
    truncated: boolean
    untracked: string[]
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const loadDiff = async (): Promise<void> => {
    if (diff) {
      setDiff(null)
      return
    }
    const r = await window.orkio.claude.diff(projectId, taskId)
    if (r.ok) {
      setDiff(r.value)
      setError(null)
    } else setError(r.error.message)
  }
  return (
    <Collapsible
      chevronPosition="start"
      isOpen={open}
      onOpenChange={setOpen}
      trigger={
        <Text type="supporting" color="secondary" data-testid="run-summary">
          {plural(summary.files.length, 'arquivo alterado', 'arquivos alterados')} ·{' '}
          {plural(summary.commits.length, 'commit', 'commits')} ·{' '}
          {summary.tests.length > 0 ? `testes: ${summary.tests.join('; ')}` : 'nenhum teste rodado'}
        </Text>
      }
    >
      <VStack gap={2}>
        {summary.files.length > 0 && (
          <List density="compact" aria-label="Arquivos alterados">
            {summary.files.slice(0, 50).map((f) => (
              <Item as="li" key={f} label={<Code>{f}</Code>} />
            ))}
          </List>
        )}
        {summary.commits.length > 0 && (
          <List density="compact" aria-label="Commits">
            {summary.commits.map((c) => (
              <Item as="li" key={c.hash} label={c.subject} startContent={<Code>{c.hash}</Code>} />
            ))}
          </List>
        )}
        <HStack>
          <Button
            size="sm"
            variant="ghost"
            label={diff ? 'Esconder o diff' : 'Ver o diff da tarefa'}
            icon={<Icon icon={DiffIcon} />}
            onClick={() => void loadDiff()}
          />
        </HStack>
        {error && <Alert tone="danger">{error}</Alert>}
        {diff && (
          <DiffView
            label="Diff da tarefa"
            diff={diff.diff}
            truncated={diff.truncated}
            untracked={diff.untracked}
          />
        )}
      </VStack>
    </Collapsible>
  )
}
