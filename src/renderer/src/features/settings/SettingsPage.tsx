import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Field, SegmentedControl, SwitchField } from '@/components/form'
import { Spinner } from '@/components/Spinner'
import type { ReleaseNotes, UpdateStatus } from '../../../../shared/updates'
import { InstallControls } from './InstallControls'
import { useUpdates } from './useUpdates'
import { formatDateTime } from '../../lib/format'
import { WhatsNewPanel } from './WhatsNewPanel'
import { StatusToken } from '../../components/StatusToken'
import { ipcCall, useIpcResource } from '../../lib/ipc'

export function UpdatesSection(): React.JSX.Element {
  const { status, checking, check, setChannel } = useUpdates()
  const [notes, setNotes] = useState<ReleaseNotes | null>(null)

  return (
    <section aria-labelledby="updates-title" className={SECTION_CLASS}>
      <div className="flex items-center justify-between gap-2">
        <h2 id="updates-title" className="text-sm font-medium text-foreground">
          Atualizações
        </h2>
        {status && <PhaseToken status={status} />}
      </div>
      {!status ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-8">
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">Versão atual</span>
              <code data-testid="current-version" className="font-mono text-xs text-foreground">
                {status.currentVersion}
              </code>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">Última verificação</span>
              <span data-testid="last-check" className="text-sm text-foreground tabular">
                {status.lastCheckAt ? formatDateTime(status.lastCheckAt) : 'Nunca'}
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground" aria-hidden="true">
              Canal
            </span>
            <SegmentedControl
              label="Canal"
              size="sm"
              className="self-start"
              value={status.channel}
              onChange={(value) => void setChannel(value === 'beta' ? 'beta' : 'stable')}
              options={[
                { value: 'stable', label: 'Estável' },
                { value: 'beta', label: 'Beta' }
              ]}
            />
            <p className="text-xs text-muted-foreground">
              {status.channel === 'beta'
                ? 'Recebe versões de teste antes de todo mundo. Podem ter problemas.'
                : 'Só versões testadas.'}
            </p>
            {status.channelNote && (
              <p className="text-xs text-muted-foreground">{status.channelNote}</p>
            )}
          </div>

          <StatusLine status={status} />
          <InstallControls status={status} />

          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={
                checking ||
                status.phase === 'checking' ||
                status.mode === 'disabled' ||
                status.phase === 'downloading'
              }
              onClick={() => void check()}
            >
              {(checking || status.phase === 'checking') && <Spinner />}
              Procurar atualizações
            </Button>
            <Button
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
      )}
      {notes && <WhatsNewPanel notes={notes} closeLabel="Fechar" onClose={() => setNotes(null)} />}
    </section>
  )
}

/** Energia: manter o computador acordado enquanto agentes trabalham (desligado por padrão). */
export function PowerSection(): React.JSX.Element {
  const keepAwake = useIpcResource('', () => window.orkio.power.keepAwake())
  const enabled = keepAwake.value
  return (
    <section aria-labelledby="power-title" className={SECTION_CLASS}>
      <h2 id="power-title" className="text-sm font-medium text-foreground">
        Energia
      </h2>
      <SwitchField
        label="Manter o computador acordado enquanto agentes trabalham"
        description="Evita que o computador entre em suspensão com um agente rodando. Desliga sozinho quando nada estiver rodando."
        checked={enabled === true}
        disabled={enabled === null}
        onChange={(value) => {
          keepAwake.set(value)
          void ipcCall(() => window.orkio.power.setKeepAwake(value), !value).then(keepAwake.set)
        }}
      />
    </section>
  )
}

/** Caixa das seções de Configurações (borda fina, fundo de card). */
const SECTION_CLASS = 'flex flex-col gap-4 rounded-xl border border-border-soft bg-card p-5'

function PhaseToken({ status }: { status: UpdateStatus }): React.JSX.Element | null {
  if (status.mode === 'disabled') return <StatusToken label="Desligadas" />
  if (status.phase === 'downloaded' || status.phase === 'available')
    return <StatusToken tone="warning" label="Nova versão" />
  if (status.phase === 'downloading') return <StatusToken tone="running" label="Baixando" />
  return null
}

function StatusLine({ status }: { status: UpdateStatus }): React.JSX.Element {
  let text: string
  if (status.mode === 'disabled') {
    text = 'As atualizações automáticas funcionam só no app instalado (macOS e Windows).'
  } else if (status.phase === 'checking') {
    text = 'Procurando atualizações…'
  } else if (status.phase === 'downloading') {
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
    <p role="status" data-testid="update-status" className="text-sm text-foreground">
      {status.phase !== 'error' && status.error ? `${text} ${status.error}` : text}
    </p>
  )
}

export function AboutSection(): React.JSX.Element {
  const about = useIpcResource('', () => window.orkio.updates.about()).value
  return (
    <section aria-labelledby="about-title" className={SECTION_CLASS}>
      <h2 id="about-title" className="text-sm font-medium text-foreground">
        Sobre
      </h2>
      <div className="flex items-center gap-2">
        <span className="text-sm text-foreground">Orkio</span>
        {about && (
          <code className="rounded-sm border border-border px-1.5 font-mono text-2xs text-muted-foreground">
            {about.version}
          </code>
        )}
      </div>
      {about?.links ? (
        <div className="flex flex-wrap gap-4">
          <ExternalLink label="Site" url={about.links.site} />
          <ExternalLink label="Privacidade" url={about.links.privacy} />
          <ExternalLink label="Termos de uso" url={about.links.terms} />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Site, privacidade e termos aparecem aqui nas versões publicadas.
        </p>
      )}
      <DiagnosticsBlock />
    </section>
  )
}

/**
 * "Copiar diagnóstico": versões, banco local, filas e conexões (só o estado), para colar ao pedir
 * ajuda. Sem tokens, contas, títulos, prompts ou caminhos (montado e conferido no main).
 */
function DiagnosticsBlock(): React.JSX.Element {
  const [text, setText] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const load = async (): Promise<string> => {
    setLoading(true)
    const t = await window.orkio.updates.diagnostics()
    setLoading(false)
    setText(t)
    return t
  }
  const copy = async (): Promise<void> => {
    const t = text ?? (await load())
    await navigator.clipboard.writeText(t).then(
      () => setCopied(true),
      () => setCopied(false)
    )
  }
  return (
    <div
      role="group"
      aria-label="Diagnóstico"
      className="flex flex-col gap-2 border-t border-border-soft pt-4"
    >
      <p className="text-xs text-muted-foreground">
        Para pedir ajuda: versões, banco local, filas e conexões, sem tokens, contas, títulos de
        tarefas ou caminhos.
      </p>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" disabled={loading} onClick={() => void copy()}>
          {loading && <Spinner />}
          Copiar diagnóstico
        </Button>
        {!text && (
          <Button size="sm" variant="ghost" onClick={() => void load()}>
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
  )
}

function ExternalLink({ label, url }: { label: string; url: string }): React.JSX.Element {
  return (
    <Button variant="link" className="text-sm" onClick={() => void window.orkio.openExternal(url)}>
      {label} ↗
    </Button>
  )
}
