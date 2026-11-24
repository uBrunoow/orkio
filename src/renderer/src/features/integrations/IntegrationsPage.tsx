import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import type { ClaudeCodeStatus } from '../../../../shared/agent-run'
import type { AlvaPrecheck } from '../../../../shared/alva'
import type { StatusTone } from '../../components/StatusToken'
import {
  AgentsIcon,
  ClaudeLogo,
  DatabaseIcon,
  GitHubLogo,
  NotionLogo,
  PluginIcon,
  TerminalIcon,
  type SvgIcon
} from '../../components/icons'
import { TextField } from '../../components/form'
import { isTextField } from '../../app/shortcuts'
import { PageHeader } from '../../components/PageHeader'
import { ClaudeCodeCard } from '../claude/ClaudeCodeCard'
import { NotionWorkspaceCard } from '../notion-workspace/NotionWorkspaceCard'
import { useNotionWorkspace } from '../notion-workspace/useNotionWorkspace'
import { GitHubConnectionCard } from './GitHubConnectionCard'
import { NotionConnectionCard } from './NotionConnectionCard'
import { useGitHubConnection } from './useGitHubConnection'
import { useNotionConnection } from './useNotionConnection'
import { IntegrationCard } from './IntegrationCard'
import {
  effectiveOpenId,
  firstPendingId,
  matchesQuery,
  orkioBotSummary
} from './integrations-logic'
import { OrkioBotPanel, useOrkioBot } from './OrkioBotCard'
import { PAGE_WIDTH } from '../../components/page-width'
import type { ConnectionStatus } from '../../../../shared/connection'
import type { NotionWorkspaceStatus } from '../../../../shared/notion'

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
  // Consulta o orkio[bot] quando o estado do GitHub já é conhecido (e de novo se ele mudar).
  const bot = useOrkioBot(github.status !== null && github.status.state !== 'connecting')
  const botStatus = orkioBotSummary(bot.status)
  const claudeReady = claudeStatus(claude).tone === 'success'

  const gh = precheck?.items.find((i) => i.id === 'gh') ?? null
  const ghStatus: { label: string; tone: StatusTone } = !gh
    ? { label: projectId ? 'Verificando' : 'Escolha um projeto', tone: 'neutral' }
    : gh.state === 'ok'
      ? { label: 'Pronto', tone: 'success' }
      : { label: gh.detail, tone: 'warning' }
  const pluginsStatus: { label: string; tone: StatusTone } = precheck?.pluginVersion
    ? { label: `alva-flow ${precheck.pluginVersion}`, tone: 'success' }
    : { label: precheck ? 'alva-flow não instalado' : 'Verificando', tone: 'neutral' }

  // Um painel aberto por vez. Sem escolha sua (`undefined`), abre o primeiro card pendente na
  // ordem da página, reavaliado conforme os estados chegam; ao abrir/fechar você, ele para de
  // escolher. `lastAuto` guarda o último aberto sozinho (continua aberto quando fica pronto).
  const [chosen, setChosen] = useState<string | null | undefined>(undefined)
  const [lastAuto, setLastAuto] = useState<string | null>(null)
  const firstPending = firstPendingId([
    { id: 'notion', pending: notion.status !== null && !notionReady },
    {
      id: 'notion-workspace',
      pending: notionReady && workspace.status !== null && !workspaceReady
    },
    { id: 'github', pending: github.status !== null && !githubReady },
    { id: 'claude', pending: claude !== null && !claudeReady }
  ])
  if (chosen === undefined && firstPending && firstPending !== lastAuto) {
    setLastAuto(firstPending)
  }
  const openId = effectiveOpenId(chosen, firstPending, lastAuto)
  const toggle = (id: string): void => setChosen(openId === id ? null : id)

  const cards: CardSpec[] = [
    {
      id: 'notion',
      section: 'Tarefas',
      logo: NotionLogo,
      logoClassName: 'bg-foreground text-background',
      name: 'Notion',
      category: 'tarefas',
      status: connectionStatus(notion.status),
      action: notionReady ? 'Gerenciar' : 'Conectar',
      ready: notionReady,
      panel: <NotionConnectionCard notion={notion} />
    },
    {
      id: 'notion-workspace',
      section: 'Tarefas',
      logo: DatabaseIcon,
      logoClassName: 'bg-muted text-muted-foreground',
      name: 'Bancos e campos',
      category: 'notion',
      status: workspaceStatus(workspace.status, notion.status),
      action: workspaceReady ? 'Revisar campos' : 'Configurar',
      ready: workspaceReady,
      panel: (
        <NotionWorkspaceCard
          workspace={workspace}
          notionStatus={notion.status}
          {...(notion.authOptions?.oauth ? { onReconnect: notion.startOAuth } : {})}
        />
      )
    },
    {
      id: 'github',
      section: 'Código',
      logo: GitHubLogo,
      logoClassName: 'border border-border bg-surface text-foreground',
      name: 'GitHub',
      category: 'código',
      status: connectionStatus(github.status),
      action: githubReady ? 'Gerenciar' : 'Conectar',
      ready: githubReady,
      panel: <GitHubConnectionCard github={github} />
    },
    {
      id: 'orkio-bot',
      section: 'Código',
      logo: AgentsIcon,
      logoClassName: 'bg-brand text-primary-foreground',
      name: 'Orkio bot',
      category: 'github app · revisões',
      status: botStatus,
      action: botStatus.tone === 'warning' ? 'Instalar' : 'Ver repositórios',
      ready: botStatus.tone === 'success',
      panel: <OrkioBotPanel bot={bot} />
    },
    {
      id: 'gh',
      section: 'Código',
      logo: TerminalIcon,
      logoClassName: 'bg-muted text-muted-foreground',
      name: 'GitHub CLI',
      category: 'terminal · opcional',
      status: ghStatus,
      action: 'Como resolver',
      ready: ghStatus.tone === 'success',
      panel: (
        <p className="rounded-xl border border-border-soft bg-card p-4 text-xs text-muted-foreground">
          {gh?.fix ? (
            <>
              Rode no terminal: <code className="font-mono text-xs text-foreground">{gh.fix}</code>
            </>
          ) : (
            'Nada a fazer: o gh está pronto.'
          )}
        </p>
      )
    },
    {
      id: 'claude',
      section: 'Agentes de código',
      logo: ClaudeLogo,
      logoClassName: 'bg-brand text-primary-foreground',
      name: 'Claude Code',
      category: 'agente',
      status: claudeStatus(claude),
      action: claudeReady ? 'Gerenciar' : 'Configurar',
      ready: claudeReady,
      panel: <ClaudeCodeCard />
    },
    {
      id: 'plugins',
      section: 'Agentes de código',
      logo: PluginIcon,
      logoClassName: 'bg-muted text-muted-foreground',
      name: 'Plugins e comandos',
      category: 'claude code',
      status: pluginsStatus,
      action: 'Ver no Claude Code',
      ready: pluginsStatus.tone === 'success',
      // Sem painel próprio: abre a configuração do Claude Code.
      opensId: 'claude'
    }
  ]

  const [query, setQuery] = useState('')
  const searchBox = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || isTextField(e.target)) return
      e.preventDefault()
      searchBox.current?.querySelector('input')?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const visible = cards.filter((c) => matchesQuery(c, query))
  const readyCount = cards.filter((c) => c.ready).length

  return (
    <div className={cn('flex flex-col gap-[18px]', PAGE_WIDTH.list)}>
      <PageHeader
        title="Integrações"
        subtitle="Contas que o Orkio usa. Os tokens ficam cifrados neste computador e nunca saem dele."
      />

      <div ref={searchBox} className="flex flex-wrap items-center gap-3">
        <TextField
          label="Buscar integração"
          labelHidden
          type="search"
          placeholder="Buscar integração (/)"
          value={query}
          onChange={setQuery}
          inputClassName="w-72"
        />
        <span className="text-xs text-muted-foreground" data-testid="integrations-count">
          {readyCount} de {cards.length} prontas
        </span>
      </div>

      {SECTIONS.map((section) => {
        const inSection = visible.filter((c) => c.section === section)
        if (inSection.length === 0) return null
        return (
          <section key={section} aria-label={section} className="flex flex-col gap-2">
            <h2 className="text-2xs tracking-[0.06em] text-subtle-foreground uppercase">
              {section}
            </h2>
            <div className="grid grid-cols-1 gap-2 min-[900px]:grid-cols-2">
              {inSection.map((c) => {
                const target = c.opensId ?? c.id
                return (
                  <IntegrationCard
                    key={c.id}
                    id={c.id}
                    logo={c.logo}
                    {...(c.logoClassName ? { logoClassName: c.logoClassName } : {})}
                    name={c.name}
                    category={c.category}
                    status={c.status}
                    action={c.action}
                    open={!c.opensId && openId === c.id}
                    onAction={() => {
                      if (!c.opensId) return toggle(target)
                      // Sem painel próprio: sempre ABRE o do outro card (e o mostra na busca).
                      const targetCard = cards.find((x) => x.id === target)
                      if (targetCard && !matchesQuery(targetCard, query)) setQuery('')
                      setChosen(target)
                    }}
                  >
                    {c.panel}
                  </IntegrationCard>
                )
              })}
            </div>
          </section>
        )
      })}
      {visible.length === 0 && (
        <p className="text-xs text-muted-foreground">Nenhuma integração com esse nome.</p>
      )}
    </div>
  )
}

const SECTIONS = ['Tarefas', 'Código', 'Agentes de código'] as const

interface CardSpec {
  id: string
  section: (typeof SECTIONS)[number]
  logo: SvgIcon
  logoClassName?: string
  name: string
  category: string
  status: { label: string; tone: StatusTone }
  action: string
  ready: boolean
  panel?: React.ReactNode
  /** Card sem painel próprio: a ação abre o painel deste outro card. */
  opensId?: string
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
