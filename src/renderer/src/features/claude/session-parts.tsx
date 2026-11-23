import { useEffect, useState } from 'react'
import { Button } from '@astryxdesign/core/Button'
import { Card } from '@astryxdesign/core/Card'
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput'
import { Code } from '@astryxdesign/core/Code'
import { HStack } from '@astryxdesign/core/HStack'
import { Icon } from '@astryxdesign/core/Icon'
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl'
import { Selector, type SelectorOptionType } from '@astryxdesign/core/Selector'
import { StackItem } from '@astryxdesign/core/Stack'
import { Text } from '@astryxdesign/core/Text'
import { TextArea } from '@astryxdesign/core/TextArea'
import { TextInput } from '@astryxdesign/core/TextInput'
import { StatusToken } from '../../components/StatusToken'
import { VStack } from '@astryxdesign/core/VStack'
import type { CatalogGroup, EditorId, RunMode, RunPreparation } from '../../../../shared/agent-run'
import { Alert } from '../../components/Alert'
import { DiffView } from '../../components/DiffView'
import { CleanIcon, DiffIcon, EditorIcon, PlayIcon, RefreshIcon } from '../../components/icons'
import { plural } from '../../lib/format'
import { isBranchKind, type BranchKind } from '../../../../shared/slug'
import type { PendingPermission, useTaskRuns } from './useTaskRuns'

export interface RunInitial {
  mode: RunMode
  command: string
  text: string
}
export const EMPTY_INITIAL: RunInitial = { mode: 'prompt', command: '', text: '' }

/** "Nova sessão": modo, comando do catálogo, briefing editável e "Rodar como" (4A). */
export function Composer({
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
  // 8A: com agente na tarefa, roda como ele (instruções e modelo) a menos que você desmarque.
  const [asAgent, setAsAgent] = useState(prep.agent !== null)
  // Branch nova: o tipo (feat/fix/hotfix) troca só o começo do nome sugerido.
  const [kind, setKind] = useState<BranchKind>('feat')
  const branch = prep.branchIsNew ? prep.branch.replace(/^[a-z]+\//, `${kind}/`) : prep.branch

  const start = async (): Promise<void> => {
    setStarting(true)
    setError(null)
    const r = await window.orkio.claude.start({
      projectId,
      taskId: prep.taskId,
      mode,
      command: mode === 'command' ? command.replace(/^\//, '').trim() : null,
      text,
      briefing,
      asAgent,
      ...(prep.branchIsNew ? { branchKind: kind } : {})
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
          <Code data-testid="run-branch">{branch}</Code>
          <Text type="supporting">
            {prep.workspace
              ? 'pasta de trabalho existente'
              : 'pasta de trabalho isolada, criada ao rodar'}
          </Text>
        </HStack>
        {prep.branchIsNew && (
          <SegmentedControl
            label="Tipo da branch"
            value={kind}
            onChange={(v) => {
              if (isBranchKind(v)) setKind(v)
            }}
          >
            <SegmentedControlItem value="feat" label="feat/" />
            <SegmentedControlItem value="fix" label="fix/" />
            <SegmentedControlItem value="hotfix" label="hotfix/" />
          </SegmentedControl>
        )}
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
          label="Resumo da tarefa (vai para o Claude)"
          description="Montado da página do Notion. Edite à vontade; não é salvo no Notion."
          value={briefing}
          onChange={setBriefing}
          rows={10}
        />
        {prep.unsupported.length > 0 && (
          <Alert tone="warning">
            Alguns blocos do Notion não foram convertidos: {prep.unsupported.join(', ')}.
          </Alert>
        )}
        {prep.agent && (
          <VStack gap={1}>
            <CheckboxInput
              label={`Rodar como ${prep.agent.name}`}
              description="Instruções e modelo do agente; as permissões são as mesmas."
              value={asAgent}
              onChange={setAsAgent}
            />
            {asAgent && prep.agent.problem && <Alert tone="warning">{prep.agent.problem}</Alert>}
          </VStack>
        )}
        <Text type="supporting">
          Edições na pasta de trabalho da tarefa são liberadas; comandos de terminal pedem sua
          aprovação; push, PRs e qualquer coisa fora dela são bloqueados.
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

export function PermissionCard({
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

/** Ambiente da tarefa: editores, diff e limpar (4A). */
export function Workspace({
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
  const [diff, setDiff] = useState<{
    diff: string
    truncated: boolean
    untracked: string[]
  } | null>(null)
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
    setDiff(r.value)
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
        <Text type="supporting">Pasta de trabalho</Text>
        <Code data-testid="workspace-branch">{workspace.branch}</Code>
        {workspace.changes !== null && workspace.changes > 0 && (
          <StatusToken
            tone="warning"
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
            label="Limpar pasta de trabalho"
            icon={<Icon icon={CleanIcon} />}
            onClick={() => void cleanup(false)}
          />
        )}
      </HStack>
      {suggestCleanup && !isBusy && (
        <Text type="supporting">
          Tarefa finalizada: a pasta de trabalho pode ser removida (a branch fica).
        </Text>
      )}
      {error && <Alert tone="danger">{error}</Alert>}
      {confirmFiles && (
        <Card role="alertdialog" aria-label="Confirmar limpeza">
          <VStack gap={2}>
            <Text>
              A pasta de trabalho tem mudanças não commitadas que serão perdidas:{' '}
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
        <DiffView
          label="Diff da pasta de trabalho"
          diff={diff.diff}
          truncated={diff.truncated}
          untracked={diff.untracked}
        />
      )}
    </VStack>
  )
}

export function formatDate(iso: string): string {
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
