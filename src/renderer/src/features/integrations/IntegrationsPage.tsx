import { Card } from '@astryxdesign/core/Card'
import { Grid } from '@astryxdesign/core/Grid'
import { HStack } from '@astryxdesign/core/HStack'
import { Text } from '@astryxdesign/core/Text'
import { VStack } from '@astryxdesign/core/VStack'
import type { ConnectionStatus } from '../../../../shared/ipc-contract'
import { OrkioLogo } from '../../components/OrkioLogo/OrkioLogo'
import { PageHeader } from '../../components/PageHeader'
import { ClaudeCodeCard } from '../claude/ClaudeCodeCard'
import { NotionWorkspaceCard } from '../notion-workspace/NotionWorkspaceCard'
import { useNotionWorkspace } from '../notion-workspace/useNotionWorkspace'
import { GitHubConnectionCard } from './GitHubConnectionCard'
import { NotionConnectionCard } from './NotionConnectionCard'
import { useGitHubConnection } from './useGitHubConnection'
import { useNotionConnection } from './useNotionConnection'

export function IntegrationsPage(): React.JSX.Element {
  const notion = useNotionConnection()
  const github = useGitHubConnection()
  // Revalida os bancos quando a conexão do Notion muda (conectou, desconectou, reconectou).
  const workspace = useNotionWorkspace(connectionKey(notion.status))
  const nothingConnected = [notion.status, github.status].every(isEmpty)

  return (
    <VStack gap={6} maxWidth={1080}>
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
          <HStack gap={6} vAlign="center">
            <OrkioLogo variant="full" size={88} />
            <VStack gap={2}>
              <Text type="supporting" className="orkio-slogan">
                Do contexto ao commit
              </Text>
              <Text as="h2" id="empty-hero-title" type="display-3" className="orkio-display">
                Conecte suas ferramentas
              </Text>
              <Text color="secondary">
                Notion para o planejamento, GitHub para o código. O Orkio liga os dois.
              </Text>
            </VStack>
          </HStack>
        </Card>
      )}

      <Grid columns={{ minWidth: 380, repeat: 'fit' }} gap={4} align="start">
        <NotionConnectionCard notion={notion} />
        <GitHubConnectionCard github={github} />
        <ClaudeCodeCard />
      </Grid>

      <NotionWorkspaceCard
        workspace={workspace}
        notionStatus={notion.status}
        {...(notion.authOptions?.oauth ? { onReconnect: notion.startOAuth } : {})}
      />
    </VStack>
  )
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
