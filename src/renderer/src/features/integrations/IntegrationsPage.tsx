import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import type { ClaudeCodeStatus } from '../../../../shared/agent-run'
import type { AlvaPrecheck } from '../../../../shared/alva'
import type { ConnectionStatus, NotionWorkspaceStatus } from '../../../../shared/ipc-contract'
import type { StatusTone } from '../../components/StatusToken'
import { ClaudeLogo, GitHubLogo, NotionLogo, TerminalIcon } from '../../components/icons'
import { PageHeader } from '../../components/PageHeader'
import { ClaudeCodeCard } from '../claude/ClaudeCodeCard'
import { NotionWorkspaceCard } from '../notion-workspace/NotionWorkspaceCard'
import { useNotionWorkspace } from '../notion-workspace/useNotionWorkspace'
import { GitHubConnectionCard } from './GitHubConnectionCard'
import { NotionConnectionCard } from './NotionConnectionCard'
import { useGitHubConnection } from './useGitHubConnection'
import { useNotionConnection } from './useNotionConnection'
import { IntegrationListHeader, IntegrationRow } from './IntegrationRow'
import { PAGE_WIDTH } from '../../components/page-width'

export function IntegrationsPage({
  projectId = null
}: {
  /** Projeto atual (para a checagem do GitHub CLI e do alva-flow). */
  projectId?: string | null
}): React.JSX.Element {
  const notion = useNotionConnection()
  const github = useGitHubConnection()
  // Revalida os bancos quando a conexão do Notion muda (conectou, desconectou, reconectou).
  const workspace = useNotionWorkspace(connectionKey(notion.status))
  const claude = useClaudeStatus()
  const precheck = usePrecheck(projectId)

  const notionReady = notion.status?.state === 'connected'
  const workspaceReady =
    notionReady && workspace.status?.config != null && workspace.status.health === 'ok'
  const githubReady = github.status?.state === 'connected'
  const claudeReady = claudeStatus(claude).tone === 'success'

  // Abertas: as que você abriu; sem escolha, as que ainda não estão prontas.
  const [open, setOpen] = useState<Record<string, boolean>>({})
  // Uma linha que estava pendente e ficou pronta nesta visita continua aberta (a confirmação de
  // "conectado" não some na hora). Padrão do React para reagir a uma mudança durante o render.
  const pendingNow: Record<string, boolean> = {
    notion: notion.status !== null && !notionReady,
    github: github.status !== null && !githubReady,
    claude: claude !== null && !claudeReady,
    'notion-workspace': notionReady && workspace.status !== null && !workspaceReady
  }
  const readyNow: Record<string, boolean> = {
    notion: notionReady,
    github: githubReady,
    claude: claudeReady,
    'notion-workspace': workspaceReady
  }
  const [wasPending, setWasPending] = useState<Record<string, boolean>>({})
  const newlyPending = Object.keys(pendingNow).filter((k) => pendingNow[k] && !wasPending[k])
  if (newlyPending.length > 0) {
    setWasPending((w) => ({ ...w, ...Object.fromEntries(newlyPending.map((k) => [k, true])) }))
  }
  const justReady = Object.keys(readyNow).filter(
    (k) => readyNow[k] && wasPending[k] && open[k] === undefined
  )
  if (justReady.length > 0) {
    setOpen((o) => ({ ...o, ...Object.fromEntries(justReady.map((k) => [k, true])) }))
  }
  const isOpen = (id: string, ready: boolean): boolean => open[id] ?? !ready
  const toggle = (id: string, ready: boolean): void =>
    setOpen((o) => ({ ...o, [id]: !(o[id] ?? !ready) }))

  const gh = precheck?.items.find((i) => i.id === 'gh') ?? null
  const ghStatus: { label: string; tone: StatusTone } = !gh
    ? { label: projectId ? 'Verificando' : 'Escolha um projeto', tone: 'neutral' }
    : gh.state === 'ok'
      ? { label: 'Pronto', tone: 'success' }
      : { label: gh.detail, tone: 'warning' }

  return (
    <div className={cn('flex flex-col gap-[18px]', PAGE_WIDTH.list)}>
      <PageHeader
        title="Integrações"
        subtitle="Contas que o Orkio usa. Os tokens ficam cifrados neste computador e nunca saem dele."
      />

      <div className="overflow-hidden rounded-xl border border-border-soft bg-card">
        <IntegrationListHeader />
        <ul
          aria-label="Catálogo de integrações"
          className="flex flex-col divide-y divide-border-soft"
        >
          <IntegrationRow
            id="notion"
            logo={NotionLogo}
            logoClassName="bg-foreground text-background"
            name="Notion"
            purpose="Lê suas tarefas e move o status quando você move o card."
            status={connectionStatus(notion.status)}
            action={notionReady ? 'Gerenciar' : 'Conectar'}
            isOpen={isOpen('notion', notionReady)}
            onToggle={() => toggle('notion', notionReady)}
            sub={
              <IntegrationRow
                id="notion-workspace"
                logo={null}
                name="Bancos e campos"
                purpose={workspaceSummary(workspace.status)}
                status={workspaceStatus(workspace.status, notion.status)}
                action={workspaceReady ? 'Revisar campos' : 'Configurar'}
                isOpen={isOpen('notion-workspace', workspaceReady || !notionReady)}
                onToggle={() => toggle('notion-workspace', workspaceReady || !notionReady)}
              >
                <NotionWorkspaceCard
                  workspace={workspace}
                  notionStatus={notion.status}
                  {...(notion.authOptions?.oauth ? { onReconnect: notion.startOAuth } : {})}
                />
              </IntegrationRow>
            }
          >
            <NotionConnectionCard notion={notion} />
          </IntegrationRow>
          <IntegrationRow
            id="github"
            logo={GitHubLogo}
            logoClassName="border border-border bg-surface text-foreground"
            name="GitHub"
            purpose="Branches, PRs, revisões e CI das tarefas; pedir review."
            status={connectionStatus(github.status)}
            action={githubReady ? 'Gerenciar' : 'Conectar'}
            isOpen={isOpen('github', githubReady)}
            onToggle={() => toggle('github', githubReady)}
          >
            <GitHubConnectionCard github={github} />
          </IntegrationRow>
          <IntegrationRow
            id="claude"
            logo={ClaudeLogo}
            logoClassName="bg-brand text-primary-foreground"
            name="Claude Code"
            purpose="Roda as tarefas com o seu login do claude. O Orkio não guarda chave."
            status={claudeStatus(claude)}
            action={claudeReady ? 'Gerenciar' : 'Configurar'}
            isOpen={isOpen('claude', claudeReady)}
            onToggle={() => toggle('claude', claudeReady)}
            sub={
              <IntegrationRow
                id="plugins"
                logo={null}
                name="Plugins e comandos"
                purpose={
                  precheck?.pluginVersion
                    ? `alva-flow ${precheck.pluginVersion}`
                    : 'alva-flow não encontrado (opcional)'
                }
                status={
                  precheck?.pluginVersion
                    ? { label: 'Encontrado', tone: 'success' }
                    : { label: precheck ? 'Opcional' : 'Verificando', tone: 'neutral' }
                }
                action="Ver no Claude Code"
                isOpen={false}
                onToggle={() => toggle('claude', false)}
              />
            }
          >
            <ClaudeCodeCard />
          </IntegrationRow>
          <IntegrationRow
            id="gh"
            logo={TerminalIcon}
            logoClassName="bg-muted text-muted-foreground"
            name="GitHub CLI (opcional)"
            purpose="Usado pelo /alva-flow:pr para abrir a PR."
            status={ghStatus}
            action="Como resolver"
            isOpen={open['gh'] ?? false}
            onToggle={() => toggle('gh', true)}
          >
            {gh?.fix ? (
              <p className="text-xs text-muted-foreground">
                Rode no terminal:{' '}
                <code className="font-mono text-xs text-foreground">{gh.fix}</code>
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">Nada a fazer: o gh está pronto.</p>
            )}
          </IntegrationRow>
        </ul>
      </div>
      <p className="border-l-2 border-brand px-3 py-1 text-[12.5px] text-muted-foreground">
        Faltando algo? Cada linha diz o que fazer. As mesmas checagens aparecem nos “Primeiros
        passos” e no item do projeto.
      </p>
    </div>
  )
}

function workspaceSummary(s: NotionWorkspaceStatus | null): string {
  const c = s?.config
  if (!c) return 'Quais bancos são Projetos e Tarefas, e quais campos o Orkio lê.'
  const fields = Object.values(c.mapping).filter(Boolean).length
  return `Projetos → ${c.projectsDataSource.name} · Tarefas → ${c.tasksDataSource.name} · ${fields} de 6 campos ligados`
}

/** Pré-checagem do alva-flow do projeto atual (gh, plugin); só leitura. */
function usePrecheck(projectId: string | null): AlvaPrecheck | null {
  const [state, setState] = useState<{ projectId: string; value: AlvaPrecheck } | null>(null)
  useEffect(() => {
    if (!projectId) return
    let alive = true
    void window.orkio.alva
      .precheck(projectId)
      .then((r) => {
        if (alive && r.ok) setState({ projectId, value: r.value })
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [projectId])
  return state && state.projectId === projectId ? state.value : null
}

function connectionStatus(s: ConnectionStatus | null): { label: string; tone: StatusTone } {
  if (!s) return { label: 'Verificando', tone: 'neutral' }
  switch (s.state) {
    case 'connected':
      return s.warning
        ? { label: 'Conectado, sem verificação', tone: 'warning' }
        : { label: `Conectado como ${s.account.handle ?? s.account.userName}`, tone: 'success' }
    case 'connecting':
      return { label: 'Conectando', tone: 'neutral' }
    case 'error':
      return { label: 'Precisa reconectar', tone: 'danger' }
    default:
      return { label: 'Não conectado', tone: 'warning' }
  }
}

function workspaceStatus(
  s: NotionWorkspaceStatus | null,
  notion: ConnectionStatus | null
): { label: string; tone: StatusTone } {
  if (notion?.state !== 'connected') return { label: 'Conecte o Notion antes', tone: 'neutral' }
  if (!s) return { label: 'Verificando', tone: 'neutral' }
  if (!s.config) return { label: 'Falta escolher os bancos', tone: 'warning' }
  switch (s.health) {
    case 'ok':
      return { label: 'Pronto', tone: 'success' }
    case 'broken':
      return { label: 'Tarefas bloqueadas', tone: 'danger' }
    case 'warning':
      return { label: 'Revisar mapeamento', tone: 'warning' }
    case 'unverified':
      return { label: 'Sem verificação', tone: 'warning' }
    default:
      return { label: 'Verificando', tone: 'neutral' }
  }
}

function claudeStatus(s: ClaudeCodeStatus | null): { label: string; tone: StatusTone } {
  if (!s) return { label: 'Verificando', tone: 'neutral' }
  if (!s.installed) return { label: 'Não encontrado', tone: 'warning' }
  if (!s.meetsMinimum) return { label: `Atualize para ${s.minimumVersion}`, tone: 'warning' }
  if (s.loggedIn === false) return { label: 'Sem login', tone: 'warning' }
  return { label: s.version ? `Pronto, ${s.version}` : 'Pronto', tone: 'success' }
}

/** Estado do Claude Code (o card de configuração lê o mesmo, com "Verificar de novo"). */
function useClaudeStatus(): ClaudeCodeStatus | null {
  const [status, setStatus] = useState<ClaudeCodeStatus | null>(null)
  useEffect(() => {
    let alive = true
    void window.orkio.claude
      .status()
      .then((s) => alive && setStatus(s))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])
  return status
}


function connectionKey(status: ConnectionStatus | null): string | null {
  if (status === null || status.state === 'connecting') return null
  return status.state === 'connected' ? `connected:${status.connectedAt}` : status.state
}
