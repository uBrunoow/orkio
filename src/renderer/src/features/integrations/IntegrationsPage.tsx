import { useEffect, useState } from 'react'
import { Button } from '@astryxdesign/core/Button'
import { Card } from '@astryxdesign/core/Card'
import { Grid } from '@astryxdesign/core/Grid'
import { HStack } from '@astryxdesign/core/HStack'
import { Heading } from '@astryxdesign/core/Heading'
import { Icon } from '@astryxdesign/core/Icon'
import { StackItem } from '@astryxdesign/core/Stack'
import { Text } from '@astryxdesign/core/Text'
import { VStack } from '@astryxdesign/core/VStack'
import type { ClaudeCodeStatus } from '../../../../shared/agent-run'
import type { ConnectionStatus, NotionWorkspaceStatus } from '../../../../shared/ipc-contract'
import { StatusToken, type StatusTone } from '../../components/StatusToken'
import {
  ClaudeLogo,
  DatabaseIcon,
  GitHubLogo,
  NotionLogo,
  type SvgIcon
} from '../../components/icons'
import { OrkioLogo } from '../../components/OrkioLogo/OrkioLogo'
import { PageHeader } from '../../components/PageHeader'
import { ClaudeCodeCard } from '../claude/ClaudeCodeCard'
import { NotionWorkspaceCard } from '../notion-workspace/NotionWorkspaceCard'
import { useNotionWorkspace } from '../notion-workspace/useNotionWorkspace'
import { GitHubConnectionCard } from './GitHubConnectionCard'
import { NotionConnectionCard } from './NotionConnectionCard'
import { useGitHubConnection } from './useGitHubConnection'
import { useNotionConnection } from './useNotionConnection'
import { PAGE_WIDTH } from '../../components/page-width'

export function IntegrationsPage(): React.JSX.Element {
  const notion = useNotionConnection()
  const github = useGitHubConnection()
  // Revalida os bancos quando a conexão do Notion muda (conectou, desconectou, reconectou).
  const workspace = useNotionWorkspace(connectionKey(notion.status))
  const nothingConnected = [notion.status, github.status].every(isEmpty)
  const claude = useClaudeStatus()

  const entries: CatalogEntry[] = [
    {
      id: 'notion',
      icon: NotionLogo,
      name: 'Notion',
      category: 'Planejamento',
      text: 'Projetos e tarefas do quadro.',
      status: connectionStatus(notion.status),
      ready: notion.status?.state === 'connected'
    },
    {
      id: 'notion-workspace',
      icon: DatabaseIcon,
      name: 'Bancos do Notion',
      category: 'Planejamento',
      text: 'Quais bancos são Projetos e Tarefas.',
      status: workspaceStatus(workspace.status, notion.status),
      ready:
        notion.status?.state === 'connected' &&
        workspace.status?.config != null &&
        workspace.status.health === 'ok'
    },
    {
      id: 'github',
      icon: GitHubLogo,
      name: 'GitHub',
      category: 'Código',
      text: 'Repositórios, branches e PRs.',
      status: connectionStatus(github.status),
      ready: github.status?.state === 'connected'
    },
    {
      id: 'claude',
      icon: ClaudeLogo,
      name: 'Claude Code',
      category: 'Execução',
      text: 'Roda as tarefas no seu computador.',
      status: claudeStatus(claude),
      ready: claudeStatus(claude).tone === 'success'
    }
  ]

  return (
    <VStack gap={6} maxWidth={PAGE_WIDTH.list}>
      <PageHeader
        title="Integrações"
        subtitle="Conecte as ferramentas que o Orkio usa para planejar e executar o desenvolvimento."
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

      <Grid
        columns={{ minWidth: 360, max: 2 }}
        gap={3}
        role="list"
        aria-label="Catálogo de integrações"
      >
        {entries.map((entry) => (
          <CatalogRow key={entry.id} entry={entry} />
        ))}
      </Grid>

      <VStack gap={4}>
        <Heading level={2}>Configuração</Heading>
        <VStack data-integration="notion">
          <NotionConnectionCard notion={notion} />
        </VStack>
        {/* Bancos do Notion logo depois da conexão: é o passo seguinte do Notion. */}
        <VStack data-integration="notion-workspace">
          <NotionWorkspaceCard
            workspace={workspace}
            notionStatus={notion.status}
            {...(notion.authOptions?.oauth ? { onReconnect: notion.startOAuth } : {})}
          />
        </VStack>
        <VStack data-integration="github">
          <GitHubConnectionCard github={github} />
        </VStack>
        <VStack data-integration="claude">
          <ClaudeCodeCard />
        </VStack>
      </VStack>
    </VStack>
  )
}

interface CatalogEntry {
  id: string
  icon: SvgIcon
  name: string
  category: string
  text: string
  status: { label: string; tone: StatusTone }
  /** Pronto: a ação vira "Gerenciar"; senão, "Conectar"/"Configurar". */
  ready: boolean
}

/**
 * Linha do catálogo (fase 7): logo, nome, categoria, estado e a ação, que leva ao card de
 * configuração logo abaixo (o fluxo de conexão continua lá).
 */
function CatalogRow({ entry }: { entry: CatalogEntry }): React.JSX.Element {
  const action = entry.ready
    ? 'Gerenciar'
    : entry.id === 'notion-workspace' || entry.id === 'claude'
      ? 'Configurar'
      : 'Conectar'
  const goTo = (): void => {
    const card = document.querySelector<HTMLElement>(`[data-integration="${entry.id}"]`)
    card?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    card?.querySelector<HTMLElement>('button, input, a[href]')?.focus({ preventScroll: true })
  }
  return (
    <Card padding={3} role="listitem" aria-label={entry.name} data-testid={`catalog-${entry.id}`}>
      <HStack gap={3} vAlign="center">
        <Icon icon={entry.icon} size="lg" />
        <StackItem size="fill">
          <VStack gap={0.5}>
            <HStack gap={2} vAlign="center">
              <Text weight="semibold">{entry.name}</Text>
              <Text type="supporting" color="secondary">
                {entry.category}
              </Text>
            </HStack>
            <Text type="supporting" color="secondary" maxLines={1}>
              {entry.text}
            </Text>
            <StatusToken label={entry.status.label} tone={entry.status.tone} />
          </VStack>
        </StackItem>
        <Button
          size="sm"
          variant="secondary"
          label={action}
          aria-label={`${action} ${entry.name}`}
          onClick={goTo}
        />
      </HStack>
    </Card>
  )
}

function connectionStatus(s: ConnectionStatus | null): CatalogEntry['status'] {
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
): CatalogEntry['status'] {
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

function claudeStatus(s: ClaudeCodeStatus | null): CatalogEntry['status'] {
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
