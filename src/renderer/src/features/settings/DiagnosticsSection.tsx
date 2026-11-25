import { useState } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { Spinner } from '@/components/Spinner'
import type { StorageUsage } from '../../../../shared/preferences'
import { Alert } from '../../components/Alert'
import { PageHeader } from '../../components/PageHeader'
import { PAGE_WIDTH } from '../../components/page-width'
import { SettingRow, SettingsGroup } from '../../components/SettingRows'
import { StatusBadge } from '../../components/StatusToken'
import { CopyIcon, RefreshIcon } from '../../components/icons'
import { formatTime, plural } from '../../lib/format'
import { ipcCall, ipcResult, unwrap, useIpcResource } from '../../lib/ipc'
import { claudeStatusText } from '../../lib/status-text'
import { useClaudeStatus } from '../claude/useClaudeStatus'
import { formatStorageBytes, storageRows } from './storage-text'

const DIAGNOSTICS_FAILURE = 'Não foi possível montar o diagnóstico agora.'

/**
 * Configurações › Diagnóstico (no jeito do Compozy): um resumo no topo (quanto o Orkio ocupa, em
 * barra, e se está tudo certo) e os grupos em linhas: Estado, Armazenamento e Suporte (copiar o
 * diagnóstico para pedir ajuda).
 */
export function DiagnosticsSection(): React.JSX.Element {
  const claude = useClaudeStatus()
  const storage = useIpcResource('', async () =>
    unwrap(await ipcResult(() => window.orkio.prefs.storage()))
  )
  const [text, setText] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [checkedAt, setCheckedAt] = useState<Date | null>(null)
  const [copied, setCopied] = useState(false)
  const claudeText = claudeStatusText(claude.status)

  const loadText = async (): Promise<string> => {
    const t = await ipcCall(() => window.orkio.updates.diagnostics(), DIAGNOSTICS_FAILURE)
    setText(t)
    return t
  }
  const checkAll = async (): Promise<void> => {
    setLoading(true)
    setCopied(false)
    await Promise.all([loadText(), claude.check(true), storage.reload()])
    setCheckedAt(new Date())
    setLoading(false)
  }
  const copy = async (): Promise<void> => {
    setLoading(true)
    const t = text ?? (await loadText())
    setLoading(false)
    await navigator.clipboard.writeText(t).then(
      () => setCopied(true),
      () => setCopied(false)
    )
  }

  return (
    <div className={cn('flex flex-col gap-7', PAGE_WIDTH.form)}>
      <PageHeader
        title="Diagnóstico"
        subtitle="Para saber se está tudo certo e para pedir ajuda."
        action={
          <Button variant="outline" size="sm" disabled={loading} onClick={() => void checkAll()}>
            {loading ? <Spinner /> : <RefreshIcon />}
            Conferir tudo
          </Button>
        }
      />

      <Summary
        storage={storage.value}
        healthy={claudeText.tone === 'success'}
        checking={claudeText.tone === 'neutral'}
      />

      <SettingsGroup
        title="Estado"
        description={
          checkedAt
            ? `Conferido às ${formatTime(checkedAt)}.`
            : '“Conferir tudo” verifica o Claude Code de novo e remonta o diagnóstico.'
        }
      >
        <SettingRow label="Claude Code" description="O CLI que roda as tarefas, com o seu login.">
          <StatusBadge label={claudeText.label} tone={claudeText.tone} />
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title="Armazenamento" description="O que o Orkio guarda neste computador.">
        {storage.error ? (
          <div className="p-4">
            <Alert tone="danger">{storage.error.message}</Alert>
          </div>
        ) : storage.value === null ? (
          <div className="p-4">
            <Skeleton className="h-24" aria-label="Carregando armazenamento" />
          </div>
        ) : (
          storageRows(storage.value).map((r) => (
            <SettingRow key={r.label} label={r.label} help={r.detail}>
              <span className="text-sm text-foreground tabular-nums">{r.value}</span>
            </SettingRow>
          ))
        )}
      </SettingsGroup>

      <SettingsGroup
        title="Suporte"
        description="Versões, banco local, filas e conexões, sem tokens, contas, títulos de tarefas ou caminhos."
      >
        <div role="group" aria-label="Diagnóstico">
          <SettingRow
            label="Pacote de diagnóstico"
            description="Cole numa mensagem de ajuda: só texto, nada sai daqui sem você colar."
          >
            <div className="flex items-center gap-1.5">
              {copied && (
                <span role="status" className="text-xs text-muted-foreground">
                  Copiado.
                </span>
              )}
              {!text && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={loading}
                  onClick={() => void loadText()}
                >
                  Ver antes
                </Button>
              )}
              <Button variant="outline" size="sm" disabled={loading} onClick={() => void copy()}>
                <CopyIcon />
                Copiar diagnóstico
              </Button>
            </div>
          </SettingRow>
          {text && (
            <div className="border-t border-border-soft p-4">
              <Textarea
                aria-label="Diagnóstico"
                value={text}
                readOnly
                rows={10}
                className="font-mono text-xs"
              />
            </div>
          )}
        </div>
      </SettingsGroup>
    </div>
  )
}

/** Topo: quanto o Orkio ocupa (barra dividida) e se está tudo certo. */
function Summary({
  storage,
  healthy,
  checking
}: {
  storage: StorageUsage | null
  healthy: boolean
  checking: boolean
}): React.JSX.Element {
  const runs = storage?.runsBytes ?? 0
  const memory = storage?.agentMemoryBytes ?? 0
  const total = runs + memory
  const share = (n: number): string => `${total > 0 ? Math.max(2, (n / total) * 100) : 0}%`
  return (
    <section
      aria-label="Resumo"
      className="flex flex-col gap-3 rounded-xl border border-border-soft bg-card p-5"
    >
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-2xl font-medium text-foreground tabular-nums">
          {storage ? formatStorageBytes(total) : '—'}
        </span>
        <span className="text-xs text-muted-foreground">em uso pelo Orkio</span>
        <span className="ml-auto">
          <StatusBadge
            label={checking ? 'Conferindo…' : healthy ? 'Tudo certo' : 'Precisa de atenção'}
            tone={checking ? 'neutral' : healthy ? 'success' : 'warning'}
          />
        </span>
      </div>
      <div aria-hidden="true" className="flex h-2 gap-0.5 overflow-hidden rounded-full bg-muted">
        {total > 0 && (
          <>
            <span className="h-full rounded-full bg-brand" style={{ width: share(runs) }} />
            <span className="h-full rounded-full bg-purple" style={{ width: share(memory) }} />
          </>
        )}
      </div>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <Legend tone="bg-brand" label="Execuções" value={formatStorageBytes(runs)} />
        <Legend tone="bg-purple" label="Memória dos agentes" value={formatStorageBytes(memory)} />
        {storage && (
          <span className="text-subtle-foreground">
            {plural(storage.worktrees, 'ambiente de tarefa', 'ambientes de tarefa')}
          </span>
        )}
      </p>
    </section>
  )
}

function Legend({
  tone,
  label,
  value
}: {
  tone: string
  label: string
  value: string
}): React.JSX.Element {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden="true" className={cn('size-2 rounded-full', tone)} />
      {label}
      <span className="text-foreground tabular-nums">{value}</span>
    </span>
  )
}
