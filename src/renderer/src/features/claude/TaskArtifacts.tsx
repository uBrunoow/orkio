import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/Spinner'
import { StatusToken } from '../../components/StatusToken'
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
    <section aria-label="Documentos para o Notion" className="flex flex-col gap-2.5">
      <p className="text-sm font-medium">Documentos para o Notion</p>
      {pending.length > 0 && (
        <ul
          aria-label="Documentos alterados"
          className="overflow-hidden rounded-lg border border-border-soft bg-card"
        >
          {pending.map((c) => (
            <li
              key={c.path}
              className="flex items-center gap-2 border-b border-border-soft px-3 py-2 last:border-b-0"
            >
              <div className="flex min-w-0 flex-1 flex-col">
                <code className="truncate font-mono text-xs">{c.path}</code>
                <span className="text-2xs text-muted-foreground">
                  {c.committed ? 'Commitado' : 'Mudanças não commitadas'}
                </span>
              </div>
              <Button
                size="xs"
                variant="outline"
                aria-label={`Anexar ${c.path}`}
                disabled={!c.committed || busy}
                {...(!c.committed ? { title: 'Faça commit do documento antes de anexar.' } : {})}
                onClick={() => void attach(c.path)}
              >
                Anexar
              </Button>
            </li>
          ))}
        </ul>
      )}
      {data.attached.length > 0 && (
        <ul
          aria-label="Documentos anexados"
          className="overflow-hidden rounded-lg border border-border-soft bg-card"
        >
          {data.attached.map((a) => (
            <li
              key={a.id}
              className="flex flex-col gap-1.5 border-b border-border-soft px-3 py-2 last:border-b-0"
            >
              <div className="flex min-w-0 items-center gap-2">
                <div className="flex min-w-0 flex-1 flex-col">
                  <code className="truncate font-mono text-xs">{a.path}</code>
                  <span className="font-mono text-2xs text-subtle-foreground">
                    Commit {a.commit.slice(0, 7)}
                  </span>
                </div>
                {a.notion && (
                  <StatusToken
                    tone="success"
                    label={
                      a.notion.mode === 'section' ? 'No Notion (seção)' : 'No Notion (subpágina)'
                    }
                  />
                )}
              </div>
              <div className="flex flex-wrap gap-1">
                <Button
                  size="xs"
                  variant="ghost"
                  aria-label={`Publicar ${a.path} como seção`}
                  disabled={busy}
                  onClick={() => setConfirm({ artifact: a, mode: 'section' })}
                >
                  Publicar como seção
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  aria-label={`Publicar ${a.path} como subpágina`}
                  disabled={busy}
                  onClick={() => setConfirm({ artifact: a, mode: 'child_page' })}
                >
                  Publicar como subpágina
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {confirm && (
        <div
          role="alertdialog"
          aria-label="Confirmar publicação"
          className="flex flex-col gap-2.5 rounded-[10px] border border-warn-tint-border bg-warn-tint p-3.5"
        >
          <p className="text-sm">
            Publicar <code className="font-mono text-xs">{confirm.artifact.path}</code> (commit{' '}
            {confirm.artifact.commit.slice(0, 7)}) no Notion como {MODE_LABEL[confirm.mode]}? O
            conteúdo fica visível para quem vê a tarefa. Segredos reconhecidos são omitidos.
          </p>
          <div className="flex gap-2">
            <Button size="sm" disabled={busy} onClick={() => void publish()}>
              {busy ? <Spinner /> : <NotionLogo />}
              Publicar
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>
              Cancelar
            </Button>
          </div>
        </div>
      )}
      {published && (
        <div role="status" className="flex flex-wrap items-center gap-2 text-xs">
          <span>
            <code className="font-mono">{published.path}</code> publicado no Notion.
          </span>
          {published.url && (
            <Button
              size="xs"
              variant="ghost"
              onClick={() => void window.orkio.openExternal(published.url!)}
            >
              <ExternalLinkIcon />
              Abrir no Notion
            </Button>
          )}
        </div>
      )}
      {error && <Alert tone="danger">{error}</Alert>}
    </section>
  )
}
