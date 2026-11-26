import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { SERVER_LIMITS, type ServerDef } from '../../../../shared/servers'
import { Alert } from '../../components/Alert'
import { TextAreaField, TextField } from '../../components/form'
import { PlusIcon, ServerIcon } from '../../components/icons'
import { PageHeader } from '../../components/PageHeader'
import { PAGE_WIDTH } from '../../components/page-width'
import { EmptyState, PageState } from '../../components/PageState'
import { ipcResult, unwrap, useIpcResource } from '../../lib/ipc'
import {
  defOf,
  draftOf,
  draftProblems,
  emptyDraft,
  hasProblems,
  newServerId,
  serverDetails,
  withServer,
  type ServerDraft
} from './servers-logic'

/**
 * Configurações › Por projeto › Servidores: o cadastro dos servidores que o Orkio roda na pasta de
 * cada tarefa (frontend, backend…). Adicionar e editar abrem num modal; o main valida de novo.
 */
export function ServersSettings({ projectId }: { projectId: string | null }): React.JSX.Element {
  const defs = useIpcResource(projectId, (id) => window.orkio.servers.defs(id).then(unwrap), {
    refreshOnFocus: true
  })
  const [editing, setEditing] = useState<ServerDraft | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const list = defs.value ?? []

  const save = async (next: ServerDef[]): Promise<string | null> => {
    if (!projectId) return 'Escolha um projeto.'
    setBusy(true)
    const r = await ipcResult(() => window.orkio.servers.save(projectId, next))
    setBusy(false)
    if (!r.ok) return r.error.message
    defs.set(r.value)
    return null
  }
  const remove = async (id: string): Promise<void> => {
    setError(await save(list.filter((s) => s.id !== id)))
  }
  const full = list.length >= SERVER_LIMITS.perProject
  const add = (): void => setEditing(emptyDraft(newServerId()))

  return (
    <div className={`flex flex-col gap-6 ${PAGE_WIDTH.form}`}>
      <PageHeader
        title="Servidores"
        subtitle="O que o Orkio sobe na pasta de cada tarefa (frontend, backend…), cada tarefa com a própria porta."
        action={
          list.length > 0 && (
            <Button size="sm" onClick={add} disabled={full || !projectId}>
              <PlusIcon />
              Adicionar servidor
            </Button>
          )
        }
      />
      {!projectId ? (
        <PageState
          kind="empty"
          title="Nenhum projeto"
          description="Vincule um projeto para cadastrar os servidores dele."
        />
      ) : defs.loading && !defs.value ? (
        <PageState kind="loading" label="Carregando servidores" />
      ) : defs.error && !defs.value ? (
        <PageState kind="error" message={defs.error.message} />
      ) : list.length === 0 ? (
        <EmptyState
          title="Nenhum servidor cadastrado"
          description="Cadastre o comando que sobe o seu frontend ou backend (ex.: pnpm dev). O Orkio roda na pasta da tarefa, passa a porta em PORT e mostra no painel Ambiente."
          action={
            <Button size="sm" onClick={add}>
              <PlusIcon />
              Adicionar servidor
            </Button>
          }
        />
      ) : (
        <ul
          aria-label="Servidores do projeto"
          className="flex flex-col divide-y divide-border-soft overflow-hidden rounded-xl border border-border-soft bg-card"
        >
          {list.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <ServerIcon aria-hidden="true" className="size-4 shrink-0 text-subtle-foreground" />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-sm font-medium text-foreground">{s.name}</span>
                <code
                  className="truncate font-mono text-xs text-muted-foreground"
                  title={s.command}
                >
                  {s.command}
                </code>
                <span className="text-2xs text-subtle-foreground">{serverDetails(s)}</span>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  size="xs"
                  variant="ghost"
                  aria-label={`Editar ${s.name}`}
                  onClick={() => setEditing(draftOf(s))}
                >
                  Editar
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  className="text-danger hover:text-danger"
                  aria-label={`Remover ${s.name}`}
                  disabled={busy}
                  onClick={() => void remove(s.id)}
                >
                  Remover
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {full && (
        <p className="text-xs text-muted-foreground">
          Limite de {SERVER_LIMITS.perProject} servidores por projeto.
        </p>
      )}
      {error && <Alert tone="danger">{error}</Alert>}

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-h-[85vh] gap-4 overflow-y-auto sm:max-w-xl">
          <div className="flex flex-col gap-0.5 pr-6">
            <DialogTitle className="text-base font-medium text-foreground">
              {editing && list.some((s) => s.id === editing.id)
                ? `Editar ${editing.name}`
                : 'Novo servidor'}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Roda com o seu shell na pasta da tarefa. A porta vem na variável escolhida.
            </DialogDescription>
          </div>
          {editing && (
            <ServerForm
              key={editing.id}
              initial={editing}
              all={list}
              onCancel={() => setEditing(null)}
              onSave={async (def) => {
                const problem = await save(withServer(list, def))
                if (!problem) setEditing(null)
                return problem
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function ServerForm({
  initial,
  all,
  onSave,
  onCancel
}: {
  initial: ServerDraft
  all: readonly ServerDef[]
  onSave(def: ServerDef): Promise<string | null>
  onCancel(): void
}): React.JSX.Element {
  const [d, setD] = useState(initial)
  const [tried, setTried] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const problems = draftProblems(d, all)
  const show = (p: string | undefined): string | null => (tried ? (p ?? null) : null)
  const set = (patch: Partial<ServerDraft>): void => setD((c) => ({ ...c, ...patch }))
  const others = all.filter((s) => s.id !== d.id).map((s) => s.name)

  return (
    <form
      aria-label="Servidor"
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        setTried(true)
        setError(null)
        if (hasProblems(problems)) return
        setSaving(true)
        void onSave(defOf(d)).then((problem) => {
          setSaving(false)
          setError(problem)
        })
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Nome"
          mono
          autoFocus
          value={d.name}
          maxLength={SERVER_LIMITS.name}
          placeholder="frontend"
          description="Como você e o agente chamam este servidor."
          onChange={(name) => set({ name })}
          error={show(problems.name)}
        />
        <TextField
          label="Pasta (opcional)"
          mono
          value={d.cwd}
          maxLength={SERVER_LIMITS.cwd}
          placeholder="apps/web"
          description="Subpasta do projeto. Vazio = a raiz."
          onChange={(cwd) => set({ cwd })}
          error={show(problems.cwd)}
        />
      </div>
      <TextField
        label="Comando"
        mono
        value={d.command}
        maxLength={SERVER_LIMITS.command}
        placeholder="pnpm dev --port $PORT"
        description="Uma linha, como no terminal. Use a porta da variável abaixo."
        onChange={(command) => set({ command })}
        error={show(problems.command)}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Variável da porta"
          mono
          value={d.portEnv}
          placeholder="PORT"
          onChange={(portEnv) => set({ portEnv })}
          error={show(problems.portEnv)}
        />
        <TextField
          label="Endereço"
          mono
          value={d.url}
          maxLength={SERVER_LIMITS.url}
          placeholder="http://localhost:{port}"
          onChange={(url) => set({ url })}
          error={show(problems.url)}
        />
      </div>
      <TextAreaField
        label="Variáveis (opcional)"
        mono
        rows={3}
        value={d.env}
        placeholder={others[0] ? `VITE_API_URL={${others[0]}.url}` : 'NODE_ENV=development'}
        description={
          others.length > 0
            ? `Uma por linha. {${others[0]}.url} e {${others[0]}.port} viram o endereço e a porta do outro servidor desta tarefa.`
            : 'Uma por linha, NOME=valor.'
        }
        onChange={(env) => set({ env })}
        error={show(problems.env)}
      />
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" disabled={saving}>
          Salvar servidor
        </Button>
      </div>
    </form>
  )
}
