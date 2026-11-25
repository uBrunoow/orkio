import { useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { PageHeader } from '../../components/PageHeader'
import { PAGE_WIDTH } from '../../components/page-width'
import { PageState } from '../../components/PageState'
import { Alert } from '../../components/Alert'
import { ChoiceCards } from '../../components/ChoiceCards'
import { SegmentedControl, SelectField, TextField } from '../../components/form'
import { StatusBadge } from '../../components/StatusToken'
import { OrkioLogo } from '../../components/OrkioLogo/OrkioLogo'
import {
  AwsLogo,
  ChromeLogo,
  ClaudeLogo,
  CopyIcon,
  DatabaseIcon,
  DockerLogo,
  DocsIcon,
  FigmaLogo,
  FirebaseLogo,
  GitHubLogo,
  GitlabLogo,
  GoogleDriveLogo,
  JiraLogo,
  McpPlugIcon,
  MongodbLogo,
  NotionLogo,
  PlusIcon,
  SearchIcon,
  SentryLogo,
  ShopIcon,
  SlackLogo,
  StripeLogo,
  SupabaseLogo,
  VercelLogo,
  type SvgIcon
} from '../../components/icons'
import { ipcResult } from '../../lib/ipc'
import { normalizeLabel } from '../../../../shared/text'
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
import { SecretValueField } from '../secrets/parts'
import { finalSecretName, toSecretName } from '../secrets/secrets-logic'
import { McpServerForm } from './McpServerForm'
import {
  draftFromServer,
  emptyDraft,
  mcpBrand,
  originLabel,
  serverFromDraft,
  toggleAgent,
  type McpBrand
} from './mcp-logic'
import { useAgentOptions, useMcp, useVault, type AgentOption } from './useConfigData'
import { CheckCardGrid } from '../agents/AgentCheckGrid'

const OFF_TEXT = 'Desligado: o comando só roda depois que você ligar.'

/** Painel aberto (um por vez na página). O "Adicionar servidor" à mão é um modal à parte. */
type OpenPanel =
  | { kind: 'server'; id: string }
  | { kind: 'remove'; id: string }
  | { kind: 'catalog'; id: string }
  | null

/** Filtro por origem (pílulas do topo, como no Compozy). */
type SourceFilter = 'all' | 'orkio' | 'catalog' | 'claude'

const BRAND_LOGO: Record<McpBrand, SvgIcon> = {
  github: GitHubLogo,
  notion: NotionLogo,
  linear: McpPlugIcon,
  aws: AwsLogo,
  vercel: VercelLogo,
  figma: FigmaLogo,
  slack: SlackLogo,
  docker: DockerLogo,
  browser: ChromeLogo,
  stripe: StripeLogo,
  sentry: SentryLogo,
  supabase: SupabaseLogo,
  gitlab: GitlabLogo,
  jira: JiraLogo,
  mongodb: MongodbLogo,
  firebase: FirebaseLogo,
  drive: GoogleDriveLogo,
  shop: ShopIcon,
  docs: DocsIcon,
  database: DatabaseIcon
}

/** Logo do servidor num quadradinho (marca conhecida ou o plugue genérico). */
function McpLogo({ brand }: { brand: McpBrand | null }): React.JSX.Element {
  const Logo = brand ? BRAND_LOGO[brand] : McpPlugIcon
  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid size-9 shrink-0 place-items-center rounded-lg border border-border-soft',
        brand ? 'bg-muted text-foreground' : 'bg-surface text-subtle-foreground'
      )}
    >
      <Logo className="size-[18px]" />
    </span>
  )
}

function TransportBadge({ transport }: { transport: string }): React.JSX.Element {
  const label =
    transport === 'stdio' ? 'Local' : transport === 'unknown' ? '?' : transport.toUpperCase()
  return (
    <span className="rounded-md border border-border-soft px-1.5 py-px font-mono text-2xs text-subtle-foreground">
      {label}
    </span>
  )
}

/** "Seu usuário · npx -y pacote": partes separadas por ponto, as do `monoFrom` em mono. */
function MetaLine({
  parts,
  monoFrom = parts.length
}: {
  parts: readonly (string | null | undefined)[]
  monoFrom?: number
}): React.JSX.Element {
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
      {parts.map((p, i) =>
        p ? (
          <span key={i} className="flex min-w-0 items-center gap-x-1.5">
            {i > 0 && (
              <span aria-hidden="true" className="text-subtle-foreground">
                ·
              </span>
            )}
            <span className={cn('truncate', i >= monoFrom && 'font-mono text-2xs')}>{p}</span>
          </span>
        ) : null
      )}
    </span>
  )
}

/** Caixa de uma origem: cabeçalho com logo, nome, contagem e linha de apoio; linhas embaixo. */
function SourceBox({
  label,
  logo,
  count,
  detail,
  end,
  children
}: {
  label: string
  logo: React.ReactNode
  count: number
  detail: React.ReactNode
  end?: React.ReactNode
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section
      aria-label={label}
      className="overflow-hidden rounded-xl border border-border-soft bg-card"
    >
      <div className="flex flex-wrap items-center gap-3 border-b border-border-soft bg-surface/60 px-4 py-3">
        {logo}
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-center gap-2">
            <h2 className="text-sm font-medium text-foreground">{label}</h2>
            <span className="rounded-full bg-muted px-1.5 text-2xs text-muted-foreground tabular-nums">
              {count}
            </span>
          </span>
          <span className="truncate text-xs text-muted-foreground">{detail}</span>
        </div>
        {end}
      </div>
      {children}
    </section>
  )
}

const SOURCE_LOGO_CLASS = 'grid size-7 shrink-0 place-items-center rounded-md'

export function McpPage({ projectId }: { projectId: string | null }): React.JSX.Element {
  const mcp = useMcp()
  const vault = useVault()
  const agents = useAgentOptions(projectId)
  const [open, setOpen] = useState<OpenPanel>(null)
  const [adding, setAdding] = useState(false)
  const [filter, setFilter] = useState<SourceFilter>('all')
  const [query, setQuery] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const view = mcp.value
  const secretNames = useMemo(() => (vault.value?.secrets ?? []).map((s) => s.name), [vault.value])

  const isOpen = (kind: string, id?: string): boolean =>
    open !== null && open.kind === kind && (id === undefined || ('id' in open && open.id === id))
  const toggle = (panel: Exclude<OpenPanel, null>): void => {
    setNotice(null)
    setError(null)
    const same = open !== null && open.kind === panel.kind && open.id === panel.id
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

  const q = normalizeLabel(query)
  const hit = (...texts: readonly (string | null | undefined)[]): boolean =>
    !q || normalizeLabel(texts.filter(Boolean).join(' ')).includes(q)
  const servers = (view?.servers ?? []).filter((s) => hit(s.name, s.description, s.url, s.command))
  const catalog = MCP_CATALOG.filter((e) => hit(e.name, e.category, e.description))
  const claude = (view?.claude ?? []).filter((c) => hit(c.ref.name, c.summary, c.where))
  const show = (f: SourceFilter): boolean => filter === 'all' || filter === f
  const enabledCount = (view?.servers ?? []).filter((s) => s.enabled).length

  const pills: { value: SourceFilter; label: string; count: number; logo?: React.ReactNode }[] = [
    { value: 'all', label: 'Todos', count: servers.length + catalog.length + claude.length },
    {
      value: 'orkio',
      label: 'Do Orkio',
      count: servers.length,
      logo: <OrkioLogo variant="simple" size={12} label="" className="pointer-events-none" />
    },
    { value: 'catalog', label: 'Catálogo', count: catalog.length },
    {
      value: 'claude',
      label: 'Claude Code',
      count: claude.length,
      logo: <ClaudeLogo className="size-3 text-claude" />
    }
  ]

  return (
    <div className={cn('flex flex-col gap-5', PAGE_WIDTH.form)}>
      <div className="flex flex-col gap-2">
        <PageHeader
          title="Servidores MCP"
          subtitle="Ferramentas extras para os agentes: GitHub, Notion, navegador e outras."
          action={
            <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
              <PlusIcon />
              Adicionar servidor
            </Button>
          }
        />
        {view && (
          <p className="text-xs text-muted-foreground tabular-nums">
            {view.servers.length} no Orkio
            <span aria-hidden="true" className="px-1.5 text-subtle-foreground">
              ·
            </span>
            {enabledCount} {enabledCount === 1 ? 'ligado' : 'ligados'}
            <span aria-hidden="true" className="px-1.5 text-subtle-foreground">
              ·
            </span>
            {view.claude.length} no seu Claude Code
          </p>
        )}
      </div>

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
          <div className="flex flex-col gap-2.5">
            <div className="relative w-full max-w-72">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-subtle-foreground" />
              <Input
                type="search"
                aria-label="Buscar servidor"
                placeholder="Buscar servidor"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="h-8 pl-7 text-xs"
              />
            </div>
            <div role="radiogroup" aria-label="Origem" className="flex flex-wrap gap-1">
              {pills.map((p) => {
                const on = filter === p.value
                return (
                  <button
                    key={p.value}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setFilter(p.value)}
                    className={cn(
                      'inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
                      on
                        ? 'border-brand/50 bg-brand-tint/50 text-foreground'
                        : 'border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                    )}
                  >
                    {p.logo && (
                      <span aria-hidden="true" className="flex">
                        {p.logo}
                      </span>
                    )}
                    {p.label}
                    <span className="text-subtle-foreground tabular-nums">{p.count}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {show('orkio') &&
            (view.servers.length === 0 ? (
              <section
                aria-label="Do Orkio"
                data-testid="empty-hero"
                className="flex flex-col items-center gap-2 rounded-xl border border-border-soft bg-card px-6 py-9 text-center"
              >
                <span className="grid size-12 place-items-center rounded-xl border border-border-soft bg-muted text-muted-foreground">
                  <McpPlugIcon className="size-6" />
                </span>
                <p className="pt-1 text-sm font-medium text-foreground">
                  Nenhum servidor no Orkio ainda
                </p>
                <p className="max-w-sm text-xs text-muted-foreground">
                  Adicione um, comece pelo catálogo ou copie um que o seu Claude Code já usa. Todo
                  servidor chega desligado.
                </p>
                <div className="flex flex-wrap justify-center gap-2 pt-2">
                  <Button size="sm" onClick={() => setAdding(true)}>
                    <PlusIcon />
                    Adicionar servidor
                  </Button>
                  {MCP_CATALOG.slice(0, 2).map((e) => (
                    <Button
                      key={e.id}
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setFilter('all')
                        setOpen({ kind: 'catalog', id: e.id })
                      }}
                    >
                      Começar com {e.name}
                    </Button>
                  ))}
                </div>
              </section>
            ) : (
              <SourceBox
                label="Do Orkio"
                count={view.servers.length}
                logo={
                  <span aria-hidden="true" className={cn(SOURCE_LOGO_CLASS, 'bg-brand')}>
                    <OrkioLogo
                      variant="simple"
                      size={16}
                      label=""
                      className="text-primary-foreground!"
                    />
                  </span>
                }
                detail="Entram nas execuções do Claude Code pelo Orkio, nos agentes que você escolher."
              >
                {servers.length === 0 ? (
                  <p className="px-4 py-4 text-xs text-muted-foreground">
                    Nenhum servidor do Orkio com “{query}”.
                  </p>
                ) : (
                  <div className="flex flex-col divide-y divide-border-soft">
                    {servers.map((s) => (
                      <ServerCard
                        key={s.id}
                        server={s}
                        agents={agents}
                        secretNames={secretNames}
                        panel={
                          isOpen('server', s.id)
                            ? 'config'
                            : isOpen('remove', s.id)
                              ? 'remove'
                              : null
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
              </SourceBox>
            ))}

          {show('catalog') && (
            <SourceBox
              label="Catálogo"
              count={MCP_CATALOG.length}
              logo={
                <span
                  aria-hidden="true"
                  className={cn(SOURCE_LOGO_CLASS, 'bg-muted text-muted-foreground')}
                >
                  <McpPlugIcon className="size-4" />
                </span>
              }
              detail="Servidores conhecidos, prontos para adicionar com os segredos que pedem."
            >
              {catalog.length === 0 ? (
                <p className="px-4 py-4 text-xs text-muted-foreground">
                  Nada no catálogo com “{query}”.
                </p>
              ) : (
                <div className="flex flex-col divide-y divide-border-soft">
                  {catalog.map((entry) => {
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
              )}
            </SourceBox>
          )}

          {show('claude') && (
            <SourceBox
              label="Já no seu Claude Code"
              count={view.claude.length}
              logo={
                <span aria-hidden="true" className={cn(SOURCE_LOGO_CLASS, 'bg-claude text-white')}>
                  <ClaudeLogo className="size-4" />
                </span>
              }
              detail="Só para ver: o Orkio não mexe neles. Copie para ligar só nas execuções e agentes que escolher."
            >
              {view.claudeError && (
                <p className="px-4 pt-3 text-xs text-muted-foreground" role="status">
                  {view.claudeError}
                </p>
              )}
              {view.claude.length === 0 && !view.claudeError ? (
                <p className="px-4 py-4 text-xs text-muted-foreground">
                  Nenhum servidor MCP no seu Claude Code.
                </p>
              ) : claude.length === 0 ? (
                view.claude.length > 0 && (
                  <p className="px-4 py-4 text-xs text-muted-foreground">
                    Nenhum servidor do seu Claude Code com “{query}”.
                  </p>
                )
              ) : (
                <ul className="flex flex-col divide-y divide-border-soft">
                  {claude.map((c) => (
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
              )}
            </SourceBox>
          )}

          <Dialog open={adding} onOpenChange={setAdding}>
            <DialogContent className="max-h-[85vh] gap-4 overflow-y-auto sm:max-w-2xl">
              <div className="flex items-center gap-3 pr-6">
                <McpLogo brand={null} />
                <div className="flex flex-col gap-0.5">
                  <DialogTitle className="text-base font-medium text-foreground">
                    Adicionar servidor MCP
                  </DialogTitle>
                  <DialogDescription className="text-xs text-muted-foreground">
                    Um comando neste computador ou um endereço na internet. Chega desligado.
                  </DialogDescription>
                </div>
              </div>
              <McpServerForm
                bare
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
                  if (!problem) setAdding(false)
                  return problem
                }}
                onCancel={() => setAdding(false)}
              />
            </DialogContent>
          </Dialog>
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
  const agentList: AgentOption[] = [
    ...agents,
    ...someAgents.filter((k) => !agents.some((a) => a.key === k)).map((k) => ({ key: k, name: k }))
  ]

  return (
    <article
      aria-labelledby={nameId}
      data-testid={`mcp-server-${server.id}`}
      className="flex flex-col gap-3 px-4 py-3"
    >
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <McpLogo brand={mcpBrand(server.name, server.url, server.command)} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex flex-wrap items-center gap-2">
            <h3 id={nameId} className="text-sm font-medium text-foreground">
              {server.name}
            </h3>
            <TransportBadge transport={server.transport} />
          </span>
          <MetaLine parts={[originLabel(server.origin), mcpLaunchText(server)]} monoFrom={1} />
          {server.description && (
            <p className="text-xs text-muted-foreground">{server.description}</p>
          )}
          <span className="flex items-center gap-1.5 pt-0.5 text-xs" data-testid="mcp-state">
            <StatusBadge
              tone={server.enabled ? 'success' : 'neutral'}
              label={
                server.enabled
                  ? server.agents === 'all'
                    ? 'Ligado em todas as execuções'
                    : `Ligado para ${server.agents.length} agente${server.agents.length === 1 ? '' : 's'}`
                  : 'Desligado'
              }
            />
            {!server.enabled && (
              <span className="text-subtle-foreground">
                o comando só roda depois que você ligar
              </span>
            )}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <label className="mr-1 flex items-center gap-2 text-xs text-muted-foreground">
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
            variant="danger"
            className={panel === 'remove' ? 'bg-danger-tint' : undefined}
            aria-expanded={panel === 'remove'}
            aria-label={`Remover ${server.name}`}
            onClick={onToggleRemove}
          >
            Remover
          </Button>
        </div>
      </div>

      {server.problems.length > 0 && (
        <Alert tone="info" className="ml-12 py-2">
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
          className="ml-12 flex flex-col gap-3 rounded-lg border border-border-soft bg-surface p-3"
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
        <div className="ml-12 flex flex-col gap-4 rounded-lg border border-border-soft bg-surface p-4">
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
                <div className="flex flex-col gap-2">
                  <CheckCardGrid
                    label={`Agentes que usam ${server.name}`}
                    disabled={busy}
                    items={agentList.map((a) => ({
                      key: a.key,
                      name: a.name,
                      description: a.description,
                      face: { color: a.color, seed: a.key }
                    }))}
                    checked={(key) => someAgents.includes(key)}
                    onToggle={(key, on) =>
                      void change(
                        { agents: toggleAgent(someAgents, key, on) },
                        'Quem usa foi salvo.'
                      )
                    }
                  />
                  {someAgents.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                      Nenhum agente marcado: o servidor não entra em nenhuma execução.
                    </p>
                  )}
                </div>
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
    <div className="flex flex-col gap-3 px-4 py-3">
      <article
        aria-labelledby={nameId}
        data-testid={`mcp-catalog-${entry.id}`}
        className="flex items-center gap-3"
      >
        <McpLogo brand={mcpBrand(entry.id, entry.name, entry.url)} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex flex-wrap items-center gap-2">
            <h3 id={nameId} className="text-sm font-medium text-foreground">
              {entry.name}
            </h3>
            <TransportBadge transport={entry.transport} />
            {added && <StatusBadge label="já no Orkio" tone="success" />}
          </span>
          <MetaLine parts={[entry.category, entry.description]} />
        </div>
        <Button
          size="sm"
          variant={open ? 'secondary' : 'outline'}
          aria-label={`${open ? 'Fechar' : 'Adicionar'} ${entry.name}`}
          aria-expanded={open}
          onClick={onToggle}
        >
          {open ? 'Fechar' : 'Adicionar'}
        </Button>
      </article>
      {open && children && <div className="ml-12">{children}</div>}
    </div>
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
      className="flex flex-col gap-4 rounded-lg border border-border-soft bg-surface p-4"
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
      className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3"
    >
      <McpLogo brand={mcpBrand(entry.ref.name, entry.summary)} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm text-foreground">{entry.ref.name}</span>
          <TransportBadge transport={entry.transport} />
        </span>
        <MetaLine parts={[entry.where, entry.summary]} monoFrom={1} />
        {keys.length > 0 && (
          <span className="flex flex-wrap items-center gap-1 pt-0.5">
            <span className="text-2xs text-subtle-foreground">Usa</span>
            {keys.map((k) => (
              <span
                key={k}
                className="rounded bg-muted px-1 font-mono text-2xs text-muted-foreground"
              >
                {k}
              </span>
            ))}
            <span className="text-2xs text-subtle-foreground">(valores não aparecem aqui)</span>
          </span>
        )}
      </div>
      {entry.copied ? (
        <StatusBadge label="Já copiado" tone="success" />
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
          <CopyIcon />
          Copiar para o Orkio
        </Button>
      )}
    </li>
  )
}
