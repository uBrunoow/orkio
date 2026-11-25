import { useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { PageHeader } from '../../components/PageHeader'
import { PAGE_WIDTH } from '../../components/page-width'
import { PageState } from '../../components/PageState'
import { Alert } from '../../components/Alert'
import { Timestamp } from '../../components/Timestamp'
import { SegmentedControl, TextField } from '../../components/form'
import { LockIcon, PlusIcon } from '../../components/icons'
import { ipcResult } from '../../lib/ipc'
import {
  SECRET_NOTE_MAX,
  secretNameProblem,
  secretValueProblem,
  type SecretUse,
  type SecretView,
  type VaultView
} from '../../../../shared/vault'
import type { McpServerView } from '../../../../shared/mcp'
import type { Result } from '../../../../shared/result'
import { useAgentOptions, useMcp, useVault, type AgentOption } from '../mcp/useConfigData'
import {
  SAVED_MESSAGE,
  SECRET_SHORTCUTS,
  finalSecretName,
  secretUseKey,
  secretUseLabel,
  serversUsingSecret,
  toSecretName
} from './secrets-logic'
import { AppliesTo, SecretValueField, UsesPicker } from './parts'

const MASK = '••••••••'

type RowMode = 'value' | 'note' | 'uses' | 'remove'

export function SecretsPage({ projectId }: { projectId: string | null }): React.JSX.Element {
  const vault = useVault()
  const mcp = useMcp()
  const agents = useAgentOptions(projectId)
  const servers = mcp.value?.servers ?? []
  const [adding, setAdding] = useState<{ name: string; note: string } | null>(null)
  const [open, setOpen] = useState<{ name: string; mode: RowMode } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const agentNames = useMemo(() => new Map(agents.map((a) => [a.key, a.name])), [agents])
  const view = vault.value
  const available = view?.available ?? false

  const applied = (next: VaultView, message: string | null): void => {
    vault.set(next)
    setNotice(message)
    void mcp.reload()
  }

  const startAdd = (preset: { name: string; note: string } = { name: '', note: '' }): void => {
    setOpen(null)
    setNotice(null)
    setAdding(preset)
  }

  return (
    <div className={cn('flex flex-col gap-[18px]', PAGE_WIDTH.form)}>
      <PageHeader
        title="Segredos"
        subtitle="Tokens e chaves que os agentes e servidores MCP precisam, guardados cifrados."
        action={
          <Button
            size="sm"
            disabled={!available || adding !== null}
            onClick={() => startAdd()}
          >
            <PlusIcon />
            Adicionar segredo
          </Button>
        }
      />
      <AppliesTo>os agentes e servidores que você liberar, neste computador</AppliesTo>
      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <LockIcon className="mt-px size-3.5 shrink-0" />
        O Orkio põe o segredo como variável de ambiente só no agente ou servidor liberado, na hora
        de rodar. Nunca vai para o log.
      </p>

      {vault.value === null && vault.error ? (
        <PageState
          kind="error"
          message={vault.error.message}
          action={{ label: 'Tentar de novo', onClick: () => void vault.reload() }}
        />
      ) : view === null ? (
        <PageState kind="loading" label="Carregando segredos" />
      ) : (
        <>
          {!view.available && (
            <Alert tone="warning">
              Sem a criptografia do sistema (Keychain, GNOME Keyring ou KWallet) o Orkio não salva
              segredos. Ative o chaveiro do sistema e abra o Orkio de novo.
            </Alert>
          )}
          {notice && (
            <Alert tone="info" className="py-2">
              {notice}
            </Alert>
          )}

          {adding && (
            <AddSecretForm
              key={`${adding.name}|${adding.note}`}
              initial={adding}
              taken={view.secrets.map((s) => s.name)}
              agents={agents}
              servers={servers}
              onCancel={() => setAdding(null)}
              onSaved={(next) => {
                setAdding(null)
                applied(next, SAVED_MESSAGE)
              }}
            />
          )}

          {view.secrets.length === 0 && !adding ? (
            <EmptySecrets available={view.available} onStart={startAdd} />
          ) : (
            view.secrets.length > 0 && (
              <ul
                aria-label="Segredos guardados"
                className="flex flex-col divide-y divide-border-soft rounded-xl border border-border-soft bg-card"
              >
                {view.secrets.map((s) => (
                  <SecretRow
                    key={s.name}
                    secret={s}
                    available={view.available}
                    mode={open?.name === s.name ? open.mode : null}
                    onMode={(mode) => {
                      setNotice(null)
                      setAdding(null)
                      setOpen(mode ? { name: s.name, mode } : null)
                    }}
                    agentNames={agentNames}
                    agents={agents}
                    servers={servers}
                    onApplied={(next, message) => {
                      setOpen(null)
                      applied(next, message)
                    }}
                  />
                ))}
              </ul>
            )
          )}
        </>
      )}
    </div>
  )
}

function EmptySecrets({
  available,
  onStart
}: {
  available: boolean
  onStart(preset?: { name: string; note: string }): void
}): React.JSX.Element {
  return (
    <section
      aria-label="Comece por aqui"
      data-testid="empty-hero"
      className="flex flex-col gap-3 rounded-xl border border-dashed border-border px-5 py-6"
    >
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-medium">Nenhum segredo guardado</h2>
        <p className="max-w-prose text-xs text-muted-foreground">
          Guarde aqui o token que um servidor MCP ou um agente precisa. Comece por um destes:
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {SECRET_SHORTCUTS.map((s) => (
          <Button
            key={s.name}
            size="sm"
            variant="outline"
            disabled={!available}
            onClick={() => onStart({ name: s.name, note: s.note })}
          >
            {s.label}
          </Button>
        ))}
        <Button size="sm" variant="ghost" disabled={!available} onClick={() => onStart()}>
          Outro segredo
        </Button>
      </div>
    </section>
  )
}

function AddSecretForm({
  initial,
  taken,
  agents,
  servers,
  onCancel,
  onSaved
}: {
  initial: { name: string; note: string }
  taken: readonly string[]
  agents: readonly AgentOption[]
  servers: readonly McpServerView[]
  onCancel(): void
  onSaved(view: VaultView): void
}): React.JSX.Element {
  const [advanced, setAdvanced] = useState(false)
  const [name, setName] = useState(initial.name)
  const [note, setNote] = useState(initial.note)
  const [value, setValue] = useState('')
  const [uses, setUses] = useState<SecretUse[]>([])
  const [tried, setTried] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const finalName = finalSecretName(name)
  const nameProblem = !finalName
    ? 'Dê um nome ao segredo.'
    : taken.includes(finalName)
      ? 'Já existe um segredo com esse nome. Para mudar o valor, use "Trocar valor" nele.'
      : secretNameProblem(finalName)
  const valueProblem = secretValueProblem(value)
  // Ao vivo depois de começar a digitar; tudo ao tentar salvar.
  const showName = (tried || name !== '') && nameProblem
  const showValue = (tried || value !== '') && valueProblem

  const submit = async (): Promise<void> => {
    setTried(true)
    setError(null)
    if (nameProblem || valueProblem) return
    setSaving(true)
    const saved = await ipcResult(() =>
      window.orkio.vault.save({ name: finalName, note: note.trim(), value })
    )
    if (!saved.ok) {
      setSaving(false)
      setError(saved.error.message)
      return
    }
    // O valor sai da memória da tela assim que o main guardou.
    setValue('')
    let next = saved.value
    if (uses.length > 0) {
      const withUses = await ipcResult(() => window.orkio.vault.setUses(finalName, uses))
      if (withUses.ok) next = withUses.value
      else {
        setSaving(false)
        setError(`Guardado, mas não deu para liberar quem usa: ${withUses.error.message}`)
        return
      }
    }
    setSaving(false)
    onSaved(next)
  }

  return (
    <form
      aria-label="Novo segredo"
      className="flex flex-col gap-4 rounded-xl border border-border-soft bg-card p-5"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-medium">Novo segredo</h2>
        <SegmentedControl
          label="Modo do formulário"
          size="sm"
          value={advanced ? 'advanced' : 'simple'}
          onChange={(v) => setAdvanced(v === 'advanced')}
          options={[
            { value: 'simple', label: 'Simples' },
            { value: 'advanced', label: 'Avançado' }
          ]}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Nome do segredo"
          mono
          value={name}
          placeholder="GITHUB_TOKEN"
          autoFocus={initial.name === ''}
          onChange={(v) => setName(toSecretName(v))}
          description="Vira o nome da variável de ambiente: maiúsculas, números e _."
          error={showName || null}
        />
        <SecretValueField
          label="Valor"
          value={value}
          onChange={setValue}
          autoFocus={initial.name !== ''}
          error={showValue || null}
          description="Depois de guardado, o Orkio não mostra o valor de novo."
        />
      </div>
      <TextField
        label="Nota (opcional)"
        value={note}
        maxLength={SECRET_NOTE_MAX}
        placeholder="Para que serve, de onde veio"
        onChange={setNote}
      />
      {advanced && (
        <UsesPicker uses={uses} onChange={setUses} agents={agents} servers={servers} />
      )}
      {!advanced && (
        <p className="text-xs text-muted-foreground">
          Ninguém usa até você liberar (no Avançado, ou depois em &quot;Quem pode usar&quot;).
          Servidores MCP que pedem este segredo são liberados ao escolhê-lo neles.
        </p>
      )}
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={saving}>
          {saving ? 'Guardando…' : 'Guardar segredo'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </form>
  )
}

function SecretRow({
  secret,
  available,
  mode,
  onMode,
  agentNames,
  agents,
  servers,
  onApplied
}: {
  secret: SecretView
  available: boolean
  mode: RowMode | null
  onMode(mode: RowMode | null): void
  agentNames: ReadonlyMap<string, string>
  agents: readonly AgentOption[]
  servers: readonly McpServerView[]
  onApplied(view: VaultView, message: string | null): void
}): React.JSX.Element {
  const toggle = (m: RowMode): void => onMode(mode === m ? null : m)
  const actions: { mode: RowMode; label: string; disabled?: boolean }[] = [
    { mode: 'value', label: 'Trocar valor', disabled: !available },
    { mode: 'note', label: 'Editar nota' },
    { mode: 'uses', label: 'Quem pode usar' },
    { mode: 'remove', label: 'Apagar' }
  ]
  return (
    <li aria-label={secret.name} data-testid="secret-row" className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="font-mono text-sm text-foreground">{secret.name}</span>
            <span aria-label="Valor escondido" className="font-mono text-xs text-subtle-foreground">
              {MASK}
            </span>
          </div>
          {secret.note && <p className="text-xs text-muted-foreground">{secret.note}</p>}
          <p className="text-2xs text-subtle-foreground">
            Atualizado <Timestamp value={secret.updatedAt} />
          </p>
          <div role="group" aria-label="Usado por" className="flex flex-wrap items-center gap-1.5 pt-1">
            <span className="text-2xs text-subtle-foreground">Usado por:</span>
            {secret.uses.length === 0 ? (
              <span className="text-2xs text-muted-foreground">ninguém ainda</span>
            ) : (
              secret.uses.map((u) => (
                <span
                  key={secretUseKey(u)}
                  className="rounded-md border border-border-soft bg-muted px-1.5 py-0.5 text-2xs text-foreground"
                >
                  {secretUseLabel(u, agentNames, servers)}
                </span>
              ))
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-1">
          {actions.map((a) => (
            <Button
              key={a.mode}
              size="xs"
              variant={mode === a.mode ? 'secondary' : 'ghost'}
              aria-expanded={mode === a.mode}
              disabled={a.disabled}
              onClick={() => toggle(a.mode)}
            >
              {a.label}
            </Button>
          ))}
        </div>
      </div>
      {mode === 'value' && (
        <ChangeValue secret={secret} onDone={onApplied} onCancel={() => onMode(null)} />
      )}
      {mode === 'note' && (
        <EditNote secret={secret} onDone={onApplied} onCancel={() => onMode(null)} />
      )}
      {mode === 'uses' && (
        <EditUses
          secret={secret}
          agents={agents}
          servers={servers}
          onDone={onApplied}
          onCancel={() => onMode(null)}
        />
      )}
      {mode === 'remove' && (
        <ConfirmRemove
          secret={secret}
          servers={serversUsingSecret(servers, secret.name)}
          onDone={onApplied}
          onCancel={() => onMode(null)}
        />
      )}
    </li>
  )
}

type DoneFn = (view: VaultView, message: string | null) => void

function useSubmit(): {
  saving: boolean
  error: string | null
  run(call: () => Promise<Result<VaultView>>): Promise<VaultView | null>
} {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return {
    saving,
    error,
    run: async (call) => {
      setSaving(true)
      setError(null)
      const r = await ipcResult(call)
      setSaving(false)
      if (!r.ok) {
        setError(r.error.message)
        return null
      }
      return r.value
    }
  }
}

function InlinePanel({
  label,
  children,
  onSubmit
}: {
  label: string
  children: React.ReactNode
  onSubmit(): void
}): React.JSX.Element {
  return (
    <form
      aria-label={label}
      className="flex flex-col gap-3 rounded-lg border border-border-soft bg-surface p-3"
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit()
      }}
    >
      {children}
    </form>
  )
}

function PanelButtons({
  saving,
  label,
  onCancel,
  destructive
}: {
  saving: boolean
  label: string
  onCancel(): void
  destructive?: boolean
}): React.JSX.Element {
  return (
    <div className="flex gap-2">
      <Button type="submit" size="sm" variant={destructive ? 'destructive' : 'default'} disabled={saving}>
        {label}
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
        Cancelar
      </Button>
    </div>
  )
}

function ChangeValue({
  secret,
  onDone,
  onCancel
}: {
  secret: SecretView
  onDone: DoneFn
  onCancel(): void
}): React.JSX.Element {
  const [value, setValue] = useState('')
  const [tried, setTried] = useState(false)
  const submit = useSubmit()
  const problem = secretValueProblem(value)
  return (
    <InlinePanel
      label={`Trocar valor de ${secret.name}`}
      onSubmit={() => {
        setTried(true)
        if (problem) return
        void submit
          .run(() => window.orkio.vault.save({ name: secret.name, note: secret.note, value }))
          .then((next) => {
            if (!next) return
            setValue('')
            onDone(next, SAVED_MESSAGE)
          })
      }}
    >
      <SecretValueField
        label="Valor novo"
        value={value}
        onChange={setValue}
        autoFocus
        error={(tried || value !== '') && problem ? problem : null}
        description="O valor de antes é substituído."
      />
      {submit.error && <Alert tone="danger">{submit.error}</Alert>}
      <PanelButtons saving={submit.saving} label="Trocar valor" onCancel={onCancel} />
    </InlinePanel>
  )
}

function EditNote({
  secret,
  onDone,
  onCancel
}: {
  secret: SecretView
  onDone: DoneFn
  onCancel(): void
}): React.JSX.Element {
  const [note, setNote] = useState(secret.note)
  const submit = useSubmit()
  return (
    <InlinePanel
      label={`Nota de ${secret.name}`}
      onSubmit={() => {
        void submit
          .run(() => window.orkio.vault.save({ name: secret.name, note: note.trim() }))
          .then((next) => next && onDone(next, 'Nota salva.'))
      }}
    >
      <TextField
        label="Nota"
        value={note}
        maxLength={SECRET_NOTE_MAX}
        autoFocus
        onChange={setNote}
      />
      {submit.error && <Alert tone="danger">{submit.error}</Alert>}
      <PanelButtons saving={submit.saving} label="Salvar nota" onCancel={onCancel} />
    </InlinePanel>
  )
}

function EditUses({
  secret,
  agents,
  servers,
  onDone,
  onCancel
}: {
  secret: SecretView
  agents: readonly AgentOption[]
  servers: readonly McpServerView[]
  onDone: DoneFn
  onCancel(): void
}): React.JSX.Element {
  const [uses, setUses] = useState<SecretUse[]>(secret.uses)
  const submit = useSubmit()
  // Agentes de outros projetos que já usam continuam na lista (para poder tirar).
  const allAgents = [
    ...agents,
    ...secret.uses
      .filter((u): u is { kind: 'agent'; key: string } => u.kind === 'agent')
      .filter((u) => !agents.some((a) => a.key === u.key))
      .map((u) => ({ key: u.key, name: u.key }))
  ]
  return (
    <InlinePanel
      label={`Quem pode usar ${secret.name}`}
      onSubmit={() => {
        void submit
          .run(() => window.orkio.vault.setUses(secret.name, uses))
          .then((next) => next && onDone(next, 'Quem pode usar foi salvo.'))
      }}
    >
      <UsesPicker uses={uses} onChange={setUses} agents={allAgents} servers={servers} />
      {submit.error && <Alert tone="danger">{submit.error}</Alert>}
      <PanelButtons saving={submit.saving} label="Salvar quem pode usar" onCancel={onCancel} />
    </InlinePanel>
  )
}

function ConfirmRemove({
  secret,
  servers,
  onDone,
  onCancel
}: {
  secret: SecretView
  servers: readonly McpServerView[]
  onDone: DoneFn
  onCancel(): void
}): React.JSX.Element {
  const submit = useSubmit()
  return (
    <InlinePanel
      label={`Apagar ${secret.name}`}
      onSubmit={() => {
        void submit
          .run(() => window.orkio.vault.remove(secret.name))
          .then((next) => next && onDone(next, `${secret.name} foi apagado.`))
      }}
    >
      <p className="text-sm">
        Apagar <span className="font-mono">{secret.name}</span>? O valor sai deste computador e não
        dá para desfazer.
      </p>
      {servers.length > 0 && (
        <Alert tone="warning">
          {servers.length === 1 ? 'O servidor MCP ' : 'Os servidores MCP '}
          {servers.map((s) => s.name).join(', ')}
          {servers.length === 1 ? ' usa' : ' usam'} este segredo e
          {servers.length === 1 ? ' vai parar' : ' vão parar'} de carregar até você escolher outro.
        </Alert>
      )}
      {submit.error && <Alert tone="danger">{submit.error}</Alert>}
      <PanelButtons
        saving={submit.saving}
        label="Apagar segredo"
        onCancel={onCancel}
        destructive
      />
    </InlinePanel>
  )
}
