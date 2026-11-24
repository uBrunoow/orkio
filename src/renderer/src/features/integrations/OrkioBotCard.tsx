import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { ExternalLinkIcon, RefreshIcon } from '../../components/icons'
import { StatusDot, type StatusTone } from '../../components/StatusToken'
import type { OrkioBotRepoState, OrkioBotStatus } from '../../../../shared/orkio-bot'
import { formatTime } from '../../lib/format'
import { ipcCall } from '../../lib/ipc'

/**
 * orkio[bot]: o GitHub App que publica as revisões dos agentes nas PRs. Consulta (só leitura, pelo
 * main) se ele está instalado no repositório de cada projeto e oferece "Instalar no GitHub" antes de
 * a primeira revisão falhar. Consulta de novo quando a janela volta ao foco (a pessoa instalou no
 * navegador e voltou).
 */
export function useOrkioBot(enabled: boolean): {
  status: OrkioBotStatus | null
  checking: boolean
  refresh(): void
} {
  const [status, setStatus] = useState<OrkioBotStatus | null>(null)
  const [checking, setChecking] = useState(false)
  const fetchStatus = useCallback(
    (force: boolean) =>
      ipcCall(() => window.orkio.github.orkioBot({ force }), null).then((s) => {
        // Falha do IPC: fica o último estado.
        if (s) setStatus(s)
      }),
    []
  )
  useEffect(() => {
    if (!enabled) return
    void fetchStatus(false)
    const onFocus = (): void => void fetchStatus(true)
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [enabled, fetchStatus])
  const refresh = (): void => {
    setChecking(true)
    void fetchStatus(true).finally(() => setChecking(false))
  }
  return { status, checking, refresh }
}

const STATE_TEXT: Record<OrkioBotRepoState['state'], { label: string; tone: StatusTone }> = {
  installed: { label: 'Instalado', tone: 'success' },
  not_installed: { label: 'Não instalado', tone: 'warning' },
  no_access: { label: 'Sua conta do GitHub não vê este repositório', tone: 'danger' },
  unknown: { label: 'Não deu para conferir', tone: 'neutral' }
}

export function OrkioBotPanel({ bot }: { bot: ReturnType<typeof useOrkioBot> }): React.JSX.Element {
  const { status, checking, refresh } = bot
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border-soft bg-card p-4 text-xs">
      <p className="max-w-[70ch] text-muted-foreground">
        O orkio[bot] publica nas PRs as revisões feitas pelos agentes (fluxo “Alva: revisão
        publicada”), como “Pedir alterações” ou comentário. Instale o GitHub App do Orkio em cada
        repositório, ou na organização inteira. Ele só pode comentar e pedir alterações: nunca
        aprova nem faz merge.
      </p>
      {status?.github === 'disconnected' && (
        <p className="text-muted-foreground">Conecte o GitHub para conferir os repositórios.</p>
      )}
      {status?.github === 'connected' && status.repos.length === 0 && (
        <p className="text-muted-foreground">
          Nenhum projeto com repositório do github.com ainda. Adicione um em Projetos.
        </p>
      )}
      {status && status.repos.length > 0 && (
        <ul
          aria-label="Repositórios dos projetos"
          className="divide-y divide-border-soft rounded-lg border border-border-soft"
        >
          {status.repos.map((r) => {
            const text = STATE_TEXT[r.status.state]
            const installUrl = r.status.state === 'not_installed' ? r.status.installUrl : null
            return (
              <li key={`${r.owner}/${r.repo}`} className="flex flex-wrap items-center gap-3 p-3">
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="font-mono text-foreground">
                    {r.owner}/{r.repo}
                  </span>
                  <span className="truncate text-subtle-foreground">{r.projects.join(', ')}</span>
                </div>
                <span className="flex items-center gap-1.5" data-testid="orkio-bot-state">
                  <StatusDot tone={text.tone} />
                  <span className="text-foreground">
                    {r.status.state === 'unknown' ? r.status.message : text.label}
                  </span>
                </span>
                {installUrl && (
                  <Button size="sm" onClick={() => void window.orkio.openExternal(installUrl)}>
                    <ExternalLinkIcon />
                    Instalar no GitHub
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      )}
      <div className="flex items-center gap-3">
        <Button size="sm" variant="secondary" disabled={checking} onClick={refresh}>
          <RefreshIcon />
          {checking ? 'Conferindo…' : 'Verificar de novo'}
        </Button>
        {status?.checkedAt && !checking && (
          <span className="text-subtle-foreground">
            Conferido às {formatTime(status.checkedAt)}
          </span>
        )}
      </div>
    </div>
  )
}
