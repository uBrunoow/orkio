import { useEffect, useState } from 'react'
import { Card } from '@astryxdesign/core/Card'
import { Code } from '@astryxdesign/core/Code'
import { HStack } from '@astryxdesign/core/HStack'
import { Text } from '@astryxdesign/core/Text'
import { VStack } from '@astryxdesign/core/VStack'
import type { ClaudeCodeStatus } from '../../../../shared/agent-run'
import type { AlvaPrecheck } from '../../../../shared/alva'
import type { ConnectionStatus, NotionWorkspaceStatus } from '../../../../shared/ipc-contract'
import type { StatusTone } from '../../components/StatusToken'
import { ClaudeLogo, GitHubLogo, NotionLogo, TerminalIcon } from '../../components/icons'
import { OrkioLogo } from '../../components/OrkioLogo/OrkioLogo'
import { PageHeader } from '../../components/PageHeader'
import { ClaudeCodeCard } from '../claude/ClaudeCodeCard'
import { NotionWorkspaceCard } from '../notion-workspace/NotionWorkspaceCard'
import { useNotionWorkspace } from '../notion-workspace/useNotionWorkspace'
import { GitHubConnectionCard } from './GitHubConnectionCard'
import { NotionConnectionCard } from './NotionConnectionCard'
import { useGitHubConnection } from './useGitHubConnection'
import { useNotionConnection } from './useNotionConnection'
import { IntegrationRow } from './IntegrationRow'
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
  const nothingConnected = [notion.status, github.status].every(isEmpty)
  const claude = useClaudeStatus()
  const precheck = usePrecheck(projectId)

  const notionReady = notion.status?.state === 'connected'
  const workspaceReady =
    notionReady && workspace.status?.config != null && workspace.status.health === 'ok'
  const githubReady = github.status?.state === 'connected'
  const claudeReady = claudeStatus(claude).tone === 'success'

  // Abertas: as que você abriu; sem escolha, as que ainda não estão prontas.
  const [open, setOpen] = useState<Record<string, boolean>>({})
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
    <VStack gap={6} maxWidth={PAGE_WIDTH.list}>
      <PageHeader
        title="Integrações"
        subtitle="Contas que o Orkio usa. Os tokens ficam cifrados neste computador e nunca saem dele."
      />

      {nothingConnected && (
        <Card
          variant="transparent"
          role="region"
          aria-labelledby="empty-hero-title"
          data-testid="empty-hero"
        >
          <HStack gap={5} vAlign="center">
            <OrkioLogo variant="full" size={64} />
            <VStack gap={1}>
              <Text type="supporting" className="orkio-slogan">
                Do contexto ao commit
              </Text>
              <Text as="h2" id="empty-hero-title" type="display-3" className="orkio-display">
                Conecte suas ferramentas
              </Text>
              <Text color="secondary">
                Notion para o planejamento, GitHub para o código e Claude Code para executar. O
                Orkio liga tudo.
              </Text>
            </VStack>
          </HStack>
        </Card>
      )}

      <Card padding={0}>
        <VStack role="list" aria-label="Catálogo de integrações">
          <IntegrationRow
            id="notion"
            logo={NotionLogo}
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
            name="GitHub CLI (opcional)"
            purpose="Usado pelo /alva-flow:pr para abrir a PR."
            status={ghStatus}
            action="Como resolver"
            isOpen={open['gh'] ?? false}
            onToggle={() => toggle('gh', true)}
          >
            {gh?.fix ? (
              <Text type="supporting">
                Rode no terminal: <Code>{gh.fix}</Code>
              </Text>
            ) : (
              <Text type="supporting">Nada a fazer: o gh está pronto.</Text>
            )}
          </IntegrationRow>
        </VStack>
      </Card>
    </VStack>
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

/**
 * Sem conexão nem credencial salva. Enquanto carrega (`null`), não conta como vazio,
 * para o destaque não "piscar".
 */
function isEmpty(status: ConnectionStatus | null): boolean {
  if (status === null || status.state === 'connected') return false
  return !(status.state === 'error' && status.hasStoredCredentials)
}

function connectionKey(status: ConnectionStatus | null): string | null {
  if (status === null || status.state === 'connecting') return null
  return status.state === 'connected' ? `connected:${status.connectedAt}` : status.state
}
