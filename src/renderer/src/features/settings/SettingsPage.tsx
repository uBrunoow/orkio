import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { SegmentedControl } from '@/components/form'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/Spinner'
import type { ReleaseNotes, UpdateStatus } from '../../../../shared/updates'
import { InstallControls } from './InstallControls'
import { useUpdates } from './useUpdates'
import { formatDateTime } from '../../lib/format'
import { WhatsNewDialog } from './WhatsNewDialog'
import { StatusBadge } from '../../components/StatusToken'
import { SettingRow, SettingsGroup, SwitchRow } from '../../components/SettingRows'
import { OrkioLogo } from '../../components/OrkioLogo/OrkioLogo'
import { ExternalLinkIcon, RefreshIcon } from '../../components/icons'
import { ipcCall, useIpcResource } from '../../lib/ipc'
import { isUpdateDownloading, updatePhaseText } from '../../lib/status-text'

export function UpdatesSection(): React.JSX.Element {
  const { status, checking, check, setChannel } = useUpdates()
  const [notes, setNotes] = useState<ReleaseNotes | null>(null)

  return (
    <SettingsGroup
      bare
      title="Atualizações"
      description="O Orkio procura sozinho e nunca reinicia por cima de trabalho em andamento."
    >
      {!status ? (
        <Skeleton className="h-32" aria-label="Carregando atualizações" />
      ) : (
        <div className="flex flex-col gap-3">
          {/* Resumo: a versão, em que pé está e as ações. */}
          <div className="flex flex-col gap-4 rounded-xl border border-border-soft bg-card p-5">
            <div className="flex flex-wrap items-center gap-3">
              <span
                aria-hidden="true"
                className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand"
              >
                <OrkioLogo
                  variant="simple"
                  size={20}
                  label=""
                  className="text-primary-foreground!"
                />
              </span>
              <div className="flex min-w-0 flex-col">
                <span className="text-xs text-muted-foreground">Versão atual</span>
                <code
                  data-testid="current-version"
                  className="font-mono text-lg font-medium text-foreground"
                >
                  {status.currentVersion}
                </code>
              </div>
              <span className="ml-auto">
                <PhaseBadge status={status} />
              </span>
            </div>
            <StatusLine status={status} />
            <InstallControls status={status} />
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={
                  checking ||
                  status.phase === 'checking' ||
                  status.mode === 'disabled' ||
                  status.phase === 'downloading'
                }
                onClick={() => void check()}
              >
                {checking || status.phase === 'checking' ? <Spinner /> : <RefreshIcon />}
                Procurar atualizações
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={async () =>
                  setNotes(
                    (await window.orkio.updates.releaseNotes()) ?? {
                      version: status.currentVersion,
                      notes: ''
                    }
                  )
                }
              >
                Ver novidades desta versão
              </Button>
            </div>
          </div>

          <div className="flex flex-col divide-y divide-border-soft rounded-xl border border-border-soft bg-card">
            <SettingRow
              label="Canal"
              description={
                <>
                  {status.channel === 'beta'
                    ? 'Recebe versões de teste antes de todo mundo. Podem ter problemas.'
                    : 'Só versões testadas.'}
                  {status.channelNote && <span className="block">{status.channelNote}</span>}
                </>
              }
            >
              <SegmentedControl
                label="Canal"
                size="sm"
                value={status.channel}
                onChange={(value) => void setChannel(value === 'beta' ? 'beta' : 'stable')}
                options={[
                  { value: 'stable', label: 'Estável' },
                  { value: 'beta', label: 'Beta' }
                ]}
              />
            </SettingRow>
            <SettingRow label="Última verificação" help="Ao abrir o app e a cada 4 horas.">
              <span data-testid="last-check" className="text-sm text-foreground tabular-nums">
                {status.lastCheckAt ? formatDateTime(status.lastCheckAt) : 'Nunca'}
              </span>
            </SettingRow>
          </div>
        </div>
      )}
      {notes && <WhatsNewDialog notes={notes} closeLabel="Fechar" onClose={() => setNotes(null)} />}
    </SettingsGroup>
  )
}

/** Energia: manter o computador acordado enquanto agentes trabalham (desligado por padrão). */
export function PowerSection(): React.JSX.Element {
  const keepAwake = useIpcResource('', () => window.orkio.power.keepAwake())
  const enabled = keepAwake.value
  return (
    <SettingsGroup title="Energia">
      <SwitchRow
        label="Manter o computador acordado enquanto agentes trabalham"
        description="Evita a suspensão com um agente rodando. Desliga sozinho quando nada estiver rodando."
        checked={enabled === true}
        disabled={enabled === null}
        onChange={(value) => {
          keepAwake.set(value)
          void ipcCall(() => window.orkio.power.setKeepAwake(value), !value).then(keepAwake.set)
        }}
      />
    </SettingsGroup>
  )
}

function PhaseBadge({ status }: { status: UpdateStatus }): React.JSX.Element | null {
  const text = updatePhaseText(status)
  return text && <StatusBadge {...text} />
}

function StatusLine({ status }: { status: UpdateStatus }): React.JSX.Element {
  let text: string
  if (status.mode === 'disabled') {
    text = 'As atualizações automáticas funcionam só no app instalado (macOS e Windows).'
  } else if (status.phase === 'checking') {
    text = 'Procurando atualizações…'
  } else if (isUpdateDownloading(status)) {
    text = `Baixando a versão ${status.version ?? ''}${status.progress !== null ? ` (${status.progress}%)` : ''}…`
  } else if (status.phase === 'downloaded') {
    text = `A versão ${status.version ?? ''} está pronta. Ela é instalada quando você reiniciar ou fechar o Orkio.`
  } else if (status.phase === 'available') {
    text = `A versão ${status.version ?? ''} está disponível. Neste Mac a atualização é manual: baixe o instalador e arraste o Orkio para Aplicativos.`
  } else if (status.phase === 'error' && status.error) {
    text = status.error
  } else {
    text = 'Você está na versão mais recente.'
  }
  return (
    <p role="status" data-testid="update-status" className="text-sm text-muted-foreground">
      {status.phase !== 'error' && status.error ? `${text} ${status.error}` : text}
    </p>
  )
}

export function AboutSection(): React.JSX.Element {
  const about = useIpcResource('', () => window.orkio.updates.about()).value
  return (
    <section aria-label="Sobre" className="flex flex-col gap-3">
      <div className="flex items-center gap-4 rounded-xl border border-border-soft bg-card p-5">
        <span
          aria-hidden="true"
          className="grid size-12 shrink-0 place-items-center rounded-xl bg-brand"
        >
          <OrkioLogo variant="simple" size={24} label="" className="text-primary-foreground!" />
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="font-display text-lg tracking-wide text-foreground">Orkio</span>
          <span className="text-xs text-muted-foreground">
            Orquestra Notion, GitHub e Claude Code nas suas tarefas.
          </span>
        </div>
        {about && (
          <code className="ml-auto rounded-md border border-border-soft bg-muted px-2 py-0.5 font-mono text-xs text-foreground">
            {about.version}
          </code>
        )}
      </div>
      <div className="flex flex-col divide-y divide-border-soft rounded-xl border border-border-soft bg-card">
        {about?.links ? (
          <>
            <ExternalLink label="Site" url={about.links.site} />
            <ExternalLink label="Privacidade" url={about.links.privacy} />
            <ExternalLink label="Termos de uso" url={about.links.terms} />
          </>
        ) : (
          <p className="px-4 py-3 text-sm text-muted-foreground">
            Site, privacidade e termos aparecem aqui nas versões publicadas.
          </p>
        )}
      </div>
    </section>
  )
}

function ExternalLink({ label, url }: { label: string; url: string }): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={() => void window.orkio.openExternal(url)}
      className="flex items-center justify-between gap-3 px-4 py-3 text-left text-sm text-foreground outline-none first:rounded-t-xl last:rounded-b-xl hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring/40"
    >
      {label}
      <ExternalLinkIcon aria-hidden="true" className="size-3.5 text-subtle-foreground" />
    </button>
  )
}
