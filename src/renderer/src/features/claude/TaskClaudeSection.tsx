import { useEffect, useState } from 'react'
import { Button } from '@astryxdesign/core/Button'
import { Card } from '@astryxdesign/core/Card'
import { Code } from '@astryxdesign/core/Code'
import { HStack } from '@astryxdesign/core/HStack'
import { Heading } from '@astryxdesign/core/Heading'
import { Icon } from '@astryxdesign/core/Icon'
import { Item } from '@astryxdesign/core/Item'
import { List } from '@astryxdesign/core/List'
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl'
import { Selector, type SelectorOptionType } from '@astryxdesign/core/Selector'
import { StackItem } from '@astryxdesign/core/Stack'
import { Skeleton } from '@astryxdesign/core/Skeleton'
import { Text } from '@astryxdesign/core/Text'
import { TextArea } from '@astryxdesign/core/TextArea'
import { TextInput } from '@astryxdesign/core/TextInput'
import { Token } from '@astryxdesign/core/Token'
import { VStack } from '@astryxdesign/core/VStack'
import type {
  AgentRunView,
  CatalogGroup,
  EditorId,
  RunLogEvent,
  RunMode,
  RunPreparation
} from '../../../../shared/agent-run'
import { Alert } from '../../components/Alert'
import {
  CleanIcon,
  DiffIcon,
  EditorIcon,
  PlayIcon,
  RefreshIcon,
  StopIcon,
  TerminalIcon
} from '../../components/icons'
import { formatUsd, plural } from '../../lib/format'
import { QuestionCard } from './QuestionCard'
import { RunLog, STATUS_COLOR, STATUS_LABEL, toLogLine, type LogLine } from './RunLog'
import { TaskArtifacts } from './TaskArtifacts'
import { pendingRequests, useTaskRuns, type PendingPermission } from './useTaskRuns'

const LOG_TAIL = 60

/** Seção "Claude Code" do painel da tarefa (4A). */
export function TaskClaudeSection({
  projectId,
  taskId,
  stageName,
  onWaitingChange
}: {
  projectId: string
  taskId: string
  stageName: string | null
  /** Quantos pedidos (permissão/pergunta) esperam a pessoa agora: o painel mostra no topo. */
  onWaitingChange?: (count: number) => void
}): React.JSX.Element {
  const runs = useTaskRuns(projectId, taskId)
  const [prep, setPrep] = useState<RunPreparation | null>(null)
  const [initial, setInitial] = useState<RunInitial>(EMPTY_INITIAL)
  const [preparing, setPreparing] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  /** Abre o formulário; "Rodar de novo" vem com modo/comando/texto da execução anterior. */
  const prepare = async (from: AgentRunView | null = null): Promise<void> => {
    setPreparing(true)
    setMessage(null)
    const r = await window.orkio.claude.prepare(projectId, taskId)
    setPreparing(false)
    if (!r.ok) {
      setMessage(r.error.message)
      return
    }
    setInitial(
      from ? { mode: from.mode, command: from.command ?? '', text: from.text ?? '' } : EMPTY_INITIAL
    )
    setPrep(r.value)
  }

  const state = runs.state
  const active = state?.activeRunId ?? null
  const selected = state?.runs.find((r) => r.id === runs.selectedRunId) ?? null
  const live = selected?.status === 'running' || selected?.status === 'queued'
  const waiting = selected && live ? pendingRequests(runs.log).length : 0
  useEffect(() => {
    onWaitingChange?.(waiting)
  }, [waiting, onWaitingChange])

  return (
    <VStack gap={3} role="region" aria-label="Claude Code">
      <HStack gap={2} vAlign="center">
        <Icon icon={TerminalIcon} />
        <Heading level={3}>Claude Code</Heading>
      </HStack>
      {message && <Alert tone="danger">{message}</Alert>}
      {runs.error && <Alert tone="danger">{runs.error}</Alert>}

      {state === null ? (
        <Skeleton height={40} aria-label="Carregando execuções" />
      ) : prep && !active ? (
        <Composer
          prep={prep}
          initial={initial}
          onCancel={() => setPrep(null)}
          onStarted={(s) => {
            setPrep(null)
            runs.setState(s)
            void runs.select(s.activeRunId)
          }}
          projectId={projectId}
        />
      ) : (
        !active && (
          <Button
            variant="primary"
            label="Rodar Claude Code"
            icon={<Icon icon={PlayIcon} />}
            isLoading={preparing}
            onClick={() => void prepare()}
          />
        )
      )}

      {selected && (
        <RunView
          run={selected}
          log={runs.log}
          onCancel={() => void window.orkio.claude.cancel(selected.id)}
          {...(!active && !prep ? { onRerun: () => void prepare(selected) } : {})}
        />
      )}

      {state && (
        <TaskArtifacts
          projectId={projectId}
          taskId={taskId}
          runId={selected?.id ?? null}
          refreshKey={`${state.runs.length}:${state.activeRunId ?? ''}:${state.workspace?.changes ?? ''}`}
        />
      )}

      {state?.workspace && (
        <Workspace
          projectId={projectId}
          taskId={taskId}
          workspace={state.workspace}
          isBusy={active !== null}
          suggestCleanup={stageName !== null && /finaliz/i.test(stageName)}
          onChanged={() => void runs.reload()}
        />
      )}

      {state && state.runs.length > 1 && (
        <VStack gap={1}>
          <Text type="supporting">Execuções anteriores</Text>
          <List hasDividers density="compact" aria-label="Execuções do Claude Code">
            {state.runs.map((r) => (
              <Item
                as="li"
                key={r.id}
                label={`${STATUS_LABEL[r.status]} · ${r.command ? `/${r.command}` : 'prompt'}`}
                description={formatDate(r.startedAt)}
                endContent={
                  <HStack gap={1} vAlign="center">
                    {r.id === runs.selectedRunId ? (
                      <Token size="sm" label="Exibindo" />
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        label="Ver log"
                        onClick={() => void runs.select(r.id)}
                      />
                    )}
                    {!active && !prep && (
                      <Button
                        size="sm"
                        variant="ghost"
                        label="Rodar de novo"
                        aria-label={`Rodar de novo (${formatDate(r.startedAt)})`}
                        onClick={() => void prepare(r)}
                      />
                    )}
                  </HStack>
                }
              />
            ))}
          </List>
        </VStack>
      )}
    </VStack>
  )
}

interface RunInitial {
  mode: RunMode
  command: string
  text: string
}
const EMPTY_INITIAL: RunInitial = { mode: 'prompt', command: '', text: '' }

function Composer({
  prep,
  initial,
  projectId,
  onCancel,
  onStarted
}: {
  prep: RunPreparation
  initial: RunInitial
  projectId: string
  onCancel(): void
  onStarted(state: NonNullable<ReturnType<typeof useTaskRuns>['state']>): void
}): React.JSX.Element {
  const [mode, setMode] = useState<RunMode>(initial.mode)
  const [command, setCommand] = useState(initial.command)
  const [text, setText] = useState(initial.text)
  const [briefing, setBriefing] = useState(prep.briefing)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const start = async (): Promise<void> => {
    setStarting(true)
    setError(null)
    const r = await window.orkio.claude.start({
      projectId,
      taskId: prep.taskId,
      mode,
      command: mode === 'command' ? command.replace(/^\//, '').trim() : null,
      text,
      briefing
    })
    setStarting(false)
    if (r.ok) onStarted(r.value)
    else setError(r.error.message)
  }

  return (
    <Card variant="transparent">
      <VStack gap={3}>
        <HStack gap={2} vAlign="center" wrap="wrap">
          <Text type="supporting">Branch</Text>
          <Code data-testid="run-branch">{prep.branch}</Code>
          <Text type="supporting">
            {prep.workspace ? 'ambiente existente' : 'ambiente isolado criado ao rodar'}
          </Text>
        </HStack>
        <SegmentedControl
          label="Modo"
          value={mode}
          onChange={(v) => setMode(v === 'command' ? 'command' : 'prompt')}
        >
          <SegmentedControlItem value="prompt" label="Prompt livre" />
          <SegmentedControlItem value="command" label="Comando instalado" />
        </SegmentedControl>
        {mode === 'command' && (
          <CommandPicker
            projectId={projectId}
            taskId={prep.taskId}
            fallback={prep.commands}
            value={command}
            onChange={setCommand}
          />
        )}
        <TextArea
          label={mode === 'prompt' ? 'O que o Claude Code deve fazer' : 'Argumentos (opcional)'}
          value={text}
          onChange={setText}
          rows={3}
        />
        <TextArea
          label="Briefing da tarefa"
          description="Montado da página do Notion. Edite à vontade; não é salvo no Notion."
          value={briefing}
          onChange={setBriefing}
          rows={10}
        />
        {prep.contextWarnings.map((w) => (
          <Alert key={w} tone="warning">
            {w}
          </Alert>
        ))}
        {prep.unsupported.length > 0 && (
          <Alert tone="warning">
            Alguns blocos do Notion não foram convertidos: {prep.unsupported.join(', ')}.
          </Alert>
        )}
        <Text type="supporting">
          Edições no ambiente da tarefa são liberadas; comandos de terminal pedem sua aprovação;
          push, PRs e qualquer coisa fora do ambiente são bloqueados.
        </Text>
        {error && <Alert tone="danger">{error}</Alert>}
        <HStack gap={2}>
          <Button
            variant="primary"
            label="Rodar"
            icon={<Icon icon={PlayIcon} />}
            isLoading={starting}
            onClick={() => void start()}
          />
          <Button variant="ghost" label="Cancelar" onClick={onCancel} />
        </HStack>
      </VStack>
    </Card>
  )
}

function RunView({
  run,
  log,
  onCancel,
  onRerun
}: {
  run: AgentRunView
  log: readonly RunLogEvent[]
  onCancel(): void
  onRerun?: () => void
}): React.JSX.Element {
  const [showAll, setShowAll] = useState(false)
  const live = run.status === 'running' || run.status === 'queued'
  const pending = live ? pendingRequests(log) : []
  const lines = log.map(toLogLine).filter((l): l is LogLine => l !== null)
  const shown = showAll ? lines : lines.slice(-LOG_TAIL)

  return (
    <VStack gap={3}>
      <HStack gap={2} vAlign="center" wrap="wrap">
        <Token
          size="sm"
          color={STATUS_COLOR[run.status]}
          label={STATUS_LABEL[run.status]}
          data-testid="run-status"
        />
        {run.costUsd !== null && <Text type="supporting">{formatUsd(run.costUsd)} (estimado)</Text>}
        {live && (
          <Button
            size="sm"
            variant="secondary"
            label="Cancelar execução"
            icon={<Icon icon={StopIcon} />}
            onClick={onCancel}
          />
        )}
        {!live && onRerun && (
          <Button
            size="sm"
            variant="secondary"
            label="Rodar de novo"
            icon={<Icon icon={PlayIcon} />}
            onClick={onRerun}
          />
        )}
      </HStack>

      {pending.length > 0 && (
        <VStack gap={3} id={`claude-waiting-${run.taskId}`}>
          {pending.map((p) =>
            p.kind === 'permission' ? (
              <PermissionCard key={p.requestId} runId={run.id} request={p} />
            ) : (
              <QuestionCard
                key={p.requestId}
                questions={p.questions}
                onAnswer={(answers) =>
                  void window.orkio.claude.answerQuestion(run.id, p.requestId, answers)
                }
              />
            )
          )}
        </VStack>
      )}

      {lines.length > LOG_TAIL && (
        <Button
          size="sm"
          variant="ghost"
          label={showAll ? 'Mostrar só o fim' : `Mostrar tudo (${lines.length})`}
          onClick={() => setShowAll((v) => !v)}
        />
      )}
      <RunLog lines={shown} />

      {run.summary && (
        <VStack gap={2} data-testid="run-summary">
          <Text weight="semibold">Resumo</Text>
          <Text>
            {plural(run.summary.files.length, 'arquivo alterado', 'arquivos alterados')} ·{' '}
            {plural(run.summary.commits.length, 'commit', 'commits')} ·{' '}
            {run.summary.tests.length > 0
              ? `testes rodados: ${run.summary.tests.join('; ')}`
              : 'nenhum teste rodado'}
          </Text>
          {run.summary.files.length > 0 && (
            <List density="compact" aria-label="Arquivos alterados">
              {run.summary.files.slice(0, 50).map((f) => (
                <Item as="li" key={f} label={<Code>{f}</Code>} />
              ))}
            </List>
          )}
          {run.summary.commits.length > 0 && (
            <List density="compact" aria-label="Commits">
              {run.summary.commits.map((c) => (
                <Item as="li" key={c.hash} label={c.subject} startContent={<Code>{c.hash}</Code>} />
              ))}
            </List>
          )}
        </VStack>
      )}
    </VStack>
  )
}

function PermissionCard({
  runId,
  request
}: {
  runId: string
  request: PendingPermission
}): React.JSX.Element {
  const answer = (a: 'allow_once' | 'allow_always' | 'deny'): void =>
    void window.orkio.claude.answerPermission(runId, request.requestId, a)
  return (
    <Card
      role="group"
      aria-label={request.delivery ? 'Pedido de aprovação da entrega' : 'Pedido de aprovação'}
    >
      <VStack gap={2}>
        <Text weight="semibold">
          {request.delivery
            ? 'Modo entrega: o Claude Code quer publicar no GitHub'
            : `O Claude Code quer rodar (${request.tool}):`}
        </Text>
        <Code>{request.summary}</Code>
        {request.delivery && (
          <Text type="supporting">
            Só a branch da tarefa e o repositório do projeto. Aprovar libera comandos deste tipo até
            o fim deste passo (push com “Exigir minha aprovação” ligado pergunta sempre). Merge,
            força e outras branches continuam bloqueados.
          </Text>
        )}
        <HStack gap={2} wrap="wrap">
          <Button
            size="sm"
            variant="primary"
            label={request.delivery ? 'Permitir nesta execução' : 'Permitir uma vez'}
            onClick={() => answer('allow_once')}
          />
          {request.suggestion && !request.delivery && (
            <Button
              size="sm"
              variant="secondary"
              label={`Sempre neste projeto: ${request.suggestion}`}
              onClick={() => answer('allow_always')}
            />
          )}
          <Button size="sm" variant="destructive" label="Negar" onClick={() => answer('deny')} />
        </HStack>
      </VStack>
    </Card>
  )
}

function Workspace({
  projectId,
  taskId,
  workspace,
  isBusy,
  suggestCleanup,
  onChanged
}: {
  projectId: string
  taskId: string
  workspace: { branch: string; path: string; changes: number | null }
  isBusy: boolean
  suggestCleanup: boolean
  onChanged(): void
}): React.JSX.Element {
  const [diff, setDiff] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmFiles, setConfirmFiles] = useState<string[] | null>(null)

  const openEditor = async (editor: EditorId): Promise<void> => {
    const r = await window.orkio.claude.openEditor(projectId, taskId, editor)
    setError(r.ok ? null : r.error.message)
  }
  const loadDiff = async (): Promise<void> => {
    if (diff !== null) {
      setDiff(null)
      return
    }
    const r = await window.orkio.claude.diff(projectId, taskId)
    if (!r.ok) {
      setError(r.error.message)
      return
    }
    const untracked = r.value.untracked.length
      ? `\n\nArquivos novos (fora do diff): ${r.value.untracked.join(', ')}`
      : ''
    setDiff(
      (r.value.diff || 'Sem diferenças em relação à base.') +
        (r.value.truncated ? '\n\n… (diff cortado)' : '') +
        untracked
    )
  }
  const cleanup = async (force: boolean): Promise<void> => {
    const r = await window.orkio.claude.cleanup(projectId, taskId, force)
    if (r.ok) {
      setConfirmFiles(null)
      setError(null)
      onChanged()
    } else if (r.error.code === 'dirty') {
      setConfirmFiles(r.error.files ?? [])
    } else {
      setError(r.error.message)
    }
  }

  return (
    <VStack gap={2}>
      <HStack gap={2} vAlign="center" wrap="wrap">
        <Text type="supporting">Ambiente</Text>
        <Code data-testid="workspace-branch">{workspace.branch}</Code>
        {workspace.changes !== null && workspace.changes > 0 && (
          <Token
            size="sm"
            color="yellow"
            label={plural(workspace.changes, 'mudança não commitada', 'mudanças não commitadas')}
          />
        )}
      </HStack>
      <HStack gap={2} wrap="wrap">
        <Button
          size="sm"
          variant="secondary"
          label="Abrir no Cursor"
          icon={<Icon icon={EditorIcon} />}
          onClick={() => void openEditor('cursor')}
        />
        <Button
          size="sm"
          variant="secondary"
          label="Abrir no VS Code"
          icon={<Icon icon={EditorIcon} />}
          onClick={() => void openEditor('code')}
        />
        <Button
          size="sm"
          variant="secondary"
          label={diff === null ? 'Ver diff' : 'Esconder diff'}
          icon={<Icon icon={DiffIcon} />}
          onClick={() => void loadDiff()}
        />
        {!isBusy && (
          <Button
            size="sm"
            variant={suggestCleanup ? 'primary' : 'ghost'}
            label="Limpar ambiente"
            icon={<Icon icon={CleanIcon} />}
            onClick={() => void cleanup(false)}
          />
        )}
      </HStack>
      {suggestCleanup && !isBusy && (
        <Text type="supporting">
          Tarefa finalizada: o ambiente pode ser removido (a branch fica).
        </Text>
      )}
      {error && <Alert tone="danger">{error}</Alert>}
      {confirmFiles && (
        <Card role="alertdialog" aria-label="Confirmar limpeza">
          <VStack gap={2}>
            <Text>
              O ambiente tem mudanças não commitadas que serão perdidas:{' '}
              {confirmFiles.slice(0, 10).join(', ')}
              {confirmFiles.length > 10 ? '…' : ''}
            </Text>
            <HStack gap={2}>
              <Button
                size="sm"
                variant="destructive"
                label="Descartar e limpar"
                onClick={() => void cleanup(true)}
              />
              <Button
                size="sm"
                variant="ghost"
                label="Manter"
                onClick={() => setConfirmFiles(null)}
              />
            </HStack>
          </VStack>
        </Card>
      )}
      {diff !== null && (
        <TextArea
          label="Diff do ambiente"
          value={diff}
          isReadOnly
          rows={16}
          controlClassName="orkio-mono-input"
        />
      )}
    </VStack>
  )
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

/** Catálogo agrupado por origem (usuário, projeto, plugin), com busca e recarregar. */
function CommandPicker({
  projectId,
  taskId,
  fallback,
  value,
  onChange
}: {
  projectId: string
  taskId: string
  fallback: string[]
  value: string
  onChange(value: string): void
}): React.JSX.Element {
  const [groups, setGroups] = useState<CatalogGroup[] | null>(null)
  const [loading, setLoading] = useState(false)

  const load = async (): Promise<void> => {
    setLoading(true)
    const r = await window.orkio.claude.catalog(projectId, taskId)
    setLoading(false)
    setGroups(r.ok ? r.value : [])
  }
  // Carrega ao abrir (efeito assíncrono: o setState acontece depois do await).
  useEffect(() => {
    let active = true
    void window.orkio.claude.catalog(projectId, taskId).then((r) => {
      if (active) setGroups(r.ok ? r.value : [])
    })
    return () => {
      active = false
    }
  }, [projectId, taskId])

  const options: SelectorOptionType[] =
    groups && groups.length > 0
      ? groups.map((g) => ({
          type: 'section' as const,
          title: g.title,
          options: g.commands.map((c) => ({
            value: c.name,
            label: `/${c.name}`,
            ...(c.description ? { description: c.description } : {})
          }))
        }))
      : fallback.map((c) => ({ value: c, label: `/${c}` }))

  return (
    <HStack gap={2} vAlign="end">
      <StackItem size="fill">
        {groups !== null && options.length === 0 ? (
          <TextInput
            label="Comando"
            description="Nenhum comando encontrado. Digite o nome (ex.: review)."
            value={value}
            onChange={onChange}
          />
        ) : (
          <Selector
            label="Comando"
            hasSearch
            isLoading={groups === null}
            searchPlaceholder="Buscar comando…"
            options={options}
            {...(value ? { value } : {})}
            onChange={onChange}
          />
        )}
      </StackItem>
      <Button
        size="sm"
        variant="ghost"
        label="Recarregar"
        icon={<Icon icon={RefreshIcon} />}
        isLoading={loading}
        onClick={() => void load()}
      />
    </HStack>
  )
}
