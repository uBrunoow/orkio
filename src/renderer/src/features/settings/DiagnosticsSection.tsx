import { useState } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { Field } from '@/components/form'
import { Spinner } from '@/components/Spinner'
import { Alert } from '../../components/Alert'
import { PageHeader } from '../../components/PageHeader'
import { PAGE_WIDTH } from '../../components/page-width'
import { StatusToken } from '../../components/StatusToken'
import { formatTime } from '../../lib/format'
import { ipcCall, ipcResult, unwrap, useIpcResource } from '../../lib/ipc'
import { claudeStatusText } from '../../lib/status-text'
import { useClaudeStatus } from '../claude/useClaudeStatus'
import { SettingsCard } from './SettingsCard'
import { storageRows } from './storage-text'

const DIAGNOSTICS_FAILURE = 'Não foi possível montar o diagnóstico agora.'

/**
 * Configurações › Diagnóstico: conferir tudo de novo, copiar o diagnóstico para pedir ajuda e o
 * espaço que o Orkio usa no disco.
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
    <div className={cn('flex flex-col gap-6', PAGE_WIDTH.form)}>
      <PageHeader
        title="Diagnóstico"
        subtitle="Para saber se está tudo certo e para pedir ajuda."
        action={
          <Button variant="outline" disabled={loading} onClick={() => void checkAll()}>
            {loading && <Spinner />}
            Conferir tudo
          </Button>
        }
      />

      <SettingsCard
        title="Estado"
        description={
          checkedAt
            ? `Conferido às ${formatTime(checkedAt)}.`
            : '“Conferir tudo” verifica o Claude Code de novo e remonta o diagnóstico.'
        }
      >
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-foreground">Claude Code</span>
          <StatusToken {...claudeStatusText(claude.status)} />
        </div>
      </SettingsCard>

      <SettingsCard
        title="Copiar diagnóstico"
        description="Versões, banco local, filas e conexões, sem tokens, contas, títulos de tarefas ou caminhos."
      >
        <div role="group" aria-label="Diagnóstico" className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={loading} onClick={() => void copy()}>
              Copiar diagnóstico
            </Button>
            {!text && (
              <Button size="sm" variant="ghost" disabled={loading} onClick={() => void loadText()}>
                Ver antes
              </Button>
            )}
            {copied && (
              <span role="status" className="text-xs text-muted-foreground">
                Copiado.
              </span>
            )}
          </div>
          {text && (
            <Field label="Diagnóstico">
              {({ id }) => (
                <Textarea id={id} value={text} readOnly rows={10} className="font-mono text-xs" />
              )}
            </Field>
          )}
        </div>
      </SettingsCard>

      <SettingsCard title="Armazenamento" description="O que o Orkio guarda neste computador.">
        {storage.error && <Alert tone="danger">{storage.error.message}</Alert>}
        {storage.value === null ? (
          !storage.error && <Skeleton className="h-24" aria-label="Carregando armazenamento" />
        ) : (
          <dl aria-label="Armazenamento" className="flex flex-col divide-y divide-border-soft">
            {storageRows(storage.value).map((r) => (
              <div
                key={r.label}
                className="flex flex-wrap items-baseline gap-x-6 gap-y-0.5 py-2.5 first:pt-0 last:pb-0"
              >
                <dt className="w-44 shrink-0 text-xs text-muted-foreground">{r.label}</dt>
                <dd className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="tabular text-sm text-foreground">{r.value}</span>
                  <span className="text-xs text-subtle-foreground">{r.detail}</span>
                </dd>
              </div>
            ))}
          </dl>
        )}
      </SettingsCard>
    </div>
  )
}
