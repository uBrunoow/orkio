import { useRef, useState } from 'react'
import { cn } from '@/lib/utils'
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
import { useSlashFocus } from '../../lib/useSlashFocus'
import { PageHeader } from '../../components/PageHeader'
import { ClaudeCodeCard } from '../claude/ClaudeCodeCard'
import { NotionWorkspaceCard } from '../notion-workspace/NotionWorkspaceCard'
import { useNotionWorkspace } from '../notion-workspace/useNotionWorkspace'
import { GitHubConnectionCard } from './GitHubConnectionCard'
import { NotionConnectionCard } from './NotionConnectionCard'
import { useConnection } from './useConnection'
import { useClaudeStatus } from '../claude/useClaudeStatus'
import { useAlvaPrecheck } from '../alva/useAlvaPrecheck'
import { IntegrationCard } from './IntegrationCard'
import {
  effectiveOpenId,
  firstPendingId,
  matchesQuery,
  orkioBotSummary
} from './integrations-logic'
import { OrkioBotPanel, useOrkioBot } from './OrkioBotCard'
import { PAGE_WIDTH } from '../../components/page-width'
import {
  claudeStatusText,
  connectionStatusText,
  isClaudeReady,
  isWorkspaceReady,
  workspaceStatusText
} from '../../lib/status-text'

export function IntegrationsPage({
  projectId = null
}: {
  /** Projeto atual (para a checagem do GitHub CLI e do alva-flow). */
  projectId?: string | null
}): React.JSX.Element {
  const notion = useConnection('notion', { revalidate: true })
  const github = useConnection('github', { revalidate: true })
  const workspace = useNotionWorkspace(notion.key)
  const claude = useClaudeStatus().status
  const { precheck } = useAlvaPrecheck(projectId)

  const notionReady = notion.status?.state === 'connected'
  const workspaceReady = notionReady && isWorkspaceReady(workspace.status)
  const githubReady = github.status?.state === 'connected'
  const bot = useOrkioBot(github.status !== null && github.status.state !== 'connecting')
  const botStatus = orkioBotSummary(bot.status)
  const claudeReady = isClaudeReady(claude)

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
      status: connectionStatusText(notion.status),
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
      status: workspaceStatusText(workspace.status, notion.status),
      action: workspaceReady ? 'Revisar campos' : 'Configurar',
      ready: workspaceReady,
      panel: (
        <NotionWorkspaceCard
          workspace={workspace}
          notionStatus={notion.status}
          {...(notion.authOptions?.oauth ? { onReconnect: notion.authorize } : {})}
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
      status: connectionStatusText(github.status),
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
      status: claudeStatusText(claude),
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
      opensId: 'claude'
    }
  ]

  const [query, setQuery] = useState('')
  const searchBox = useRef<HTMLDivElement>(null)
  useSlashFocus(searchBox)
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
