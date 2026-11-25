import { useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { PageHeader } from '../../components/PageHeader'
import { PAGE_WIDTH } from '../../components/page-width'
import { EmptyState, PageState } from '../../components/PageState'
import { Alert } from '../../components/Alert'
import { TextField } from '../../components/form'
import { ipcResult, unwrap, useIpcResource } from '../../lib/ipc'
import { useSlashFocus } from '../../lib/useSlashFocus'
import { useProjects } from '../projects/useProjects'
import { AppliesTo } from '../secrets/parts'
import { groupSkills, nextDisabled } from './skills-logic'

export function SkillsPage({ projectId }: { projectId: string | null }): React.JSX.Element {
  const projects = useProjects().projects
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
    <div className={cn('flex flex-col gap-[18px]', PAGE_WIDTH.list)}>
      <PageHeader
        title="Skills"
        subtitle="Habilidades que o Claude Code carrega (seu usuário, o projeto e os plugins)."
      />
      <AppliesTo>{projectId ? `o projeto ${projectName ?? '…'}` : 'o projeto escolhido'}</AppliesTo>
      <p className="-mt-2 text-xs text-muted-foreground">
        Desligar nega a skill nas execuções do Orkio neste projeto. No seu terminal o Claude Code
        continua com todas.
      </p>

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
          {view.missing.length > 0 && (
            <div
              role="group"
              aria-label="Desligadas que não aparecem mais"
              className="flex flex-wrap items-center gap-2 rounded-lg border border-border-soft bg-card px-3 py-2 text-xs"
            >
              <span className="text-muted-foreground">Desligadas que não aparecem mais:</span>
              {view.missing.map((name) => (
                <span key={name} className="flex items-center gap-1">
                  <span className="font-mono text-foreground">{name}</span>
                  <Button
                    size="xs"
                    variant="ghost"
                    disabled={busy}
                    aria-label={`Religar ${name}`}
                    onClick={() =>
                      void setDisabled(nextDisabled(view.skills, view.missing, name, true))
                    }
                  >
                    Religar
                  </Button>
                </span>
              ))}
            </div>
          )}
          {view.skills.length === 0 ? (
            <EmptyState
              title="Nenhuma skill encontrada"
              description="O Claude Code não achou skills no seu usuário, neste projeto nem nos plugins instalados. Instale um plugin ou crie uma skill em .claude/skills/ e volte aqui."
            />
          ) : (
            <>
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
              {groups.length === 0 && (
                <p className="text-xs text-muted-foreground">Nenhuma skill com esse nome.</p>
              )}
              {groups.map((g) => (
                <section key={g.origin} aria-label={g.origin} className="flex flex-col gap-2">
                  <h2 className="text-2xs tracking-[0.06em] text-subtle-foreground uppercase">
                    {g.origin}
                  </h2>
                  <ul className="flex flex-col divide-y divide-border-soft rounded-xl border border-border-soft bg-card">
                    {g.skills.map((s) => (
                      <li
                        key={`${s.source}:${s.name}`}
                        aria-label={s.name}
                        data-testid="skill-row"
                        className="flex items-start gap-4 px-4 py-3"
                      >
                        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span
                            className={cn(
                              'font-mono text-sm',
                              s.disabled ? 'text-muted-foreground' : 'text-foreground'
                            )}
                          >
                            {s.name}
                          </span>
                          {s.description && (
                            <p className="line-clamp-2 text-xs text-muted-foreground">
                              {s.description}
                            </p>
                          )}
                        </div>
                        <label className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                          <Switch
                            checked={!s.disabled}
                            disabled={busy}
                            aria-label={`Ligada neste projeto: ${s.name}`}
                            onCheckedChange={(on) =>
                              void setDisabled(nextDisabled(view.skills, view.missing, s.name, on))
                            }
                          />
                          Ligada neste projeto
                        </label>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </>
          )}
        </>
      )}
    </div>
  )
}
