import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { SwitchField } from '@/components/form'
import type { NotificationPrefs } from '../../../../shared/preferences'
import type { ProjectView } from '../../../../shared/projects'
import { Alert } from '../../components/Alert'
import { PageHeader } from '../../components/PageHeader'
import { PAGE_WIDTH } from '../../components/page-width'
import { SettingsCard } from './SettingsCard'
import { usePreferences } from './usePreferences'

/**
 * Configurações › Notificações: aviso do sistema, som e projetos silenciados. O sino do app
 * continua contando tudo (só o aviso do sistema muda).
 */
export function NotificationsSection({
  projects
}: {
  projects: ProjectView[] | null
}): React.JSX.Element {
  const { prefs, error, save } = usePreferences()
  const n = prefs?.notifications ?? null
  const set = (patch: Partial<NotificationPrefs>): void => {
    if (n) void save({ notifications: { ...n, ...patch } })
  }
  return (
    <div className={cn('flex flex-col gap-6', PAGE_WIDTH.form)}>
      <PageHeader
        title="Notificações"
        subtitle="Quando o Orkio avisa fora do app. O sino continua contando tudo, com ou sem aviso."
      />
      {error && <Alert tone="danger">{error}</Alert>}

      <SettingsCard
        title="Avisos do sistema"
        description="Quando um agente pede aprovação, faz uma pergunta ou uma regra pede para avisar."
      >
        <SwitchField
          label="Mostrar aviso do sistema"
          description="A notificação do seu computador, mesmo com o Orkio em segundo plano."
          checked={n?.system ?? true}
          disabled={n === null}
          onChange={(system) => set({ system })}
        />
        <SwitchField
          label="Tocar som"
          description={
            n?.system === false ? 'Liga junto com o aviso do sistema.' : 'Junto com o aviso.'
          }
          checked={(n?.sound ?? true) && n?.system !== false}
          disabled={n === null || !n.system}
          onChange={(sound) => set({ sound })}
        />
      </SettingsCard>

      <SettingsCard
        title="Projetos"
        description="Projeto silenciado não mostra aviso do sistema. O sino e a lista lateral continuam mostrando o que precisa de você."
      >
        {projects === null || n === null ? (
          <Skeleton className="h-16" aria-label="Carregando projetos" />
        ) : projects.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum projeto adicionado ainda.</p>
        ) : (
          <ul aria-label="Avisos por projeto" className="flex flex-col gap-3">
            {projects.map((p) => {
              const muted = n.muted.includes(p.id)
              return (
                <li key={p.id}>
                  <SwitchField
                    label={`Avisar sobre ${p.name}`}
                    description={muted ? 'Silenciado.' : undefined}
                    checked={!muted}
                    disabled={!n.system}
                    onChange={(on) =>
                      set({
                        muted: on ? n.muted.filter((id) => id !== p.id) : [...n.muted, p.id]
                      })
                    }
                  />
                </li>
              )
            })}
          </ul>
        )}
      </SettingsCard>
    </div>
  )
}
