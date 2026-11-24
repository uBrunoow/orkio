import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/Spinner'
import { StatusToken } from '../../components/StatusToken'
import { type ClaudeCodeStatus, CLAUDE_CODE_DOCS_URL } from '../../../../shared/agent-run'
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
    <section
      aria-labelledby="claude-card-title"
      aria-busy={checking}
      className="flex flex-col gap-4 rounded-xl border border-border-soft bg-card p-5"
    >
      <CardHeader
        titleId="claude-card-title"
        title="Claude Code"
        description="Executa as tarefas no seu computador, com a sua conta."
        icon={
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border-soft bg-surface text-foreground">
            <ClaudeLogo className="size-5" />
          </span>
        }
        badge={
          status === null ? null : (
            <StatusToken
              tone={ready ? 'success' : 'warning'}
              label={ready ? 'Pronto' : status.installed ? 'Ação necessária' : 'Não encontrado'}
            />
          )
        }
      />
      <div className="flex flex-col gap-3" aria-live="polite">
        {status === null ? (
          <Skeleton className="h-10" aria-label="Verificando o Claude Code" />
        ) : !status.installed ? (
          <Alert tone="warning">
            Claude Code não encontrado. Instale o CLI e faça login no terminal com{' '}
            <code className="font-mono text-xs">claude</code>.
          </Alert>
        ) : (
          <div className="flex flex-col gap-2.5">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>Versão</span>
              <code data-testid="claude-version" className="font-mono text-xs text-foreground">
                {status.version ?? 'desconhecida'}
              </code>
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
            </div>
            {!status.meetsMinimum && (
              <Alert tone="warning">
                Versão antiga: atualize para {status.minimumVersion} ou mais nova (
                <code className="font-mono text-xs">claude update</code>).
              </Alert>
            )}
            {status.loggedIn === false && (
              <Alert tone="warning">
                Rode <code className="font-mono text-xs">claude</code> no terminal e faça login com
                a sua conta.
              </Alert>
            )}
            <p className="text-xs text-muted-foreground">
              O Orkio não pede nem guarda chaves da Anthropic: usa o login do CLI.
            </p>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={checking} onClick={() => void check(true)}>
            {checking ? <Spinner /> : <RefreshIcon />}
            Verificar de novo
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void window.orkio.openExternal(CLAUDE_CODE_DOCS_URL)}
          >
            <ExternalLinkIcon />
            Como instalar
          </Button>
        </div>
      </div>
    </section>
  )
}
