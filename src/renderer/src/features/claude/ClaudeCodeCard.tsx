import { useCallback, useEffect, useState } from 'react'
import { Button } from '@astryxdesign/core/Button'
import { Card } from '@astryxdesign/core/Card'
import { Code } from '@astryxdesign/core/Code'
import { HStack } from '@astryxdesign/core/HStack'
import { Icon } from '@astryxdesign/core/Icon'
import { Skeleton } from '@astryxdesign/core/Skeleton'
import { Text } from '@astryxdesign/core/Text'
import { StatusToken } from '../../components/StatusToken'
import { VStack } from '@astryxdesign/core/VStack'
import type { ClaudeCodeStatus } from '../../../../shared/agent-run'
import { CLAUDE_CODE_DOCS_URL } from '../../../../shared/ipc-contract'
import { Alert } from '../../components/Alert'
import { ClaudeLogo, ExternalLinkIcon, RefreshIcon } from '../../components/icons'
import { CardHeader } from '../integrations/connection-ui'

/**
 * Card "Claude Code" em Integrações: o Orkio usa o CLI do usuário (com a assinatura/login dele).
 * Mostra só instalado, versão e se está logado; nunca e-mail, token ou chave.
 */
export function ClaudeCodeCard(): React.JSX.Element {
  const [status, setStatus] = useState<ClaudeCodeStatus | null>(null)
  const [checking, setChecking] = useState(false)

  const check = useCallback(async (force: boolean) => {
    setChecking(true)
    try {
      setStatus(await window.orkio.claude.status({ force }))
    } finally {
      setChecking(false)
    }
  }, [])

  useEffect(() => {
    let active = true
    void window.orkio.claude.status().then((s) => {
      if (active) setStatus(s)
    })
    return () => {
      active = false
    }
  }, [])

  const ready = status?.installed && status.loggedIn !== false && status.meetsMinimum

  return (
    <Card role="region" aria-labelledby="claude-card-title" aria-busy={checking}>
      <VStack gap={4}>
        <CardHeader
          titleId="claude-card-title"
          title="Claude Code"
          description="Executa as tarefas no seu computador, com a sua conta."
          icon={<Icon icon={ClaudeLogo} color="primary" size="lg" />}
          badge={
            status === null ? null : (
              <StatusToken
                tone={ready ? 'success' : 'warning'}
                label={ready ? 'Pronto' : status.installed ? 'Ação necessária' : 'Não encontrado'}
              />
            )
          }
        />
        <VStack gap={3} aria-live="polite">
          {status === null ? (
            <Skeleton height={40} aria-label="Verificando o Claude Code" />
          ) : !status.installed ? (
            <Alert tone="warning">
              Claude Code não encontrado. Instale o CLI e faça login no terminal com{' '}
              <Code>claude</Code>.
            </Alert>
          ) : (
            <VStack gap={2}>
              <HStack gap={2} vAlign="center" wrap="wrap">
                <Text type="supporting">Versão</Text>
                <Code data-testid="claude-version">{status.version ?? 'desconhecida'}</Code>
                <StatusToken
                  tone={
                    status.loggedIn === true
                      ? 'success'
                      : status.loggedIn === false
                        ? 'danger'
                        : 'neutral'
                  }
                  label={
                    status.loggedIn === true
                      ? status.authMethod === 'claude.ai'
                        ? 'Logado (assinatura)'
                        : 'Logado'
                      : status.loggedIn === false
                        ? 'Não logado'
                        : 'Login não verificado'
                  }
                />
              </HStack>
              {!status.meetsMinimum && (
                <Alert tone="warning">
                  Versão antiga: atualize para {status.minimumVersion} ou mais nova (
                  <Code>claude update</Code>).
                </Alert>
              )}
              {status.loggedIn === false && (
                <Alert tone="warning">
                  Rode <Code>claude</Code> no terminal e faça login com a sua conta.
                </Alert>
              )}
              <Text type="supporting">
                O Orkio não pede nem guarda chaves da Anthropic: usa o login do CLI.
              </Text>
            </VStack>
          )}
          <HStack gap={2} wrap="wrap">
            <Button
              size="sm"
              variant="secondary"
              label="Verificar de novo"
              icon={<Icon icon={RefreshIcon} />}
              isLoading={checking}
              onClick={() => void check(true)}
            />
            <Button
              size="sm"
              variant="ghost"
              label="Como instalar"
              icon={<Icon icon={ExternalLinkIcon} />}
              onClick={() => void window.orkio.openExternal(CLAUDE_CODE_DOCS_URL)}
            />
          </HStack>
        </VStack>
      </VStack>
    </Card>
  )
}
