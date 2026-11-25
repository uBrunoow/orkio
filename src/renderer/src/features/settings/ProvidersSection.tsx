import { useState } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { SegmentedControl } from '@/components/form'
import { Spinner } from '@/components/Spinner'
import { PageHeader } from '../../components/PageHeader'
import { PAGE_WIDTH } from '../../components/page-width'
import { StatusBadge } from '../../components/StatusToken'
import { ClaudeLogo, RefreshIcon } from '../../components/icons'
import { SettingRow, SettingsGroup, SwitchRow } from '../../components/SettingRows'
import { formatDateTime } from '../../lib/format'
import { useSources } from '../../app/sources'
import type { SettingsSection } from '../../app/routes'
import { ipcCall, useSource } from '../../lib/ipc'
import {
  USAGE_HOLD_DEFAULT,
  type UsageHold,
  type UsageWindow
} from '../../../../shared/claude-usage'
import { claudeLoginText, claudeStatusText } from '../../lib/status-text'
import { useClaudeStatus } from '../claude/useClaudeStatus'

/** Configurações › Provedores e uso: o Claude Code deste computador, o uso e o que fazer perto do limite. */
export function ProvidersSection({
  onOpenSection
}: {
  onOpenSection(section: SettingsSection): void
}): React.JSX.Element {
  return (
    <div className={cn('flex flex-col gap-7', PAGE_WIDTH.form)}>
      <PageHeader
        title="Provedores e uso"
        subtitle="Quem roda as tarefas e quanto da sua assinatura já foi usado."
      />
      <ClaudeProvider onOpenIntegrations={() => onOpenSection('integrations')} />
      <UsageMeterSection />
      <UsageHoldSection />
    </div>
  )
}

function ClaudeProvider({ onOpenIntegrations }: { onOpenIntegrations(): void }): React.JSX.Element {
  const claude = useClaudeStatus()
  const status = claude.status
  const [checking, setChecking] = useState(false)
  const check = async (): Promise<void> => {
    setChecking(true)
    await claude.check(true)
    setChecking(false)
  }
  return (
    <SettingsGroup
      bare
      title="Provedor"
      description="Executa as tarefas no seu computador, com a sua conta. É o único provedor por enquanto."
    >
      <section
        aria-label="Claude Code"
        className="overflow-hidden rounded-xl border border-border-soft bg-card"
      >
        <div className="flex flex-wrap items-center gap-3 border-b border-border-soft px-4 py-3.5">
          <span
            aria-hidden="true"
            className="grid size-10 shrink-0 place-items-center rounded-xl bg-claude text-white"
          >
            <ClaudeLogo className="size-5" />
          </span>
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="text-sm font-medium text-foreground">Claude Code</span>
            <span className="text-xs text-muted-foreground">CLI da Anthropic · sua assinatura</span>
          </div>
          <StatusBadge {...claudeStatusText(status)} />
        </div>
        <div className="flex flex-col divide-y divide-border-soft">
          <SettingRow label="Versão">
            <code className="font-mono text-xs text-foreground">
              {status === null ? '…' : status.installed ? (status.version ?? '—') : 'Não instalado'}
            </code>
          </SettingRow>
          <SettingRow label="Login">
            {status === null ? (
              <span className="text-xs text-muted-foreground">…</span>
            ) : (
              <StatusBadge {...claudeLoginText(status)} />
            )}
          </SettingRow>
        </div>
        <div className="flex flex-wrap gap-2 border-t border-border-soft bg-surface/50 px-4 py-2.5">
          <Button variant="outline" size="sm" disabled={checking} onClick={() => void check()}>
            {checking ? <Spinner /> : <RefreshIcon />}
            Verificar de novo
          </Button>
          <Button variant="ghost" size="sm" onClick={onOpenIntegrations}>
            Instalar, entrar e plugins em Integrações
          </Button>
        </div>
      </section>
    </SettingsGroup>
  )
}

/** Uma janela de uso em barra: %, quando renova e (opcional) a marca do limite da automação. */
function UsageBar({
  label,
  window: w,
  mark
}: {
  label: string
  window: UsageWindow | null
  mark?: number | undefined
}): React.JSX.Element {
  const pct = w?.percent ?? 0
  const tone = pct >= 90 ? 'bg-danger' : pct >= 70 ? 'bg-warn' : 'bg-ok'
  return (
    <div className="flex flex-col gap-1.5 px-4 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm text-foreground">{label}</span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {w ? (
            <>
              <span className="text-sm text-foreground">{w.percent}%</span>
              {w.resetsAt && ` · renova ${formatDateTime(w.resetsAt)}`}
            </>
          ) : (
            '—'
          )}
        </span>
      </div>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        className="relative h-2 rounded-full bg-muted"
      >
        <span
          className={cn('absolute inset-y-0 left-0 rounded-full', tone)}
          style={{ width: `${pct}%` }}
        />
        {mark !== undefined && (
          <span
            aria-hidden="true"
            title={`A automação espera a partir de ${mark}%`}
            className="absolute -inset-y-1 w-0.5 -translate-x-1/2 rounded-full bg-foreground"
            style={{ left: `${mark}%` }}
          />
        )}
      </div>
    </div>
  )
}

/**
 * Uso do Claude: as janelas em barra (quando o medidor tem dados) e o medidor na barra do app
 * (experimental, ligado por padrão). Lê a mesma fonte da barra: mudar aqui some/aparece lá na hora.
 */
export function UsageMeterSection(): React.JSX.Element {
  const { claudeUsage } = useSources()
  const view = useSource(claudeUsage, '').value
  const usage = view?.usage ?? null
  const hold = view?.hold ?? USAGE_HOLD_DEFAULT
  return (
    <SettingsGroup
      title="Uso do Claude"
      description="Lido do login do Claude Code neste computador, só na hora, sem guardar nada."
    >
      {view?.enabled !== false &&
        (usage ? (
          <>
            <UsageBar
              label="Janela de 5 horas"
              window={usage.session}
              mark={hold.enabled ? hold.percent : undefined}
            />
            <UsageBar label="Semana" window={usage.weekly} />
          </>
        ) : (
          view !== null && (
            <p className="px-4 py-3 text-xs text-muted-foreground">
              Sem leitura do uso agora (Claude Code sem login ou a Anthropic não respondeu).
            </p>
          )
        ))}
      <SwitchRow
        label="Mostrar o uso do Claude na barra (experimental)"
        description="As duas janelas, ao lado da busca."
        help="Se a Anthropic mudar algo, o medidor some sozinho."
        checked={view?.enabled !== false}
        disabled={view === null}
        onChange={(value) => {
          claudeUsage.set('', (v) => (v ? { ...v, enabled: value } : v))
          void ipcCall(() => window.orkio.usage.setEnabled(value), !value).then(() =>
            claudeUsage.reload('')
          )
        }}
      />
    </SettingsGroup>
  )
}

const HOLD_OPTIONS = [80, 90, 95].map((p) => ({ value: String(p), label: `${p}%` }))

/**
 * Fase 5: o uso do Claude decide quando a automação roda. Com a janela de 5 h no limite escolhido,
 * os fluxos que a automação começou esperam renovar; o que você pede roda sempre.
 */
export function UsageHoldSection(): React.JSX.Element {
  const { claudeUsage } = useSources()
  const view = useSource(claudeUsage, '').value
  const hold = view?.hold ?? USAGE_HOLD_DEFAULT
  const meterOff = view?.enabled === false
  const save = (next: UsageHold): void => {
    claudeUsage.set('', (v) => (v ? { ...v, hold: next } : v))
    void ipcCall(() => window.orkio.usage.setHold(next), hold).then(() => claudeUsage.reload(''))
  }
  return (
    <SettingsGroup
      title="Perto do limite"
      description={
        meterOff
          ? 'Precisa do medidor de uso ligado (acima). Com ele desligado, nada é segurado.'
          : 'Os fluxos que a automação começou (regras das colunas, orquestrador, a PR que acorda o fluxo) esperam a janela renovar. O que você pede roda sempre.'
      }
    >
      <SwitchRow
        label="Esperar a janela renovar antes de rodar pela automação"
        help="Se o medidor falhar, nada é segurado."
        checked={hold.enabled}
        disabled={view === null}
        onChange={(enabled) => save({ ...hold, enabled })}
      />
      <SettingRow
        label="Segurar a partir de"
        description="Da janela de 5 horas (a marca na barra acima)."
      >
        <SegmentedControl
          label="Segurar a partir de"
          size="sm"
          options={
            HOLD_OPTIONS.some((o) => o.value === String(hold.percent))
              ? HOLD_OPTIONS
              : [...HOLD_OPTIONS, { value: String(hold.percent), label: `${hold.percent}%` }]
          }
          value={String(hold.percent)}
          onChange={(v) => save({ ...hold, percent: Number(v) })}
        />
      </SettingRow>
    </SettingsGroup>
  )
}
