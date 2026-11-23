import { useEffect, useState } from 'react'
import { Button } from '@astryxdesign/core/Button'
import { Card } from '@astryxdesign/core/Card'
import { Code } from '@astryxdesign/core/Code'
import { HStack } from '@astryxdesign/core/HStack'
import { Icon } from '@astryxdesign/core/Icon'
import { Item } from '@astryxdesign/core/Item'
import { List } from '@astryxdesign/core/List'
import { Text } from '@astryxdesign/core/Text'
import { Token } from '@astryxdesign/core/Token'
import { VStack } from '@astryxdesign/core/VStack'
import type {
  ArtifactCandidate,
  ArtifactPublishMode,
  ArtifactView
} from '../../../../shared/agent-run'
import { Alert } from '../../components/Alert'
import { ExternalLinkIcon, NotionLogo } from '../../components/icons'

const MODE_LABEL: Record<ArtifactPublishMode, string> = {
  section: 'seção na página da tarefa',
  child_page: 'subpágina da tarefa'
}

/**
 * Artefatos (4B): documentos alterados no ambiente → "Anexar" (caminho + commit) → "Publicar no
 * Notion" como seção ou subpágina, sempre com confirmação.
 */
export function TaskArtifacts({
  projectId,
  taskId,
  runId,
  refreshKey
}: {
  projectId: string
  taskId: string
  runId: string | null
  /** Muda quando execuções/ambiente mudam: recarrega a lista. */
  refreshKey: string
}): React.JSX.Element | null {
  const [data, setData] = useState<{
    candidates: ArtifactCandidate[]
    attached: ArtifactView[]
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<{
    artifact: ArtifactView
    mode: ArtifactPublishMode
  } | null>(null)
  const [busy, setBusy] = useState(false)
  const [published, setPublished] = useState<{ path: string; url: string | null } | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let active = true
    void window.orkio.claude.artifacts(projectId, taskId).then((r) => {
      if (!active) return
      if (r.ok) setData(r.value)
      else setError(r.error.message)
    })
    return () => {
      active = false
    }
  }, [projectId, taskId, refreshKey, tick])

  if (!data || (data.candidates.length === 0 && data.attached.length === 0)) return null

  const attachedPaths = new Set(data.attached.map((a) => a.path))
  const pending = data.candidates.filter((c) => !attachedPaths.has(c.path) || !c.committed)

  const attach = async (path: string): Promise<void> => {
    setBusy(true)
    const r = await window.orkio.claude.attachArtifact(projectId, taskId, path, runId)
    setBusy(false)
    setError(r.ok ? null : r.error.message)
    setTick((n) => n + 1)
  }
  const publish = async (): Promise<void> => {
    if (!confirm) return
    setBusy(true)
    const r = await window.orkio.claude.publishArtifact(
      projectId,
      confirm.artifact.id,
      confirm.mode
    )
    setBusy(false)
    if (r.ok) {
      setPublished({ path: confirm.artifact.path, url: r.value.url })
      setError(null)
    } else {
      setError(r.error.message)
    }
    setConfirm(null)
    setTick((n) => n + 1)
  }

  return (
    <VStack gap={2} role="region" aria-label="Documentos para o Notion">
      <Text weight="semibold">Documentos para o Notion</Text>
      {pending.length > 0 && (
        <List hasDividers density="compact" aria-label="Documentos alterados">
          {pending.map((c) => (
            <Item
              as="li"
              key={c.path}
              label={<Code>{c.path}</Code>}
              description={c.committed ? 'Commitado' : 'Mudanças não commitadas'}
              endContent={
                <Button
                  size="sm"
                  variant="secondary"
                  label="Anexar"
                  aria-label={`Anexar ${c.path}`}
                  isDisabled={!c.committed || busy}
                  {...(!c.committed
                    ? { disabledMessage: 'Faça commit do documento antes de anexar.' }
                    : {})}
                  onClick={() => void attach(c.path)}
                />
              }
            />
          ))}
        </List>
      )}
      {data.attached.length > 0 && (
        <List hasDividers density="compact" aria-label="Documentos anexados">
          {data.attached.map((a) => (
            <Item
              as="li"
              key={a.id}
              label={<Code>{a.path}</Code>}
              description={`Commit ${a.commit.slice(0, 7)}`}
              endContent={
                <HStack gap={1} vAlign="center" wrap="wrap">
                  {a.notion && (
                    <Token
                      size="sm"
                      color="green"
                      label={
                        a.notion.mode === 'section' ? 'No Notion (seção)' : 'No Notion (subpágina)'
                      }
                    />
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    label="Publicar como seção"
                    aria-label={`Publicar ${a.path} como seção`}
                    isDisabled={busy}
                    onClick={() => setConfirm({ artifact: a, mode: 'section' })}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    label="Publicar como subpágina"
                    aria-label={`Publicar ${a.path} como subpágina`}
                    isDisabled={busy}
                    onClick={() => setConfirm({ artifact: a, mode: 'child_page' })}
                  />
                </HStack>
              }
            />
          ))}
        </List>
      )}
      {confirm && (
        <Card role="alertdialog" aria-label="Confirmar publicação">
          <VStack gap={2}>
            <Text>
              Publicar <Code>{confirm.artifact.path}</Code> (commit{' '}
              {confirm.artifact.commit.slice(0, 7)}) no Notion como {MODE_LABEL[confirm.mode]}? O
              conteúdo fica visível para quem vê a tarefa. Segredos reconhecidos são omitidos.
            </Text>
            <HStack gap={2}>
              <Button
                size="sm"
                variant="primary"
                label="Publicar"
                icon={<Icon icon={NotionLogo} />}
                isLoading={busy}
                onClick={() => void publish()}
              />
              <Button size="sm" variant="ghost" label="Cancelar" onClick={() => setConfirm(null)} />
            </HStack>
          </VStack>
        </Card>
      )}
      {published && (
        <HStack gap={2} vAlign="center" role="status">
          <Text type="supporting">
            <Code>{published.path}</Code> publicado no Notion.
          </Text>
          {published.url && (
            <Button
              size="sm"
              variant="ghost"
              label="Abrir no Notion"
              icon={<Icon icon={ExternalLinkIcon} />}
              onClick={() => void window.orkio.openExternal(published.url!)}
            />
          )}
        </HStack>
      )}
      {error && <Alert tone="danger">{error}</Alert>}
    </VStack>
  )
}
