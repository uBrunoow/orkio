import { useState } from 'react'
import {
  MEMORY_LIMITS,
  MEMORY_SUGGESTIONS,
  memoryPercent,
  type AgentMemoryView,
  type MemoryAction,
  type MemoryNoteInput,
  type MemoryNoteView,
  type MemoryScopeChoice
} from '../../../../shared/agent-memory'
import type { AgentView } from '../../../../shared/agent'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible'
import { Skeleton } from '@/components/ui/skeleton'
import { SegmentedControl, TextAreaField, TextField } from '@/components/form'
import { Alert } from '../../components/Alert'
import { ChoiceCards } from '../../components/ChoiceCards'
import { CollapsibleHeader } from '../../components/CollapsibleHeader'
import { Spinner } from '../../components/Spinner'
import { BackIcon, EditIcon, PlusIcon, TrashIcon } from '../../components/icons'
import { formatDateTime } from '../../lib/format'
import { ipcResult, unwrap, useIpcResource } from '../../lib/ipc'
import type { Result } from '../../../../shared/result'
import { useProjects } from '../projects/useProjects'
import { AgentAvatar } from './AgentAvatar'

/** "2026-11-24" → "24/11/2026". */
function day(date: string): string {
  const [y, m, d] = date.split('-')
  return `${d}/${m}/${y}`
}

const SCOPE_CARDS = [
  {
    value: 'geral' as const,
    title: 'Em todo lugar',
    phrase: 'Vale em qualquer projeto onde ele trabalhar.'
  },
  {
    value: 'projeto' as const,
    title: 'Só neste projeto',
    phrase: 'Vale só quando ele trabalha neste projeto.'
  }
]

type Draft = { id: string | null; text: string; scope: MemoryScopeChoice; until: string }

/**
 * Agentes › Memória (Fase 3): as notas que o agente guarda (ferramenta "lembrar") ou que você
 * escreve, e que voltam no início das próximas conversas dele. Adicionar (Simples: só o texto;
 * Avançado: onde vale e até quando), editar, arquivar e apagar; no "Avançado" recolhido, as
 * arquivadas e o histórico (voltar para uma versão).
 */
export function AgentMemory({
  projectId,
  agent,
  onBack
}: {
  projectId: string
  agent: AgentView
  onBack(): void
}): React.JSX.Element {
  const name = agent.profile?.name ?? agent.id
  const memory = useIpcResource(`${projectId}\u0000${agent.key}`, (k) => {
    const [p, key] = k.split('\u0000') as [string, string]
    return window.orkio.agents.memory(p, key).then(unwrap)
  })
  const projects = useProjects().projects
  const view = memory.value
  const [draft, setDraft] = useState<Draft | null>(null)
  const [advanced, setAdvanced] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [more, setMore] = useState(false)
  const [confirming, setConfirming] = useState<string | null>(null)

  const apply = async (
    call: (v: AgentMemoryView) => Promise<Result<AgentMemoryView>>,
    done: string
  ): Promise<boolean> => {
    if (!view) return false
    setBusy(true)
    setMessage(null)
    const r = await ipcResult(() => call(view))
    setBusy(false)
    if (!r.ok) {
      setMessage({ tone: 'error', text: r.error.message })
      if (r.error.code === 'stale' || r.error.code === 'not_found') void memory.reload()
      return false
    }
    memory.set(r.value)
    setMessage({ tone: 'ok', text: done })
    return true
  }

  const save = async (d: Draft): Promise<void> => {
    const note: MemoryNoteInput = { text: d.text, scope: d.scope, until: d.until.trim() || null }
    const ok = await apply(
      (v) =>
        d.id
          ? window.orkio.agents.editMemory(projectId, agent.key, v.digest, d.id, note)
          : window.orkio.agents.addMemory(projectId, agent.key, v.digest, note),
      d.id ? 'Nota atualizada.' : 'Nota anotada.'
    )
    if (ok) setDraft(null)
  }

  const change = (note: MemoryNoteView, action: MemoryAction): void => {
    const done = {
      remove: 'Nota apagada.',
      archive: 'Nota arquivada.',
      unarchive: 'Nota de volta.'
    }
    void apply(
      (v) => window.orkio.agents.changeMemory(projectId, agent.key, v.digest, note.id, action),
      done[action]
    )
  }

  const where = (note: MemoryNoteView): string => {
    if (note.projectId === null) return 'Em todo lugar'
    if (note.projectId === projectId) return 'Só neste projeto'
    const other = projects?.find((p) => p.id === note.projectId)
    return other ? `Só em ${other.name}` : 'Só em outro projeto'
  }

  const meta = (note: MemoryNoteView): string =>
    [
      note.date ? day(note.date) : 'Sem data',
      where(note),
      note.until ? `vale até ${day(note.until)}` : null
    ]
      .filter(Boolean)
      .join(' · ')

  const percent = view ? memoryPercent(view) : 0

  return (
    <section
      aria-label={`Memória de ${name}`}
      className="flex flex-col gap-4 rounded-xl border border-border-soft bg-card p-5"
    >
      <div className="flex flex-wrap items-start gap-3">
        <Button size="icon-sm" variant="ghost" aria-label="Voltar para os agentes" onClick={onBack}>
          <BackIcon />
        </Button>
        <AgentAvatar
          name={name}
          color={agent.profile?.color ?? 'yellow'}
          seed={agent.key}
          size="lg"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 className="text-base font-medium">{`Memória de ${name}`}</h2>
          <p className="text-xs text-muted-foreground">
            {agent.scope === 'repo'
              ? `O que ${name} lembra quando trabalha neste projeto.`
              : `O que ${name} lembra onde quer que trabalhe.`}{' '}
            Ele anota sozinho o que vai servir de novo; você também pode.
          </p>
        </div>
        {!draft && (
          <Button
            disabled={!view}
            onClick={() => {
              setMessage(null)
              setDraft({ id: null, text: '', scope: 'geral', until: '' })
            }}
          >
            <PlusIcon />
            Adicionar nota
          </Button>
        )}
      </div>

      {message &&
        (message.tone === 'error' ? (
          <Alert tone="danger">{message.text}</Alert>
        ) : (
          <p role="status" className="text-xs text-muted-foreground">
            {message.text}
          </p>
        ))}
      {memory.error && !view && <Alert tone="danger">{memory.error.message}</Alert>}

      {view && (
        <div className="flex items-center gap-3 rounded-lg border border-border-soft px-3 py-2.5">
          <div
            role="meter"
            aria-label="Memória usada"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
          >
            <div
              className="h-full rounded-full bg-foreground/50"
              style={{ width: `${percent}%` }}
            />
          </div>
          <span
            className="tabular text-xs text-muted-foreground"
            title="Acima do limite, as notas mais antigas vão para as arquivadas."
          >
            {`${percent}% cheio`}
          </span>
        </div>
      )}

      {draft && (
        <form
          aria-label={draft.id ? 'Editar nota' : 'Nova nota'}
          className="flex flex-col gap-3 rounded-lg border border-border-soft p-3"
          onSubmit={(e) => {
            e.preventDefault()
            void save(draft)
          }}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">{draft.id ? 'Editar nota' : 'Nova nota'}</span>
            <SegmentedControl
              label="Modo da nota"
              size="sm"
              value={advanced ? 'advanced' : 'simple'}
              onChange={(v) => setAdvanced(v === 'advanced')}
              options={[
                { value: 'simple', label: 'Simples' },
                { value: 'advanced', label: 'Avançado' }
              ]}
            />
          </div>
          <TextAreaField
            label="Nota"
            description={`Uma frase curta, sem segredos (tokens e senhas são apagados ao gravar). ${draft.text.length}/${MEMORY_LIMITS.noteMax}`}
            value={draft.text}
            rows={2}
            onChange={(text) => setDraft({ ...draft, text: text.slice(0, MEMORY_LIMITS.noteMax) })}
          />
          {advanced && (
            <div className="flex flex-col gap-3">
              <ChoiceCards
                label="Onde vale"
                columns={2}
                value={draft.scope}
                options={SCOPE_CARDS}
                onChange={(scope) => setDraft({ ...draft, scope })}
              />
              <TextField
                label="Vale até"
                description="Opcional, AAAA-MM-DD. Depois disso a nota sai da conversa e vai para as arquivadas."
                placeholder="AAAA-MM-DD"
                mono
                value={draft.until}
                onChange={(until) => setDraft({ ...draft, until })}
              />
            </div>
          )}
          <div className="flex gap-2">
            <Button type="submit" disabled={busy || !draft.text.trim()}>
              {busy && <Spinner />}
              Salvar nota
            </Button>
            <Button type="button" variant="ghost" onClick={() => setDraft(null)}>
              Cancelar
            </Button>
          </div>
        </form>
      )}

      {!view ? (
        memory.error ? null : (
          <Skeleton className="h-24" aria-label="Carregando a memória" />
        )
      ) : view.notes.length === 0 ? (
        <div className="flex flex-col gap-2 rounded-lg border border-dashed border-border-soft p-4">
          <p className="text-sm">Nenhuma nota ainda.</p>
          <p className="text-xs text-muted-foreground">
            {`Comece com uma destas (um clique anota) ou deixe que ${name} anote sozinho durante as tarefas.`}
          </p>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Sugestões de nota">
            {MEMORY_SUGGESTIONS.map((text) => (
              <Button
                key={text}
                size="xs"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void apply(
                    (v) =>
                      window.orkio.agents.addMemory(projectId, agent.key, v.digest, {
                        text,
                        scope: 'geral',
                        until: null
                      }),
                    'Nota anotada.'
                  )
                }
              >
                {text}
              </Button>
            ))}
          </div>
        </div>
      ) : (
        <ul
          aria-label="Notas"
          className="flex flex-col divide-y divide-border-soft rounded-lg border border-border-soft"
        >
          {view.notes.map((n) => (
            <li key={n.id} aria-label={n.text} className="flex items-start gap-3 px-3 py-2.5">
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <p className="text-sm break-words">{n.text}</p>
                <p className="text-2xs text-subtle-foreground">
                  {meta(n)}
                  {n.expired && ' · vencida'}
                </p>
              </div>
              <div className="flex shrink-0 items-center">
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Editar nota"
                  title="Editar"
                  disabled={busy}
                  onClick={() => {
                    setMessage(null)
                    setAdvanced(n.projectId !== null || n.until !== null)
                    setDraft({
                      id: n.id,
                      text: n.text,
                      scope: n.projectId === null ? 'geral' : 'projeto',
                      until: n.until ?? ''
                    })
                  }}
                >
                  <EditIcon />
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={busy}
                  title="Sai da conversa, mas fica guardada"
                  onClick={() => change(n, 'archive')}
                >
                  Arquivar
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Apagar nota"
                  title="Apagar (dá para voltar pelo histórico)"
                  disabled={busy}
                  onClick={() => change(n, 'remove')}
                >
                  <TrashIcon />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {view && (view.archived.length > 0 || view.history.length > 0) && (
        <Collapsible open={more} onOpenChange={setMore}>
          <CollapsibleHeader open={more} className="text-xs text-muted-foreground">
            {`Avançado · ${view.archived.length} arquivada(s) · ${view.history.length} versão(ões) no histórico`}
          </CollapsibleHeader>
          <CollapsibleContent className="flex flex-col gap-4 pt-3">
            {view.archived.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <p className="text-xs font-medium">Arquivadas</p>
                <ul aria-label="Notas arquivadas" className="flex flex-col gap-1">
                  {view.archived.map((n) => (
                    <li key={n.id} className="flex items-start gap-2 text-xs">
                      <span className="min-w-0 flex-1 text-muted-foreground">
                        {n.text}
                        <span className="text-subtle-foreground"> · {meta(n)}</span>
                      </span>
                      <Button
                        size="xs"
                        variant="outline"
                        disabled={busy}
                        onClick={() => change(n, 'unarchive')}
                      >
                        Restaurar
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {view.history.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <p className="text-xs font-medium">Histórico</p>
                <p className="text-2xs text-subtle-foreground">
                  Cada mudança guarda a versão de antes. Voltar troca as notas atuais pelas daquela
                  versão (a atual também fica no histórico).
                </p>
                <ul aria-label="Histórico da memória" className="flex flex-col gap-1">
                  {view.history.map((h) => (
                    <li key={h.id} className="flex items-center gap-2 text-xs">
                      <span className="flex-1 text-muted-foreground">
                        {`${h.at ? formatDateTime(h.at) : h.id} · ${h.count} nota(s)`}
                      </span>
                      {confirming === h.id ? (
                        <>
                          <Button
                            size="xs"
                            disabled={busy}
                            onClick={() => {
                              setConfirming(null)
                              void apply(
                                (v) =>
                                  window.orkio.agents.rollbackMemory(
                                    projectId,
                                    agent.key,
                                    v.digest,
                                    h.id
                                  ),
                                'Memória de volta para aquela versão.'
                              )
                            }}
                          >
                            Confirmar
                          </Button>
                          <Button size="xs" variant="ghost" onClick={() => setConfirming(null)}>
                            Cancelar
                          </Button>
                        </>
                      ) : (
                        <Button size="xs" variant="outline" onClick={() => setConfirming(h.id)}>
                          Voltar para esta versão
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CollapsibleContent>
        </Collapsible>
      )}
    </section>
  )
}
