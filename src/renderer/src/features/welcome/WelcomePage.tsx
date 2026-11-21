import { useEffect, useState } from 'react'
import { Button } from '@astryxdesign/core/Button'
import { Card } from '@astryxdesign/core/Card'
import { Grid } from '@astryxdesign/core/Grid'
import { HStack } from '@astryxdesign/core/HStack'
import { Heading } from '@astryxdesign/core/Heading'
import { Icon } from '@astryxdesign/core/Icon'
import { Item } from '@astryxdesign/core/Item'
import { List } from '@astryxdesign/core/List'
import { StackItem } from '@astryxdesign/core/Stack'
import { Text } from '@astryxdesign/core/Text'
import { VStack } from '@astryxdesign/core/VStack'
import type { ConnectionStatus } from '../../../../shared/ipc-contract'
import type { ClaudeCodeStatus } from '../../../../shared/agent-run'
import { OrkioLogo } from '../../components/OrkioLogo/OrkioLogo'
import { StatusToken, type StatusTone } from '../../components/StatusToken'
import {
  ClaudeLogo,
  GitHubLogo,
  NotionLogo,
  ProjectsIcon,
  type SvgIcon
} from '../../components/icons'
import './welcome.css'

interface Step {
  icon: SvgIcon
  name: string
  text: string
  status: { label: string; tone: StatusTone }
  action: { label: string; onClick(): void } | null
}

/** Estado das três ferramentas, lido uma vez ao abrir (as mesmas chamadas de Integrações). */
function useSetupStatus(): {
  notion: ConnectionStatus | null
  github: ConnectionStatus | null
  claude: ClaudeCodeStatus | null
} {
  const [notion, setNotion] = useState<ConnectionStatus | null>(null)
  const [github, setGithub] = useState<ConnectionStatus | null>(null)
  const [claude, setClaude] = useState<ClaudeCodeStatus | null>(null)
  useEffect(() => {
    let alive = true
    void window.orkio.notion
      .getStatus()
      .then((s) => alive && setNotion(s))
      .catch(() => undefined)
    void window.orkio.github
      .getStatus()
      .then((s) => alive && setGithub(s))
      .catch(() => undefined)
    void window.orkio.claude
      .status()
      .then((s) => alive && setClaude(s))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])
  return { notion, github, claude }
}

function connectionStep(s: ConnectionStatus | null): Step['status'] {
  if (!s) return { label: 'Verificando', tone: 'neutral' }
  switch (s.state) {
    case 'connected':
      return { label: 'Conectado', tone: 'success' }
    case 'connecting':
      return { label: 'Conectando', tone: 'neutral' }
    case 'error':
      return { label: 'Precisa reconectar', tone: 'danger' }
    default:
      return { label: 'Não conectado', tone: 'warning' }
  }
}

function claudeStep(s: ClaudeCodeStatus | null): Step['status'] {
  if (!s) return { label: 'Verificando', tone: 'neutral' }
  if (!s.installed) return { label: 'Não encontrado', tone: 'warning' }
  if (!s.meetsMinimum) return { label: `Atualize para ${s.minimumVersion}`, tone: 'warning' }
  if (s.loggedIn === false) return { label: 'Sem login', tone: 'warning' }
  return { label: s.version ? `Pronto, ${s.version}` : 'Pronto', tone: 'success' }
}

/**
 * Abertura do app: tela laranja com o símbolo se desenhando, o laranja se fecha em círculo e
 * revela a tela "Vamos começar" (sem sidebar): título, "Começar" e o checklist com o estado
 * real de Notion, GitHub, Claude Code e projeto. Animações só em CSS (welcome.css); `prefers-reduced-motion` pula tudo.
 */
export function WelcomePage({
  onStart,
  onOpenIntegrations
}: {
  onStart(): void
  onOpenIntegrations(): void
}): React.JSX.Element {
  // A abertura sai do DOM quando a animação de fechar termina.
  const [splash, setSplash] = useState(true)
  const setup = useSetupStatus()

  const steps: Step[] = [
    {
      icon: NotionLogo,
      name: 'Notion',
      text: 'Onde ficam os projetos e as tarefas.',
      status: connectionStep(setup.notion),
      action:
        setup.notion?.state === 'connected'
          ? null
          : { label: 'Conectar o Notion', onClick: onOpenIntegrations }
    },
    {
      icon: GitHubLogo,
      name: 'GitHub',
      text: 'Repositórios, branches e PRs de cada tarefa.',
      status: connectionStep(setup.github),
      action:
        setup.github?.state === 'connected'
          ? null
          : { label: 'Conectar o GitHub', onClick: onOpenIntegrations }
    },
    {
      icon: ClaudeLogo,
      name: 'Claude Code',
      text: 'Roda as tarefas no seu computador, com o seu login.',
      status: claudeStep(setup.claude),
      action:
        claudeStep(setup.claude).tone === 'success'
          ? null
          : { label: 'Ver o Claude Code', onClick: onOpenIntegrations }
    },
    {
      icon: ProjectsIcon,
      name: 'Projeto',
      text: 'A pasta do repositório que o Orkio vai acompanhar.',
      status: { label: 'Falta adicionar', tone: 'warning' },
      action: { label: 'Adicionar projeto', onClick: onStart }
    }
  ]
  const done = steps.filter((s) => s.status.tone === 'success').length

  return (
    <VStack className="orkio-intro" role="main" aria-labelledby="welcome-title">
      <VStack className="orkio-intro__stage" gap={6}>
        <HStack className="orkio-intro__reveal orkio-intro__d1">
          <OrkioLogo variant="simple" withWordmark size={24} />
        </HStack>

        <StackItem size="fill">
          <VStack height="100%" vAlign="center">
            <Grid columns={{ minWidth: 360, max: 2 }} gap={10} align="center">
              <VStack gap={4} hAlign="start">
                <Text className="orkio-slogan orkio-intro__reveal orkio-intro__d2">
                  Do contexto ao commit
                </Text>
                <Text
                  as="h1"
                  id="welcome-title"
                  className="orkio-display orkio-intro__title orkio-intro__reveal orkio-intro__d3"
                >
                  Vamos começar
                </Text>
                <Text color="secondary" className="orkio-intro__reveal orkio-intro__d4">
                  O Orkio liga o quadro do Notion, o código no GitHub e o Claude Code, e leva cada
                  tarefa até a branch.
                </Text>
                <HStack className="orkio-intro__reveal orkio-intro__d5">
                  <Button variant="primary" size="lg" label="Começar" onClick={onStart} />
                </HStack>
              </VStack>

              <Card padding={0} className="orkio-intro__reveal orkio-intro__d6">
                <VStack gap={0}>
                  <HStack gap={2} vAlign="center" padding={4} paddingBlockEnd={2}>
                    <Heading level={2}>Preparar o Orkio</Heading>
                    <StackItem size="fill" />
                    <Text
                      type="supporting"
                      color="secondary"
                      hasTabularNumbers
                      data-testid="setup-progress"
                    >
                      {done} de {steps.length} prontos
                    </Text>
                  </HStack>
                  <List hasDividers aria-label="Preparar o Orkio">
                    {steps.map((step) => (
                      <Item
                        key={step.name}
                        as="li"
                        startContent={<Icon icon={step.icon} />}
                        label={step.name}
                        description={
                          <VStack gap={1}>
                            <Text type="supporting" color="secondary">
                              {step.text}
                            </Text>
                            <StatusToken label={step.status.label} tone={step.status.tone} />
                          </VStack>
                        }
                        {...(step.action
                          ? {
                              endContent: (
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  label={step.action.label}
                                  onClick={step.action.onClick}
                                />
                              )
                            }
                          : {})}
                      />
                    ))}
                  </List>
                </VStack>
              </Card>
            </Grid>
          </VStack>
        </StackItem>
      </VStack>

      {splash && (
        <VStack
          className="orkio-intro__splash"
          hAlign="center"
          vAlign="center"
          aria-hidden="true"
          onAnimationEnd={(e: React.AnimationEvent) => {
            if (e.target === e.currentTarget) setSplash(false)
          }}
        >
          <OrkioLogo variant="full" size={160} label="" className="orkio-intro__splash-logo" />
          <Text className="orkio-intro__splash-word">ORKIO</Text>
        </VStack>
      )}
    </VStack>
  )
}
