import { useState } from 'react'
import { Button } from '@astryxdesign/core/Button'
import { HStack } from '@astryxdesign/core/HStack'
import { Icon } from '@astryxdesign/core/Icon'
import { Text } from '@astryxdesign/core/Text'
import { VStack } from '@astryxdesign/core/VStack'
import { OrkioLogo } from '../../components/OrkioLogo/OrkioLogo'
import { ClaudeLogo, GitHubLogo, NotionLogo, type SvgIcon } from '../../components/icons'
import './welcome.css'

const TOOLS: { icon: SvgIcon; index: string; name: string; text: string }[] = [
  { icon: NotionLogo, index: '01', name: 'Notion', text: 'Planejamento: projetos e tarefas.' },
  { icon: GitHubLogo, index: '02', name: 'GitHub', text: 'Código: repositórios, branches e PRs.' },
  { icon: ClaudeLogo, index: '03', name: 'Claude Code', text: 'Execução: roda a tarefa por você.' }
]

/**
 * Abertura do app: tela laranja com o símbolo se desenhando, o laranja se fecha em círculo e
 * revela a tela "Vamos começar" (sem sidebar). Depois vai ganhar o login com
 * GitHub/Notion. Animações só em CSS (welcome.css); `prefers-reduced-motion` pula tudo.
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

  return (
    <VStack className="orkio-intro" role="main" aria-labelledby="welcome-title">
      <VStack className="orkio-intro__stage" vAlign="between" hAlign="stretch">
        <HStack gap={3} vAlign="center" className="orkio-intro__reveal orkio-intro__d1">
          <OrkioLogo variant="simple" withWordmark size={24} />
          <Text type="supporting" className="orkio-intro__mono">
            {'// desktop'}
          </Text>
        </HStack>

        <VStack gap={5} hAlign="start" maxWidth={760}>
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
            Planejamento no Notion, código no GitHub e execução no Claude Code. O Orkio liga tudo e
            leva cada tarefa do quadro até a branch.
          </Text>
          <HStack gap={2} wrap="wrap" className="orkio-intro__reveal orkio-intro__d5">
            <Button variant="primary" size="lg" label="Começar" onClick={onStart} />
            <Button
              variant="ghost"
              size="lg"
              label="Conectar ferramentas"
              onClick={onOpenIntegrations}
            />
          </HStack>
        </VStack>

        <HStack gap={8} wrap="wrap" vAlign="start" className="orkio-intro__reveal orkio-intro__d6">
          {TOOLS.map((t) => (
            <VStack key={t.name} gap={1} className="orkio-intro__tool">
              <HStack gap={2} vAlign="center">
                <Text type="supporting" className="orkio-intro__mono">
                  {t.index}
                </Text>
                <Icon icon={t.icon} size="sm" />
                <Text weight="semibold">{t.name}</Text>
              </HStack>
              <Text type="supporting">{t.text}</Text>
            </VStack>
          ))}
        </HStack>
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
