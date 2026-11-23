import { useEffect, useState } from 'react'
import { IconCheck, IconSelector } from '@tabler/icons-react'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { CheckboxField, Field, SegmentedControl, TextAreaField, TextField } from '@/components/form'
import { Spinner } from '@/components/Spinner'
import { cn } from '@/lib/utils'
import { StatusToken } from '../../components/StatusToken'
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
    <div className="flex flex-col gap-3.5 rounded-[10px] border border-border-soft bg-card p-4">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>Branch</span>
        <code data-testid="run-branch" className="font-mono text-xs text-foreground">
          {branch}
        </code>
        <span className="text-subtle-foreground">
          {prep.workspace
            ? 'pasta de trabalho existente'
            : 'pasta de trabalho isolada, criada ao rodar'}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {prep.branchIsNew && (
          <SegmentedControl
            label="Tipo da branch"
            value={kind}
            onChange={(v) => {
              if (isBranchKind(v)) setKind(v)
            }}
            options={[
              { value: 'feat', label: 'feat/' },
              { value: 'fix', label: 'fix/' },
              { value: 'hotfix', label: 'hotfix/' }
            ]}
          />
        )}
        <SegmentedControl
          label="Modo"
          value={mode}
          onChange={(v) => setMode(v === 'command' ? 'command' : 'prompt')}
          options={[
            { value: 'prompt', label: 'Prompt livre' },
            { value: 'command', label: 'Comando instalado' }
          ]}
        />
      </div>
      {mode === 'command' && (
        <CommandPicker
          projectId={projectId}
          taskId={prep.taskId}
          fallback={prep.commands}
          value={command}
          onChange={setCommand}
        />
      )}
      <TextAreaField
        label={mode === 'prompt' ? 'O que o Claude Code deve fazer' : 'Argumentos (opcional)'}
        value={text}
        onChange={setText}
        rows={3}
      />
      <TextAreaField
        label="Resumo da tarefa (vai para o Claude)"
        description="Montado da página do Notion. Edite à vontade; não é salvo no Notion."
        value={briefing}
        onChange={setBriefing}
        rows={10}
        mono
        textareaClassName="max-h-80"
      />
      {prep.unsupported.length > 0 && (
        <Alert tone="warning">
          Alguns blocos do Notion não foram convertidos: {prep.unsupported.join(', ')}.
        </Alert>
      )}
      {prep.agent && (
        <div className="flex flex-col gap-1.5">
          <CheckboxField
            label={`Rodar como ${prep.agent.name}`}
            description="Instruções e modelo do agente; as permissões são as mesmas."
            checked={asAgent}
            onChange={setAsAgent}
          />
          {asAgent && prep.agent.problem && <Alert tone="warning">{prep.agent.problem}</Alert>}
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Edições na pasta de trabalho da tarefa são liberadas; comandos de terminal pedem sua
        aprovação; push, PRs e qualquer coisa fora dela são bloqueados.
      </p>
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="flex items-center gap-2">
        <Button disabled={starting} onClick={() => void start()}>
          {starting ? <Spinner /> : <PlayIcon />}
          Rodar
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </div>
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
    <div
      role="group"
      aria-label={request.delivery ? 'Pedido de aprovação da entrega' : 'Pedido de aprovação'}
      className="flex flex-col gap-2.5 rounded-[10px] border border-warn-tint-border bg-warn-tint p-3.5"
    >
      <p className="flex items-center gap-2 text-sm font-medium">
        <span aria-hidden="true" className="size-[7px] shrink-0 rounded-full bg-warn" />
        {request.delivery
          ? 'Modo entrega: o Claude Code quer publicar no GitHub'
          : `O Claude Code quer rodar (${request.tool}):`}
      </p>
      <code className="rounded-md border border-border-soft bg-background/60 px-2.5 py-1.5 font-mono text-xs break-all whitespace-pre-wrap text-foreground">
        {request.summary}
      </code>
      {request.delivery && (
        <p className="text-xs text-muted-foreground">
          Só a branch da tarefa e o repositório do projeto. Aprovar libera comandos deste tipo até o
          fim deste passo (push com “Exigir minha aprovação” ligado pergunta sempre). Merge, força e
          outras branches continuam bloqueados.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => answer('allow_once')}>
          {request.delivery ? 'Permitir nesta execução' : 'Permitir uma vez'}
        </Button>
        {request.suggestion && !request.delivery && (
          <Button variant="outline" onClick={() => answer('allow_always')}>
            {`Sempre neste projeto: ${request.suggestion}`}
          </Button>
        )}
        <Button variant="ghost" onClick={() => answer('deny')}>
          Negar
        </Button>
      </div>
    </div>
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
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>Pasta de trabalho</span>
        <code data-testid="workspace-branch" className="font-mono text-xs text-foreground">
          {workspace.branch}
        </code>
        {workspace.changes !== null && workspace.changes > 0 && (
          <StatusToken
            tone="warning"
            label={plural(workspace.changes, 'mudança não commitada', 'mudanças não commitadas')}
          />
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => void openEditor('cursor')}>
          <EditorIcon />
          Abrir no Cursor
        </Button>
        <Button size="sm" variant="outline" onClick={() => void openEditor('code')}>
          <EditorIcon />
          Abrir no VS Code
        </Button>
        <Button size="sm" variant="outline" onClick={() => void loadDiff()}>
          <DiffIcon />
          {diff === null ? 'Ver diff' : 'Esconder diff'}
        </Button>
        {!isBusy && (
          <Button
            size="sm"
            variant={suggestCleanup ? 'default' : 'ghost'}
            onClick={() => void cleanup(false)}
          >
            <CleanIcon />
            Limpar pasta de trabalho
          </Button>
        )}
      </div>
      {suggestCleanup && !isBusy && (
        <p className="text-xs text-muted-foreground">
          Tarefa finalizada: a pasta de trabalho pode ser removida (a branch fica).
        </p>
      )}
      {error && <Alert tone="danger">{error}</Alert>}
      {confirmFiles && (
        <div
          role="alertdialog"
          aria-label="Confirmar limpeza"
          className="flex flex-col gap-2.5 rounded-[10px] border border-danger-tint-border bg-danger-tint p-3.5"
        >
          <p className="text-sm">
            A pasta de trabalho tem mudanças não commitadas que serão perdidas:{' '}
            <span className="font-mono text-xs">
              {confirmFiles.slice(0, 10).join(', ')}
              {confirmFiles.length > 10 ? '…' : ''}
            </span>
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="destructive" onClick={() => void cleanup(true)}>
              Descartar e limpar
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmFiles(null)}>
              Manter
            </Button>
          </div>
        </div>
      )}
      {diff !== null && (
        <DiffView
          label="Diff da pasta de trabalho"
          diff={diff.diff}
          truncated={diff.truncated}
          untracked={diff.untracked}
        />
      )}
    </div>
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
  const [open, setOpen] = useState(false)

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

  const options: { title: string | null; commands: { name: string; description?: string }[] }[] =
    groups && groups.length > 0
      ? groups.map((g) => ({ title: g.title, commands: g.commands }))
      : [{ title: null, commands: fallback.map((name) => ({ name })) }]
  const empty = groups !== null && options.every((g) => g.commands.length === 0)

  return (
    <div className="flex items-end gap-2">
      {empty ? (
        <TextField
          className="flex-1"
          label="Comando"
          description="Nenhum comando encontrado. Digite o nome (ex.: review)."
          value={value}
          onChange={onChange}
        />
      ) : (
        <Field label="Comando" className="flex-1">
          {({ id, describedBy }) => (
            <Popover open={open} onOpenChange={setOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  id={id}
                  aria-label={value ? `Comando /${value}` : 'Comando'}
                  aria-describedby={describedBy}
                  aria-haspopup="listbox"
                  aria-expanded={open}
                  className="inline-flex h-8 w-full min-w-0 items-center justify-between gap-2 rounded-md border border-input bg-card px-2.5 text-left font-mono text-xs outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40"
                >
                  <span className={cn('truncate', !value && 'font-sans text-muted-foreground')}>
                    {value ? `/${value}` : 'Escolha um comando…'}
                  </span>
                  <IconSelector
                    aria-hidden="true"
                    className="size-3.5 shrink-0 text-subtle-foreground"
                  />
                </button>
              </PopoverTrigger>
              <PopoverContent
                align="start"
                className="w-(--radix-popover-trigger-width) min-w-72 p-0"
              >
                <Command>
                  <CommandInput placeholder="Buscar comando…" />
                  <CommandList aria-label="Comando">
                    {groups === null ? (
                      <div className="py-6 text-center text-xs text-muted-foreground">
                        Carregando…
                      </div>
                    ) : (
                      <CommandEmpty>Nada encontrado.</CommandEmpty>
                    )}
                    {options.map((g) => (
                      <CommandGroup key={g.title ?? '_'} {...(g.title ? { heading: g.title } : {})}>
                        {g.commands.map((c) => (
                          <CommandItem
                            key={c.name}
                            value={`/${c.name} ${c.description ?? ''}`}
                            onSelect={() => {
                              onChange(c.name)
                              setOpen(false)
                            }}
                          >
                            <span className="flex min-w-0 flex-1 flex-col">
                              <span className="truncate font-mono text-xs">/{c.name}</span>
                              {c.description && (
                                <span className="truncate text-xs text-muted-foreground">
                                  {' '}
                                  {c.description}
                                </span>
                              )}
                            </span>
                            <IconCheck
                              aria-hidden="true"
                              className={cn(
                                'size-3.5',
                                c.name === value ? 'opacity-100' : 'opacity-0'
                              )}
                            />
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    ))}
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          )}
        </Field>
      )}
      <Button size="sm" variant="ghost" disabled={loading} onClick={() => void load()}>
        {loading ? <Spinner /> : <RefreshIcon />}
        Recarregar
      </Button>
    </div>
  )
}
