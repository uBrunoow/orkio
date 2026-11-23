import { useEffect, useState } from 'react'
import { Button } from '@astryxdesign/core/Button'
import { Card } from '@astryxdesign/core/Card'
import { Code } from '@astryxdesign/core/Code'
import { Heading } from '@astryxdesign/core/Heading'
import { HStack } from '@astryxdesign/core/HStack'
import { Link } from '@astryxdesign/core/Link'
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl'
import { Text } from '@astryxdesign/core/Text'
import { TextArea } from '@astryxdesign/core/TextArea'
import { VStack } from '@astryxdesign/core/VStack'
import type { AboutInfo } from '../../../../shared/ipc-contract'
import type { ReleaseNotes, UpdateStatus } from '../../../../shared/updates'
import { InstallControls } from './InstallControls'
import { formatDateTime, useUpdates } from './useUpdates'
import { WhatsNewPanel } from './WhatsNewPanel'
import { StatusToken } from '../../components/StatusToken'

export function UpdatesSection(): React.JSX.Element {
  const { status, checking, check, setChannel } = useUpdates()
  const [notes, setNotes] = useState<ReleaseNotes | null>(null)

  return (
    <Card role="region" aria-labelledby="updates-title">
      <VStack gap={4}>
        <HStack gap={2} vAlign="center" justify="between">
          <Heading level={2} id="updates-title">
            Atualizações
          </Heading>
          {status && <PhaseToken status={status} />}
        </HStack>
        {!status ? (
          <Text color="secondary">Carregando…</Text>
        ) : (
          <VStack gap={4}>
            <HStack gap={6} wrap="wrap">
              <VStack gap={1}>
                <Text type="supporting" color="secondary">
                  Versão atual
                </Text>
                <Code data-testid="current-version">{status.currentVersion}</Code>
              </VStack>
              <VStack gap={1}>
                <Text type="supporting" color="secondary">
                  Última verificação
                </Text>
                <Text data-testid="last-check">{formatDateTime(status.lastCheckAt)}</Text>
              </VStack>
            </HStack>

            <VStack gap={1}>
              <SegmentedControl
                label="Canal"
                size="sm"
                value={status.channel}
                onChange={(value) => void setChannel(value === 'beta' ? 'beta' : 'stable')}
              >
                <SegmentedControlItem value="stable" label="Estável" />
                <SegmentedControlItem value="beta" label="Beta" />
              </SegmentedControl>
              <Text type="supporting" color="secondary">
                {status.channel === 'beta'
                  ? 'Recebe versões de teste antes de todo mundo. Podem ter problemas.'
                  : 'Só versões testadas.'}
              </Text>
              {status.channelNote && (
                <Text type="supporting" color="secondary">
                  {status.channelNote}
                </Text>
              )}
            </VStack>

            <StatusLine status={status} />
            <InstallControls status={status} />

            <HStack gap={2} wrap="wrap">
              <Button
                label="Procurar atualizações"
                isLoading={checking || status.phase === 'checking'}
                isDisabled={status.mode === 'disabled' || status.phase === 'downloading'}
                onClick={() => void check()}
              />
              <Button
                variant="ghost"
                label="Ver novidades desta versão"
                onClick={async () =>
                  setNotes(
                    (await window.orkio.updates.releaseNotes()) ?? {
                      version: status.currentVersion,
                      notes: ''
                    }
                  )
                }
              />
            </HStack>
          </VStack>
        )}
        {notes && (
          <WhatsNewPanel notes={notes} closeLabel="Fechar" onClose={() => setNotes(null)} />
        )}
      </VStack>
    </Card>
  )
}

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
    <Text role="status" data-testid="update-status">
      {status.phase !== 'error' && status.error ? `${text} ${status.error}` : text}
    </Text>
  )
}

export function AboutSection(): React.JSX.Element {
  const [about, setAbout] = useState<AboutInfo | null>(null)
  useEffect(() => {
    let alive = true
    void window.orkio.updates.about().then((a) => {
      if (alive) setAbout(a)
    })
    return () => {
      alive = false
    }
  }, [])
  return (
    <Card role="region" aria-labelledby="about-title">
      <VStack gap={3}>
        <Heading level={2} id="about-title">
          Sobre
        </Heading>
        <HStack gap={2} vAlign="center">
          <Text>Orkio</Text>
          {about && <Code>{about.version}</Code>}
        </HStack>
        {about?.links ? (
          <HStack gap={4} wrap="wrap">
            <ExternalLink label="Site" url={about.links.site} />
            <ExternalLink label="Privacidade" url={about.links.privacy} />
            <ExternalLink label="Termos de uso" url={about.links.terms} />
          </HStack>
        ) : (
          <Text color="secondary">
            Site, privacidade e termos aparecem aqui nas versões publicadas.
          </Text>
        )}
        <DiagnosticsBlock />
      </VStack>
    </Card>
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
    <VStack gap={2} role="group" aria-label="Diagnóstico">
      <Text type="supporting" color="secondary">
        Para pedir ajuda: versões, banco local, filas e conexões, sem tokens, contas, títulos de
        tarefas ou caminhos.
      </Text>
      <HStack gap={2} vAlign="center">
        <Button
          variant="secondary"
          size="sm"
          label="Copiar diagnóstico"
          isLoading={loading}
          onClick={() => void copy()}
        />
        {!text && (
          <Button size="sm" variant="ghost" label="Ver antes" onClick={() => void load()} />
        )}
        {copied && (
          <Text type="supporting" role="status">
            Copiado.
          </Text>
        )}
      </HStack>
      {text && (
        <TextArea
          label="Diagnóstico"
          value={text}
          isReadOnly
          rows={10}
          controlClassName="orkio-mono-input"
        />
      )}
    </VStack>
  )
}

function ExternalLink({ label, url }: { label: string; url: string }): React.JSX.Element {
  return (
    <Link label={`${label} ↗`} onClick={() => void window.orkio.openExternal(url)}>
      {label} ↗
    </Link>
  )
}
