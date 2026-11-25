import { useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { PageHeader } from '../../components/PageHeader'
import { PAGE_WIDTH } from '../../components/page-width'
import { PageState } from '../../components/PageState'
import { Alert } from '../../components/Alert'
import { ChoiceCards } from '../../components/ChoiceCards'
import { CheckboxField, SegmentedControl, SelectField, TextField } from '../../components/form'
import { StatusDot } from '../../components/StatusToken'
import { PlusIcon } from '../../components/icons'
import { ipcResult } from '../../lib/ipc'
import {
  MCP_CATALOG,
  freeMcpId,
  mcpLaunchText,
  parseMcpServer,
  type ClaudeMcpEntry,
  type McpCatalogEntry,
  type McpCatalogSecret,
  type McpServer,
  type McpServerView,
  type McpView
} from '../../../../shared/mcp'
import { secretNameProblem, secretValueProblem } from '../../../../shared/vault'
import type { Result } from '../../../../shared/result'
import { AppliesTo, SecretValueField } from '../secrets/parts'
import { finalSecretName, toSecretName } from '../secrets/secrets-logic'
import { McpServerForm } from './McpServerForm'
import { draftFromServer, emptyDraft, originLabel, serverFromDraft, toggleAgent } from './mcp-logic'
import { useAgentOptions, useMcp, useVault, type AgentOption } from './useConfigData'

const OFF_TEXT = 'Desligado: o comando só roda depois que você ligar.'

/** Painel aberto (um por vez na página). */
type OpenPanel =
  | { kind: 'server'; id: string }
  | { kind: 'remove'; id: string }
  | { kind: 'catalog'; id: string }
  | { kind: 'manual' }
  | null

export function McpPage({ projectId }: { projectId: string | null }): React.JSX.Element {
  const mcp = useMcp()
  const vault = useVault()
  const agents = useAgentOptions(projectId)
  const [open, setOpen] = useState<OpenPanel>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const view = mcp.value
  const secretNames = useMemo(() => (vault.value?.secrets ?? []).map((s) => s.name), [vault.value])

  const isOpen = (kind: string, id?: string): boolean =>
    open !== null && open.kind === kind && (id === undefined || ('id' in open && open.id === id))
  const toggle = (panel: Exclude<OpenPanel, null>): void => {
    setNotice(null)
    setError(null)
    const same =
      open !== null &&
      open.kind === panel.kind &&
      ('id' in panel ? 'id' in open && open.id === panel.id : true)
    setOpen(same ? null : panel)
  }

  /** Aplica um `Result<McpView>`: guarda o estado novo ou mostra o erro. */
  const apply = (r: Result<McpView>, message: string | null): string | null => {
    if (!r.ok) {
      setError(r.error.message)
      return r.error.message
    }
    mcp.set(r.value)
    setError(null)
    setNotice(message)
    void vault.reload()
    return null
  }

  const save = async (server: McpServer, message: string | null): Promise<string | null> =>
    apply(await ipcResult(() => window.orkio.mcp.save(server)), message)

  return (
    <div className={cn('flex flex-col gap-[18px]', PAGE_WIDTH.list)}>
      <PageHeader
        title="Servidores MCP"
        subtitle="Ferramentas extras para os agentes: GitHub, Notion, navegador e outras."
      />
      <AppliesTo>
        as execuções do Claude Code pelo Orkio, em todos os projetos, neste computador
      </AppliesTo>
      <p className="-mt-2 text-xs text-muted-foreground">
        Os servidores ligados entram nas execuções do Claude Code do Orkio. Os do seu Claude Code
        continuam valendo como sempre.
      </p>
      {notice && (
        <Alert tone="info" className="py-2">
          {notice}
        </Alert>
      )}
      {error && <Alert tone="danger">{error}</Alert>}

      {view === null && mcp.error ? (
        <PageState
          kind="error"
          message={mcp.error.message}
          action={{ label: 'Tentar de novo', onClick: () => void mcp.reload() }}
        />
      ) : view === null ? (
        <PageState kind="loading" label="Carregando servidores MCP" rows={3} />
      ) : (
        <>
          <section aria-label="Do Orkio" className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-2xs tracking-[0.06em] text-subtle-foreground uppercase">
                Do Orkio
              </h2>
              <Button
                size="xs"
                variant="ghost"
                aria-expanded={isOpen('manual')}
                onClick={() => toggle({ kind: 'manual' })}
              >
                <PlusIcon />
                Adicionar à mão
              </Button>
            </div>
            {isOpen('manual') && (
              <McpServerForm
                title="Servidor à mão"
                initial={emptyDraft()}
                secretNames={secretNames}
                submitLabel="Adicionar servidor"
                build={(d) =>
                  serverFromDraft(d, {
                    id: freeMcpId(
                      d.name,
                      view.servers.map((s) => s.id)
                    ),
                    origin: { kind: 'manual' },
                    enabled: false,
                    agents: 'all',
                    createdAt: new Date().toISOString()
                  })
                }
                onSave={async (server) => {
                  const problem = await save(server, `${server.name} adicionado. ${OFF_TEXT}`)
                  if (!problem) setOpen(null)
                  return problem
                }}
                onCancel={() => setOpen(null)}
              />
            )}
            {view.servers.length === 0 && !isOpen('manual') ? (
              <div
                data-testid="empty-hero"
                className="flex flex-col gap-2 rounded-xl border border-dashed border-border px-5 py-5"
              >
                <p className="text-sm font-medium">Nenhum servidor no Orkio ainda</p>
                <p className="max-w-prose text-xs text-muted-foreground">
                  Comece por um do catálogo, copie um que o seu Claude Code já usa ou adicione à
                  mão. Todo servidor chega desligado.
                </p>
                <div className="flex flex-wrap gap-2 pt-1">
                  {MCP_CATALOG.slice(0, 3).map((e) => (
                    <Button
                      key={e.id}
                      size="sm"
                      variant="outline"
                      onClick={() => setOpen({ kind: 'catalog', id: e.id })}
                    >
                      Começar com {e.name}
                    </Button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {view.servers.map((s) => (
                  <ServerCard
                    key={s.id}
                    server={s}
                    agents={agents}
                    secretNames={secretNames}
                    panel={
                      isOpen('server', s.id) ? 'config' : isOpen('remove', s.id) ? 'remove' : null
                    }
                    onToggleConfig={() => toggle({ kind: 'server', id: s.id })}
                    onToggleRemove={() => toggle({ kind: 'remove', id: s.id })}
                    onClose={() => setOpen(null)}
                    onSave={save}
                    onRemove={async () => {
                      const problem = apply(
                        await ipcResult(() => window.orkio.mcp.remove(s.id)),
                        `${s.name} foi removido.`
                      )
                      if (!problem) setOpen(null)
                    }}
                  />
                ))}
              </div>
            )}
          </section>

          <section aria-label="Catálogo" className="flex flex-col gap-2">
            <h2 className="text-2xs tracking-[0.06em] text-subtle-foreground uppercase">
              Catálogo
            </h2>
            <div className="grid grid-cols-1 gap-2 min-[900px]:grid-cols-2">
              {MCP_CATALOG.map((entry) => {
                const added = view.servers.some(
                  (s) => s.origin.kind === 'catalog' && s.origin.id === entry.id
                )
                const opened = isOpen('catalog', entry.id)
                return (
                  <CatalogCard
                    key={entry.id}
                    entry={entry}
                    added={added}
                    open={opened}
                    onToggle={() => toggle({ kind: 'catalog', id: entry.id })}
                  >
                    {opened && (
                      <CatalogPanel
                        entry={entry}
                        secretNames={secretNames}
                        vaultAvailable={vault.value?.available ?? false}
                        onCancel={() => setOpen(null)}
                        onAdd={async (secrets) => {
                          const problem = apply(
                            await ipcResult(() =>
                              window.orkio.mcp.addFromCatalog(entry.id, secrets)
                            ),
                            `${entry.name} adicionado. ${OFF_TEXT}`
                          )
                          if (!problem) setOpen(null)
                          return problem
                        }}
                        onSecretSaved={() => void vault.reload()}
                      />
                    )}
                  </CatalogCard>
                )
              })}
            </div>
          </section>

          <section aria-label="Já no seu Claude Code" className="flex flex-col gap-2">
            <h2 className="text-2xs tracking-[0.06em] text-subtle-foreground uppercase">
              Já no seu Claude Code
            </h2>
            <p className="text-xs text-muted-foreground">
              Só para ver: o Orkio não mexe neles. Copie para o Orkio para ligar só nas execuções e
              agentes que você escolher.
            </p>
            {view.claudeError && (
              <p className="text-xs text-muted-foreground" role="status">
                {view.claudeError}
              </p>
            )}
            {view.claude.length === 0 && !view.claudeError ? (
              <p className="text-xs text-muted-foreground">
                Nenhum servidor MCP no seu Claude Code.
              </p>
            ) : (
              view.claude.length > 0 && (
                <ul className="flex flex-col divide-y divide-border-soft rounded-xl border border-border-soft bg-card">
                  {view.claude.map((c) => (
                    <ClaudeRow
                      key={`${c.ref.scope}:${c.ref.projectId ?? ''}:${c.ref.name}`}
                      entry={c}
                      onCopy={async () => {
                        apply(
                          await ipcResult(() => window.orkio.mcp.copyFromClaude(c.ref)),
                          `${c.ref.name} copiado para o Orkio. ${OFF_TEXT}`
                        )
                      }}
                    />
                  ))}
                </ul>
              )
            )}
          </section>
        </>
      )}
    </div>
  )
}

function ServerCard({
  server,
  agents,
  secretNames,
  panel,
  onToggleConfig,
  onToggleRemove,
  onClose,
  onSave,
  onRemove
}: {
  server: McpServerView
  agents: readonly AgentOption[]
  secretNames: readonly string[]
  panel: 'config' | 'remove' | null
  onToggleConfig(): void
  onToggleRemove(): void
  onClose(): void
  onSave(server: McpServer, message: string | null): Promise<string | null>
  onRemove(): Promise<void>
}): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const [advanced, setAdvanced] = useState(false)
  const nameId = `mcp-${server.id}-name`
  const change = async (patch: Partial<McpServer>, message: string | null): Promise<void> => {
    const next = parseMcpServer({ ...server, ...patch })
    if (!next) return
    setBusy(true)
    await onSave(next, message)
    setBusy(false)
  }
  const someAgents = server.agents === 'all' ? [] : server.agents
  const agentList = [
    ...agents,
    ...someAgents.filter((k) => !agents.some((a) => a.key === k)).map((k) => ({ key: k, name: k }))
  ]

  return (
    <article
      aria-labelledby={nameId}
      data-testid={`mcp-server-${server.id}`}
      className="flex flex-col gap-3 rounded-xl border border-border-soft bg-card p-4"
    >
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h3 id={nameId} className="text-sm font-medium text-foreground">
            {server.name}
          </h3>
          <span className="text-2xs text-subtle-foreground">{originLabel(server.origin)}</span>
          {server.description && (
            <p className="text-xs text-muted-foreground">{server.description}</p>
          )}
          <code className="truncate font-mono text-2xs text-muted-foreground">
            {mcpLaunchText(server)}
          </code>
          <span className="flex items-center gap-1.5 text-xs" data-testid="mcp-state">
            <StatusDot tone={server.enabled ? 'success' : 'neutral'} />
            <span className={server.enabled ? 'text-foreground' : 'text-muted-foreground'}>
              {server.enabled
                ? server.agents === 'all'
                  ? 'Ligado em todas as execuções'
                  : `Ligado para ${server.agents.length} agente${server.agents.length === 1 ? '' : 's'}`
                : OFF_TEXT}
            </span>
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Switch
              checked={server.enabled}
              disabled={busy}
              aria-label={`Ligado: ${server.name}`}
              onCheckedChange={(enabled) =>
                void change(
                  { enabled },
                  enabled ? `${server.name} ligado.` : `${server.name} desligado.`
                )
              }
            />
            Ligado
          </label>
          <Button
            size="xs"
            variant={panel === 'config' ? 'secondary' : 'ghost'}
            aria-expanded={panel === 'config'}
            aria-label={`Configurar ${server.name}`}
            onClick={onToggleConfig}
          >
            Configurar
          </Button>
          <Button
            size="xs"
            variant={panel === 'remove' ? 'secondary' : 'ghost'}
            aria-expanded={panel === 'remove'}
            aria-label={`Remover ${server.name}`}
            onClick={onToggleRemove}
          >
            Remover
          </Button>
        </div>
      </div>

      {server.problems.length > 0 && (
        <Alert tone="info" className="py-2">
          <ul className="flex flex-col gap-0.5">
            {server.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          <p className="pt-1 text-xs text-muted-foreground">Resolva em Configurações › Segredos.</p>
        </Alert>
      )}

      {panel === 'remove' && (
        <div
          role="group"
          aria-label={`Remover ${server.name}?`}
          className="flex flex-col gap-3 rounded-lg border border-border-soft bg-surface p-3"
        >
          <p className="text-sm">
            Remover {server.name} do Orkio? Os segredos continuam guardados. Os servidores do seu
            Claude Code não mudam.
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="destructive"
              disabled={busy}
              onClick={() => {
                setBusy(true)
                void onRemove().finally(() => setBusy(false))
              }}
            >
              Remover servidor
            </Button>
            <Button size="sm" variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
          </div>
        </div>
      )}

      {panel === 'config' && (
        <div className="flex flex-col gap-4 rounded-lg border border-border-soft bg-surface p-4">
          <div className="flex justify-end">
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
          {!advanced ? (
            <div className="flex flex-col gap-3">
              <span className="text-sm font-medium">Quem usa</span>
              <ChoiceCards
                label="Quem usa"
                columns={2}
                disabled={busy}
                value={server.agents === 'all' ? 'all' : 'some'}
                onChange={(v) =>
                  void change({ agents: v === 'all' ? 'all' : someAgents }, 'Quem usa foi salvo.')
                }
                options={[
                  {
                    value: 'all',
                    title: 'Todas as execuções',
                    phrase: 'Toda execução do Claude Code pelo Orkio, com ou sem agente.'
                  },
                  {
                    value: 'some',
                    title: 'Só estes agentes',
                    phrase: 'Só quando um dos agentes escolhidos roda.'
                  }
                ]}
              />
              {server.agents !== 'all' && (
                <fieldset className="flex flex-col gap-2" disabled={busy}>
                  <legend className="sr-only">Agentes que usam {server.name}</legend>
                  {agentList.map((a) => (
                    <CheckboxField
                      key={a.key}
                      label={a.name}
                      checked={someAgents.includes(a.key)}
                      disabled={busy}
                      onChange={(on) =>
                        void change(
                          { agents: toggleAgent(someAgents, a.key, on) },
                          'Quem usa foi salvo.'
                        )
                      }
                    />
                  ))}
                  {someAgents.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                      Nenhum agente marcado: o servidor não entra em nenhuma execução.
                    </p>
                  )}
                </fieldset>
              )}
            </div>
          ) : (
            <McpServerForm
              title={`Editar ${server.name}`}
              initial={draftFromServer(server)}
              secretNames={secretNames}
              submitLabel="Salvar servidor"
              build={(d) =>
                serverFromDraft(d, {
                  id: server.id,
                  origin: server.origin,
                  enabled: server.enabled,
                  agents: server.agents,
                  createdAt: server.createdAt
                })
              }
              onSave={async (next) => {
                const problem = await onSave(next, `${next.name} salvo.`)
                if (!problem) onClose()
                return problem
              }}
              onCancel={onClose}
            />
          )}
        </div>
      )}
    </article>
  )
}

function CatalogCard({
  entry,
  added,
  open,
  onToggle,
  children
}: {
  entry: McpCatalogEntry
  added: boolean
  open: boolean
  onToggle(): void
  children?: React.ReactNode
}): React.JSX.Element {
  const nameId = `mcp-catalog-${entry.id}-name`
  return (
    <>
      <article
        aria-labelledby={nameId}
        data-testid={`mcp-catalog-${entry.id}`}
        className="flex items-center gap-3 rounded-xl border border-border-soft bg-card p-3"
      >
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h3 id={nameId} className="text-sm font-medium text-foreground">
            {entry.name}
          </h3>
          <span className="font-mono text-2xs text-subtle-foreground">
            {entry.category.toLowerCase()}
            {added ? ' · já no Orkio' : ''}
          </span>
          <span className="text-xs text-muted-foreground">{entry.description}</span>
        </div>
        <Button
          size="sm"
          variant="secondary"
          aria-label={`${open ? 'Fechar' : 'Adicionar'} ${entry.name}`}
          aria-expanded={open}
          onClick={onToggle}
        >
          {open ? 'Fechar' : 'Adicionar'}
        </Button>
      </article>
      {open && children && <div className="col-span-full">{children}</div>}
    </>
  )
}

const NEW = '__new__'
const NONE = '__none__'

interface SecretChoice {
  /** Nome de um segredo existente, `NEW` (criar agora) ou `NONE` (sem, só nos opcionais). */
  pick: string
  newName: string
  value: string
}

function initialChoice(s: McpCatalogSecret, secretNames: readonly string[]): SecretChoice {
  const pick = secretNames.includes(s.suggested) ? s.suggested : s.required ? NEW : NONE
  return { pick, newName: s.suggested, value: '' }
}

function CatalogPanel({
  entry,
  secretNames,
  vaultAvailable,
  onCancel,
  onAdd,
  onSecretSaved
}: {
  entry: McpCatalogEntry
  secretNames: readonly string[]
  vaultAvailable: boolean
  onCancel(): void
  onAdd(secrets: Record<string, string>): Promise<string | null>
  onSecretSaved(): void
}): React.JSX.Element {
  const [choices, setChoices] = useState<Record<string, SecretChoice>>(() =>
    Object.fromEntries(entry.secrets.map((s) => [s.name, initialChoice(s, secretNames)]))
  )
  const [tried, setTried] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const choiceOf = (s: McpCatalogSecret): SecretChoice =>
    choices[s.name] ?? initialChoice(s, secretNames)
  const setChoice = (s: McpCatalogSecret, patch: Partial<SecretChoice>): void =>
    setChoices((c) => ({ ...c, [s.name]: { ...choiceOf(s), ...patch } }))

  const problemsOf = (s: McpCatalogSecret): { name: string | null; value: string | null } => {
    const c = choiceOf(s)
    if (c.pick !== NEW) return { name: null, value: null }
    const name = finalSecretName(c.newName)
    return {
      name: !name
        ? 'Dê um nome ao segredo.'
        : secretNames.includes(name)
          ? 'Já existe: escolha-o na lista acima.'
          : secretNameProblem(name),
      value: secretValueProblem(c.value)
    }
  }

  const submit = async (): Promise<void> => {
    setTried(true)
    setError(null)
    const needsVault = entry.secrets.some((s) => choiceOf(s).pick === NEW)
    if (needsVault && !vaultAvailable) {
      setError('Sem a criptografia do sistema o Orkio não guarda segredos.')
      return
    }
    if (entry.secrets.some((s) => problemsOf(s).name || problemsOf(s).value)) return
    setSaving(true)
    const map: Record<string, string> = {}
    for (const s of entry.secrets) {
      const c = choiceOf(s)
      if (c.pick === NONE) continue
      if (c.pick !== NEW) {
        map[s.name] = c.pick
        continue
      }
      const name = finalSecretName(c.newName)
      const saved = await ipcResult(() =>
        window.orkio.vault.save({ name, note: `Para o servidor MCP ${entry.name}`, value: c.value })
      )
      if (!saved.ok) {
        setSaving(false)
        setError(saved.error.message)
        return
      }
      // O valor sai da memória da tela assim que o main guardou.
      setChoice(s, { pick: name, value: '' })
      onSecretSaved()
      map[s.name] = name
    }
    const problem = await onAdd(map)
    setSaving(false)
    if (problem) setError(problem)
  }

  return (
    <form
      aria-label={`Adicionar ${entry.name} ao Orkio`}
      className="flex flex-col gap-4 rounded-xl border border-border-soft bg-surface p-4"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">O que vai rodar</span>
        <code className="font-mono text-xs break-all text-foreground" data-testid="mcp-launch">
          {mcpLaunchText(entry)}
        </code>
      </div>
      {entry.secrets.map((s) => {
        const c = choiceOf(s)
        const p = tried ? problemsOf(s) : { name: null, value: null }
        return (
          <fieldset
            key={s.name}
            className="flex flex-col gap-3 rounded-lg border border-border-soft bg-card p-3"
          >
            <legend className="sr-only">{s.label}</legend>
            <SelectField
              label={s.label}
              description={s.help}
              value={c.pick}
              options={[
                ...secretNames.map((n) => ({ value: n, label: n, group: 'Guardados' })),
                { value: NEW, label: 'Criar agora' },
                ...(s.required ? [] : [{ value: NONE, label: 'Sem segredo' }])
              ]}
              onChange={(pick) => setChoice(s, { pick })}
            />
            {c.pick === NEW && (
              <div className="grid gap-3 sm:grid-cols-2">
                <TextField
                  label="Nome do segredo"
                  mono
                  value={c.newName}
                  onChange={(v) => setChoice(s, { newName: toSecretName(v) })}
                  error={p.name}
                />
                <SecretValueField
                  label="Valor"
                  value={c.value}
                  onChange={(value) => setChoice(s, { value })}
                  error={p.value}
                  description="Guardado cifrado em Segredos; o Orkio não mostra de novo."
                />
              </div>
            )}
          </fieldset>
        )
      })}
      {entry.oauth && (
        <p className="text-xs text-muted-foreground">
          Este servidor pede login pela própria conta. Entre uma vez pelo Claude Code com{' '}
          <code className="font-mono text-foreground">/mcp</code>.
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Chega desligado: o comando só roda depois que você ligar.
      </p>
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={saving}>
          {saving ? 'Adicionando…' : 'Adicionar ao Orkio'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </form>
  )
}

function ClaudeRow({
  entry,
  onCopy
}: {
  entry: ClaudeMcpEntry
  onCopy(): Promise<void>
}): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const keys = [...entry.envKeys, ...entry.headerKeys]
  return (
    <li
      aria-label={entry.ref.name}
      data-testid="claude-mcp-row"
      className="flex flex-wrap items-center gap-x-4 gap-y-2 p-3"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex flex-wrap items-baseline gap-2">
          <span className="font-mono text-sm text-foreground">{entry.ref.name}</span>
          <span className="text-2xs text-subtle-foreground">
            {entry.where} · {entry.transport}
          </span>
        </span>
        <code className="truncate font-mono text-2xs text-muted-foreground">{entry.summary}</code>
        {keys.length > 0 && (
          <span className="text-2xs text-subtle-foreground">
            Usa: <span className="font-mono">{keys.join(', ')}</span> (valores não aparecem aqui)
          </span>
        )}
      </div>
      {entry.copied ? (
        <span className="text-xs text-muted-foreground">Já copiado</span>
      ) : (
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          aria-label={`Copiar ${entry.ref.name} para o Orkio`}
          onClick={() => {
            setBusy(true)
            void onCopy().finally(() => setBusy(false))
          }}
        >
          Copiar para o Orkio
        </Button>
      )}
    </li>
  )
}
