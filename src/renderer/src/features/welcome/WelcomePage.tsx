import { Avatar } from '@astryxdesign/core/Avatar'
import { Button } from '@astryxdesign/core/Button'
import { Card } from '@astryxdesign/core/Card'
import { Grid } from '@astryxdesign/core/Grid'
import { HStack } from '@astryxdesign/core/HStack'
import { Icon } from '@astryxdesign/core/Icon'
import { Text } from '@astryxdesign/core/Text'
import { VStack } from '@astryxdesign/core/VStack'
import appIcon from '../../../../../brand/orkio-app-icon-1024.png'
import { ClaudeLogo, GitHubLogo, NotionLogo, type SvgIcon } from '../../components/icons'

const TOOLS: { icon: SvgIcon; name: string; text: string }[] = [
  { icon: NotionLogo, name: 'Notion', text: 'Planejamento: projetos e tarefas.' },
  { icon: GitHubLogo, name: 'GitHub', text: 'Código: repositórios, branches e PRs.' },
  { icon: ClaudeLogo, name: 'Claude Code', text: 'Execução: roda a tarefa por você.' }
]

/**
 * Tela inicial ("Vamos começar"). Depois vai ganhar o login com GitHub/Notion; por enquanto só
 * leva o usuário para a área de trabalho.
 */
export function WelcomePage({
  onStart,
  onOpenIntegrations
}: {
  onStart(): void
  onOpenIntegrations(): void
}): React.JSX.Element {
  return (
    <VStack gap={8} maxWidth={880} hAlign="center" role="region" aria-labelledby="welcome-title">
      <VStack gap={4} hAlign="center">
        <Avatar src={appIcon} alt="Ícone do Orkio" shape="rounded" size={144} />
        <Text type="supporting" className="orkio-slogan">
          Do contexto ao commit
        </Text>
        <Text as="h1" id="welcome-title" type="display-3" className="orkio-display">
          Vamos começar
        </Text>
        <Text color="secondary">
          O Orkio liga o planejamento no Notion, o código no GitHub e a execução no Claude Code.
        </Text>
        <HStack gap={2} wrap="wrap" hAlign="center">
          <Button variant="primary" label="Começar" onClick={onStart} />
          <Button variant="secondary" label="Conectar ferramentas" onClick={onOpenIntegrations} />
        </HStack>
      </VStack>
      <Grid columns={{ minWidth: 220, repeat: 'fit' }} gap={4} align="start">
        {TOOLS.map((t) => (
          <Card key={t.name} variant="transparent">
            <VStack gap={2}>
              <Icon icon={t.icon} color="primary" size="lg" />
              <Text weight="semibold">{t.name}</Text>
              <Text type="supporting">{t.text}</Text>
            </VStack>
          </Card>
        ))}
      </Grid>
    </VStack>
  )
}
