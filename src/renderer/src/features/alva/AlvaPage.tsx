import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { SelectField } from '@/components/form'
import { Spinner } from '@/components/Spinner'
import { cn } from '@/lib/utils'
import { StatusToken, toneOf } from '../../components/StatusToken'
import type { AlvaCheckItem, AlvaPrecheck, AlvaStatusView } from '../../../../shared/alva'
import { Alert } from '../../components/Alert'
import { CopyIcon, RefreshIcon } from '../../components/icons'
import { PAGE_WIDTH } from '../../components/page-width'
import { suggestAlvaTargets, type AlvaTargets } from './alva-targets'
import type { BoardView } from '../../../../shared/board'

const STATE: Record<AlvaCheckItem['state'], { label: string; color: 'green' | 'red' | 'yellow' }> =
  {
    ok: { label: 'OK', color: 'green' },
    // Falta configurar é aviso (o resto do Orkio funciona), não erro.
    missing: { label: 'Falta', color: 'yellow' },
    warning: { label: 'Atenção', color: 'yellow' }
  }

/**
 * Tela "alva-flow" (5B): pré-checagem do projeto, criação dos fluxos Alva (templates editáveis no
 * "Fluxos de tarefa"), coluna opcional "Planejando" e limite de fluxos Alva em paralelo.
 */
export function AlvaPage({
  projectId,
  view,
  onBoardChanged
}: {
  projectId: string
  view: BoardView
  onBoardChanged(): void
}): React.JSX.Element {
  const [precheck, setPrecheck] = useState<AlvaPrecheck | null>(null)
  const [checking, setChecking] = useState(false)
  const [status, setStatus] = useState<AlvaStatusView | null>(null)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [planStatus, setPlanStatus] = useState<string>(
    view.statusOptions.find((o) => /andamento/i.test(o.name))?.id ?? view.statusOptions[0]?.id ?? ''
  )
  // Sugestão só depois de saber o que já está ligado (nunca aponta para a coluna de outro fluxo).
  const [targets, setTargets] = useState<AlvaTargets>({
    plan: null,
    deliver: null,
    review: null,
    reviewed: null
  })
  const touched = useRef(false)
  const choose = (patch: Partial<AlvaTargets>): void => {
    touched.current = true
    setTargets((t) => ({ ...t, ...patch }))
  }

  useEffect(() => {
    let active = true
    void window.orkio.alva.precheck(projectId).then((r) => {
      if (active && r.ok) setPrecheck(r.value)
    })
    void window.orkio.alva.status(projectId).then((r) => {
      if (active && r.ok) setStatus(r.value)
    })
    return () => {
      active = false
    }
  }, [projectId])

  const stages = view.config?.stages
  useEffect(() => {
    if (status && !touched.current) setTargets(suggestAlvaTargets(stages ?? [], status))
  }, [status, stages])

  const recheck = async (): Promise<void> => {
    setChecking(true)
    const r = await window.orkio.alva.precheck(projectId, { force: true })
    setChecking(false)
    if (r.ok) setPrecheck(r.value)
  }

  const stageOptions = [
    { value: '', label: 'Nenhuma (rodar à mão)' },
    ...(view.config?.stages ?? []).map((s) => ({ value: s.id, label: s.name }))
  ]
  const hasPlanning = (view.config?.stages ?? []).some((s) => /planejando/i.test(s.name))

  const create = async (): Promise<void> => {
    setBusy(true)
    const r = await window.orkio.alva.createTemplates(projectId, targets)
    setBusy(false)
    if (r.ok) {
      setStatus(r.value)
      setMessage({
        tone: 'ok',
        text: 'Fluxos Alva criados. Edite em Fluxo do projeto → Fluxos de tarefa.'
      })
    } else setMessage({ tone: 'error', text: r.error.message })
  }

  const addPlanning = async (): Promise<void> => {
    setBusy(true)
    const r = await window.orkio.alva.addPlanningStage(projectId, planStatus)
    setBusy(false)
    if (r.ok) {
      choose({ plan: r.value })
      setMessage({ tone: 'ok', text: 'Coluna “Planejando” criada.' })
      onBoardChanged()
    } else setMessage({ tone: 'error', text: r.error.message })
  }

  return (
    <section
      role="region"
      aria-label="alva-flow"
      className={cn('flex w-full flex-col gap-[18px]', PAGE_WIDTH.form)}
    >
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-medium">alva-flow</h2>
          {precheck?.pluginVersion && (
            <code className="font-mono text-xs text-subtle-foreground">
              v{precheck.pluginVersion}
            </code>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Os fluxos Alva rodam os comandos do plugin alva-flow (/spec, /plan, /implement, /review,
          /commit, /pr) nas colunas do quadro, ligando cada tarefa do Notion a uma task do
          Backlog.md.
        </p>
      </div>

      <section role="region" aria-label="Pronto para o alva-flow?" className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium">Pronto para o alva-flow?</h3>
          {precheck && (
            <StatusToken
              tone={precheck.ready ? 'success' : 'warning'}
              label={precheck.ready ? 'Pronto' : 'Falta configurar'}
              data-testid="alva-ready"
            />
          )}
          <div className="flex-1" />
          <Button size="sm" variant="ghost" disabled={checking} onClick={() => void recheck()}>
            {checking ? <Spinner /> : <RefreshIcon />}
            Verificar de novo
          </Button>
        </div>
        {precheck === null ? (
          <Skeleton className="h-40" aria-label="Verificando o projeto" />
        ) : (
          <ul
            aria-label="Itens da pré-checagem"
            className="overflow-hidden rounded-xl border border-border-soft bg-card"
          >
            {precheck.items.map((i) => (
              <li
                key={i.id}
                className="flex items-start gap-4 border-b border-border-soft px-4 py-3 last:border-b-0"
              >
                <StatusToken
                  tone={toneOf(STATE[i.state].color)}
                  label={STATE[i.state].label}
                  className="mt-0.5 w-20 shrink-0"
                />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-sm font-medium">{i.label}</span>
                  <span className="text-xs text-muted-foreground">{i.detail}</span>
                  {i.fix && i.state !== 'ok' && (
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <code className="rounded-md border border-border-soft bg-surface px-2 py-1 font-mono text-xs break-all">
                        {i.fix}
                      </code>
                      <CopyButton text={i.fix} label={`Copiar comando: ${i.label}`} />
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {precheck && !precheck.ready && (
          <p className="text-xs text-muted-foreground">
            Enquanto faltar algo, os fluxos Alva não começam (o resto do Orkio funciona
            normalmente).
          </p>
        )}
      </section>

      <section
        role="region"
        aria-label="Fluxos Alva"
        className="flex flex-col gap-4 rounded-xl border border-border-soft bg-card p-4"
      >
        <h3 className="text-sm font-medium">Fluxos Alva</h3>
        {status && status.templates.length > 0 && (
          <ul
            aria-label="Fluxos Alva criados"
            className="overflow-hidden rounded-lg border border-border-soft"
          >
            {status.templates.map((t) => (
              <li
                key={t.id}
                className="flex flex-col gap-0.5 border-b border-border-soft px-3 py-2 last:border-b-0"
              >
                <span className="text-sm">{t.name}</span>
                <span className="text-xs text-muted-foreground">
                  {t.stageId
                    ? `Coluna “${view.config?.stages.find((s) => s.id === t.stageId)?.name ?? '?'}”, ${t.mode === 'manual' ? 'manual' : 'ao entrar'}`
                    : 'Sem coluna (rodar à mão)'}
                </span>
              </li>
            ))}
          </ul>
        )}

        {!hasPlanning && (
          <div className="flex flex-wrap items-end gap-2">
            <SelectField
              label="Status do Notion da coluna “Planejando”"
              className="min-w-64 flex-1"
              options={view.statusOptions.map((o) => ({ value: o.id, label: o.name }))}
              value={planStatus || null}
              onChange={setPlanStatus}
            />
            <Button
              variant="outline"
              disabled={!planStatus || busy}
              onClick={() => void addPlanning()}
            >
              {busy && <Spinner />}
              Criar coluna “Planejando”
            </Button>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField
            label="Coluna do “Alva: planejar”"
            options={stageOptions}
            value={targets.plan ?? ''}
            onChange={(v: string) => choose({ plan: v || null })}
          />
          <SelectField
            label="Coluna do “Alva: implementar e entregar”"
            options={stageOptions}
            value={targets.deliver ?? ''}
            onChange={(v: string) => choose({ deliver: v || null })}
          />
          <SelectField
            label="Coluna do “Alva: revisão publicada”"
            options={stageOptions}
            value={targets.review ?? ''}
            onChange={(v: string) => choose({ review: v || null })}
          />
          <SelectField
            label="Coluna do “Alva: comentários da PR”"
            options={stageOptions}
            value={targets.reviewed ?? ''}
            onChange={(v: string) => choose({ reviewed: v || null })}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          O “Alva: CI vermelho” fica sem coluna (rode à mão). O “Alva: revisão publicada” publica a
          revisão do agente na PR como orkio[bot] depois da sua aprovação (precisa do GitHub App do
          Orkio instalado no repositório).
        </p>
        <div className="flex">
          <Button disabled={busy} onClick={() => void create()}>
            {busy && <Spinner />}
            {status && status.templates.length > 0 ? 'Recriar fluxos Alva' : 'Criar fluxos Alva'}
          </Button>
        </div>
      </section>

      {precheck?.hasDocker && status && (
        <SelectField
          label="Fluxos Alva ao mesmo tempo neste projeto (Docker e portas)"
          className="max-w-md"
          options={[1, 2, 3, 4].map((n) => ({ value: String(n), label: String(n) }))}
          value={String(status.maxParallel)}
          onChange={(v: string) =>
            void window.orkio.alva.setMaxParallel(projectId, Number(v)).then((r) => {
              if (r.ok) setStatus(r.value)
            })
          }
        />
      )}

      {message &&
        (message.tone === 'error' ? (
          <Alert tone="danger">{message.text}</Alert>
        ) : (
          <p role="status" className="text-sm text-ok">
            {message.text}
          </p>
        ))}
    </section>
  )
}

/** Copia o comando de correção para colar no terminal. */
function CopyButton({ text, label }: { text: string; label: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      size="xs"
      variant="ghost"
      aria-label={label}
      onClick={() =>
        void navigator.clipboard.writeText(text).then(
          () => {
            setCopied(true)
            window.setTimeout(() => setCopied(false), 2000)
          },
          () => {}
        )
      }
    >
      <CopyIcon />
      {copied ? 'Copiado' : 'Copiar'}
    </Button>
  )
}
