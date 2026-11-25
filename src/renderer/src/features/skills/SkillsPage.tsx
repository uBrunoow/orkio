import { useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Switch } from '@/components/ui/switch'
import type { SkillEntry, SkillsView } from '../../../../shared/preferences'
import { PageHeader } from '../../components/PageHeader'
import { PAGE_WIDTH } from '../../components/page-width'
import { EmptyState, PageState } from '../../components/PageState'
import { Alert } from '../../components/Alert'
import { TextField } from '../../components/form'
import { SettingsGroup } from '../../components/SettingRows'
import { StatusBadge } from '../../components/StatusToken'
import { ChevronRightIcon } from '../../components/icons'
import { plural } from '../../lib/format'
import { ipcResult, unwrap, useIpcResource } from '../../lib/ipc'
import { useSlashFocus } from '../../lib/useSlashFocus'
import { useProjects } from '../projects/useProjects'
import {
  groupSkills,
  groupState,
  nextDisabled,
  nextDisabledMany,
  type SkillGroup
} from './skills-logic'

/** Origem pequena já vem aberta; as grandes (ex.: 300 do usuário) ficam recolhidas. */
const OPEN_UP_TO = 8

/**
 * Configurações › Skills (no jeito do Compozy): resumo, origens recolhíveis com a contagem e uma
 * chave para a origem inteira, e as desligadas numa seção à parte. Desligar = `Skill(nome)` no
 * deny das execuções do Orkio neste projeto (a mesma lista do main, `skills.setDisabled`).
 */
export function SkillsPage({ projectId }: { projectId: string | null }): React.JSX.Element {
  const projects = useProjects().projects?.filter((p) => !p.archived) ?? null
  const projectName = projects?.find((p) => p.id === projectId)?.name ?? null
  const skills = useIpcResource(projectId, (id) => window.orkio.skills.get(id).then(unwrap), {
    refreshOnFocus: true
  })
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const searchBox = useRef<HTMLDivElement>(null)
  useSlashFocus(searchBox)

  const view = skills.value
  const setDisabled = async (names: string[]): Promise<void> => {
    if (!projectId) return
    setBusy(true)
    setError(null)
    const r = await ipcResult(() => window.orkio.skills.setDisabled(projectId, names))
    setBusy(false)
    if (r.ok) skills.set(r.value)
    else setError(r.error.message)
  }

  const groups = view ? groupSkills(view.skills, query) : []
  const offCount = view ? view.skills.filter((s) => s.disabled).length : 0

  return (
    <div className={cn('flex flex-col gap-7', PAGE_WIDTH.form)}>
      <div className="flex flex-col gap-2">
        <PageHeader
          title="Skills"
          subtitle="Habilidades que o Claude Code carrega: do seu usuário, do projeto e dos plugins."
        />
        {view && (
          <p className="text-xs text-muted-foreground tabular-nums">
            {plural(view.skills.length, 'encontrada', 'encontradas')}
            <span aria-hidden="true" className="px-1.5 text-subtle-foreground">
              ·
            </span>
            {plural(offCount + view.missing.length, 'desligada', 'desligadas')}
            <span aria-hidden="true" className="px-1.5 text-subtle-foreground">
              ·
            </span>
            vale para {projectName ?? 'o projeto escolhido'}
          </p>
        )}
      </div>

      {projectId === null ? (
        <EmptyState
          title="Escolha um projeto"
          description="As skills são vistas por projeto: cada repositório pode ter as dele, além das do seu usuário e dos plugins. Escolha um projeto no menu para ver e desligar as que não quer nas execuções."
        />
      ) : view === null && skills.error ? (
        <PageState
          kind="error"
          message={skills.error.message}
          action={{ label: 'Tentar de novo', onClick: () => void skills.reload() }}
        />
      ) : view === null ? (
        <PageState kind="loading" label="Carregando skills" />
      ) : (
        <>
          {error && <Alert tone="danger">{error}</Alert>}
          {view.skills.length === 0 ? (
            <EmptyState
              title="Nenhuma skill encontrada"
              description="O Claude Code não achou skills no seu usuário, neste projeto nem nos plugins instalados. Instale um plugin ou crie uma skill em .claude/skills/ e volte aqui."
            />
          ) : (
            <SettingsGroup
              bare
              title="Origens"
              description="Onde o Claude Code achou cada skill. A chave liga ou desliga a origem inteira."
            >
              <div ref={searchBox} className="flex flex-wrap items-center gap-3">
                <TextField
                  label="Buscar skill"
                  labelHidden
                  type="search"
                  placeholder="Buscar skill (/)"
                  value={query}
                  onChange={setQuery}
                  inputClassName="w-72"
                />
                <span className="text-xs text-muted-foreground" data-testid="skills-count">
                  {view.skills.length - offCount} de {view.skills.length} ligadas
                </span>
              </div>
              {groups.length === 0 ? (
                <p className="text-xs text-muted-foreground">Nenhuma skill com esse nome.</p>
              ) : (
                <div className="flex flex-col divide-y divide-border-soft overflow-hidden rounded-xl border border-border-soft bg-card">
                  {groups.map((g) => (
                    <OriginRow
                      // A busca reabre as origens (o que bate fica à vista).
                      key={`${g.origin}:${query ? 'q' : ''}`}
                      group={g}
                      searching={query !== ''}
                      busy={busy}
                      view={view}
                      onChange={(names) => void setDisabled(names)}
                    />
                  ))}
                </div>
              )}
            </SettingsGroup>
          )}

          <DisabledSkills view={view} busy={busy} onChange={(n) => void setDisabled(n)} />
        </>
      )}
    </div>
  )
}

function OriginRow({
  group,
  searching,
  busy,
  view,
  onChange
}: {
  group: SkillGroup
  searching: boolean
  busy: boolean
  view: SkillsView
  onChange(disabled: string[]): void
}): React.JSX.Element {
  const [open, setOpen] = useState(searching || group.skills.length <= OPEN_UP_TO)
  const state = groupState(group)
  const off = group.skills.filter((s) => s.disabled).length
  const names = group.skills.map((s) => s.name)
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="flex items-center gap-3 px-4 py-3">
        <CollapsibleTrigger className="group/origin flex min-w-0 flex-1 items-center gap-2 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/40">
          <ChevronRightIcon
            aria-hidden="true"
            className="size-3.5 shrink-0 text-subtle-foreground transition-transform group-data-[state=open]/origin:rotate-90 motion-reduce:transition-none"
          />
          <span className="truncate text-sm text-foreground">{group.origin}</span>
          {state === 'partial' && (
            <StatusBadge label={plural(off, 'desligada', 'desligadas')} tone="warning" />
          )}
        </CollapsibleTrigger>
        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-2xs text-muted-foreground tabular-nums">
          {plural(group.skills.length, 'skill', 'skills')}
        </span>
        <Switch
          checked={state !== 'off'}
          disabled={busy || searching}
          aria-label={`Origem ligada neste projeto: ${group.origin}`}
          title={searching ? 'Limpe a busca para ligar ou desligar a origem inteira' : undefined}
          onCheckedChange={(on) => onChange(nextDisabledMany(view.skills, view.missing, names, on))}
        />
      </div>
      <CollapsibleContent>
        <ul className="flex flex-col divide-y divide-border-soft border-t border-border-soft bg-background/40">
          {group.skills.map((s) => (
            <SkillRow
              key={`${s.source}:${s.name}`}
              skill={s}
              busy={busy}
              onToggle={(on) => onChange(nextDisabled(view.skills, view.missing, s.name, on))}
            />
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  )
}

function SkillRow({
  skill: s,
  busy,
  onToggle
}: {
  skill: SkillEntry
  busy: boolean
  onToggle(on: boolean): void
}): React.JSX.Element {
  return (
    <li
      aria-label={s.name}
      data-testid="skill-row"
      className="flex items-start gap-4 py-2.5 pr-4 pl-9"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span
          className={cn(
            'font-mono text-xs',
            s.disabled ? 'text-muted-foreground line-through' : 'text-foreground'
          )}
        >
          {s.name}
        </span>
        {s.description && (
          <p className="line-clamp-2 text-xs text-muted-foreground">{s.description}</p>
        )}
      </div>
      <Switch
        checked={!s.disabled}
        disabled={busy}
        aria-label={`Ligada neste projeto: ${s.name}`}
        onCheckedChange={onToggle}
        className="mt-0.5 shrink-0"
      />
    </li>
  )
}

/** As desligadas juntas (inclusive as que sumiram do disco), com Religar. */
function DisabledSkills({
  view,
  busy,
  onChange
}: {
  view: SkillsView
  busy: boolean
  onChange(disabled: string[]): void
}): React.JSX.Element {
  const off = [
    ...view.skills.filter((s) => s.disabled).map((s) => ({ name: s.name, gone: false })),
    ...view.missing.map((name) => ({ name, gone: true }))
  ]
  return (
    <SettingsGroup
      bare
      title="Desligadas"
      description="Vale na próxima execução, sem reiniciar. No seu terminal o Claude Code continua com todas."
    >
      {off.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border-soft px-4 py-6 text-center">
          <p className="text-sm text-foreground">Nenhuma skill desligada</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Todas as skills daqui valem nas execuções deste projeto.
          </p>
        </div>
      ) : (
        <ul
          aria-label="Skills desligadas"
          className="flex flex-col divide-y divide-border-soft overflow-hidden rounded-xl border border-border-soft bg-card"
        >
          {off.map((o) => (
            <li key={o.name} className="flex items-center gap-3 px-4 py-2.5">
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">
                {o.name}
              </span>
              {o.gone && <StatusBadge label="não aparece mais" tone="neutral" />}
              <Button
                size="xs"
                variant="ghost"
                disabled={busy}
                aria-label={`Religar ${o.name}`}
                onClick={() => onChange(nextDisabled(view.skills, view.missing, o.name, true))}
              >
                Religar
              </Button>
            </li>
          ))}
        </ul>
      )}
    </SettingsGroup>
  )
}
