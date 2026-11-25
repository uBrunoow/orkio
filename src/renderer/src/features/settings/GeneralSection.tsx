import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { SegmentedControl } from '@/components/form'
import { Spinner } from '@/components/Spinner'
import { cn } from '@/lib/utils'
import type { DefaultAutonomy, RememberedRule } from '../../../../shared/preferences'
import { ChoiceCards, type ChoiceCard } from '../../components/ChoiceCards'
import { Alert } from '../../components/Alert'
import { PageHeader } from '../../components/PageHeader'
import { PAGE_WIDTH } from '../../components/page-width'
import { SettingRow, SettingsGroup } from '../../components/SettingRows'
import { StatusToken } from '../../components/StatusToken'
import { EditIcon, ExternalLinkIcon, EyeIcon, LockIcon } from '../../components/icons'
import { RuntimePicker, useSupportsEffort } from '../claude/RuntimePicker'
import { formatDateTime, plural } from '../../lib/format'
import { ipcResult, unwrap, useIpcResource } from '../../lib/ipc'
import { updatePhaseText } from '../../lib/status-text'
import type { SettingsSection } from '../../app/routes'
import { useOverview } from '../overview/useOverview'
import { useProjects } from '../projects/useProjects'
import { usePreferences } from './usePreferences'
import { useUpdates } from './useUpdates'

const AUTONOMY_OPTIONS: readonly ChoiceCard<DefaultAutonomy>[] = [
  {
    value: 'read_only',
    icon: EyeIcon,
    title: 'Só lê',
    phrase:
      'Lê e responde, sem mudar arquivos nem rodar o que altera. Fluxos que implementam ou entregam param.',
    hint: 'Ferramentas de edição desligadas e nada aprovado sozinho.'
  },
  {
    value: 'ask',
    icon: LockIcon,
    title: 'Pergunta antes de editar',
    phrase: 'Ler é automático. Cada mudança de arquivo e cada comando esperam você aprovar.',
    hint: 'Modo de permissão do Claude Code: manual (cada edição vira um pedido).'
  },
  {
    value: 'edits',
    icon: EditIcon,
    title: 'Edita sozinho na pasta da tarefa',
    phrase:
      'Muda os arquivos da tarefa sem perguntar. Comandos seguem as regras; push e GitHub continuam com o Orkio.',
    hint: 'Modo de permissão do Claude Code: acceptEdits.'
  }
]

/**
 * Configurações › Geral: o resumo do que roda, padrões das execuções sem agente (modelo e
 * permissões), projetos, decisões lembradas, privacidade, atualizações e sobre o Orkio.
 */
export function GeneralSection({
  onOpenSection
}: {
  onOpenSection(section: SettingsSection): void
}): React.JSX.Element {
  const { prefs, error, save } = usePreferences()
  const supportsEffort = useSupportsEffort()
  const { snapshot } = useOverview()
  const projects = useProjects().projects
  const running = snapshot?.running.length ?? 0
  const waiting = snapshot?.waiting.length ?? 0
  const active = (projects ?? []).filter((p) => !p.archived).length
  const archived = (projects ?? []).filter((p) => p.archived).length

  return (
    <div className={cn('flex flex-col gap-7', PAGE_WIDTH.form)}>
      <div className="flex flex-col gap-2">
        <PageHeader
          title="Geral"
          subtitle="Como o Claude Code trabalha quando a tarefa não tem agente, e o que o Orkio guarda."
        />
        <p
          data-testid="general-summary"
          className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground"
        >
          <span>Vale para as próximas execuções</span>
          <span aria-hidden="true" className="text-subtle-foreground">
            ·
          </span>
          <StatusToken
            tone={running > 0 ? 'running' : 'neutral'}
            label={plural(running, 'execução rodando', 'execuções rodando')}
          />
          <StatusToken
            tone={waiting > 0 ? 'warning' : 'neutral'}
            label={`${waiting} esperando você`}
          />
        </p>
      </div>
      {error && <Alert tone="danger">{error}</Alert>}

      <SettingsGroup
        title="Padrões de sessão"
        description="As execuções sem agente começam assim. Os agentes usam o que está no perfil deles."
      >
        <SettingRow
          label="Modelo"
          help="Quando a mensagem não escolhe outro. “Padrão do Claude Code” deixa o CLI decidir."
        >
          {prefs === null ? (
            <Skeleton className="h-8 w-48 rounded-full" aria-label="Carregando" />
          ) : (
            <RuntimePicker
              variant="pill"
              value={{ model: prefs.model, effort: prefs.effort }}
              supportsEffort={supportsEffort}
              onChange={(next) =>
                void save({ model: next.model ?? null, effort: next.effort ?? null })
              }
            />
          )}
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup
        bare
        title="Permissões"
        description="O que o Claude Code faz sozinho nas execuções sem agente. Os agentes seguem a autonomia deles."
      >
        <ChoiceCards
          label="Permissões"
          columns={1}
          value={prefs?.autonomy ?? 'edits'}
          disabled={prefs === null}
          options={AUTONOMY_OPTIONS}
          onChange={(autonomy) => void save({ autonomy })}
        />
      </SettingsGroup>

      <SettingsGroup
        title="Projetos"
        description="As pastas que o Orkio acompanha neste computador."
      >
        <SettingRow label="Ativos" description="No quadro, nas automações e na lista lateral.">
          <span className="tabular text-sm text-foreground" data-testid="projects-active">
            {projects === null ? '…' : active}
          </span>
        </SettingRow>
        <SettingRow label="Arquivados" description="Guardados, sem automações nem tarefas na tela.">
          <span className="tabular text-sm text-foreground" data-testid="projects-archived">
            {projects === null ? '…' : archived}
          </span>
        </SettingRow>
        <SettingRow label="Gerenciar" description="Adicionar, arquivar e remover projetos.">
          <Button size="sm" variant="outline" onClick={() => onOpenSection('projects')}>
            Abrir Projetos
          </Button>
        </SettingRow>
      </SettingsGroup>

      <RememberedRules />

      <SettingsGroup
        title="Privacidade"
        description="O que fica neste computador e o que sai dele."
      >
        <AlwaysRow
          label="Esconder senhas e chaves"
          help="Texto que parece senha, token ou chave de API vira •••• no log, na conversa e no diagnóstico. Os segredos conhecidos (tokens, Segredos, .env da tarefa) sempre somem."
        />
        <AlwaysRow
          label="Tokens cifrados neste computador"
          help="Os tokens do Notion e do GitHub ficam cifrados pelo sistema e nunca voltam para a tela."
        />
        <AlwaysRow
          label="Nada vai para o Orkio"
          help="Quadro, histórico, conversas e as pastas das tarefas ficam aqui. O que sai vai direto para o Notion, o GitHub e, pelo Claude Code, a Anthropic. O site do Orkio só entra no login e no bot de revisão."
        />
      </SettingsGroup>

      <UpdatesGroup onOpenSection={onOpenSection} />
    </div>
  )
}

/** Proteção que não se desliga: a linha diz "Sempre" em vez de um switch que não faz nada. */
function AlwaysRow({ label, help }: { label: string; help: string }): React.JSX.Element {
  return (
    <SettingRow label={label} help={help}>
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <LockIcon className="size-3.5 text-subtle-foreground" />
        Sempre
      </span>
    </SettingRow>
  )
}

/** Versão, estado da atualização, canal e o "Sobre" (site, privacidade, termos). */
function UpdatesGroup({
  onOpenSection
}: {
  onOpenSection(section: SettingsSection): void
}): React.JSX.Element {
  const { status, checking, check, setChannel } = useUpdates()
  const about = useIpcResource('', () => window.orkio.updates.about()).value
  const phase = status ? updatePhaseText(status) : null
  return (
    <SettingsGroup title="Atualizações e sobre">
      <SettingRow
        label="Orkio"
        description={
          status
            ? `Última verificação: ${status.lastCheckAt ? formatDateTime(status.lastCheckAt) : 'nunca'}`
            : 'Carregando…'
        }
      >
        <div className="flex flex-wrap items-center gap-3">
          {status && (
            <code className="rounded-sm border border-border px-1.5 font-mono text-2xs text-muted-foreground">
              {status.currentVersion}
            </code>
          )}
          {phase && <StatusToken {...phase} />}
          <Button
            size="sm"
            variant="outline"
            disabled={
              !status ||
              checking ||
              status.phase === 'checking' ||
              status.mode === 'disabled' ||
              status.phase === 'downloading'
            }
            onClick={() => void check()}
          >
            {(checking || status?.phase === 'checking') && <Spinner />}
            Procurar atualizações
          </Button>
        </div>
      </SettingRow>
      {status && (
        <SettingRow
          label="Canal"
          help="Beta recebe versões de teste antes de todo mundo e podem ter problemas. Estável só recebe versões testadas."
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
      )}
      <SettingRow
        label="Mais"
        description="Instalar quando terminar o que roda, energia e as novidades da versão."
      >
        <Button size="sm" variant="ghost" onClick={() => onOpenSection('updates')}>
          Abrir Atualizações
        </Button>
      </SettingRow>
      <SettingRow label="Links">
        {about?.links ? (
          <div className="flex flex-wrap gap-1">
            <LinkButton label="Site" url={about.links.site} />
            <LinkButton label="Privacidade" url={about.links.privacy} />
            <LinkButton label="Termos de uso" url={about.links.terms} />
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">Nas versões publicadas.</span>
        )}
      </SettingRow>
    </SettingsGroup>
  )
}

function LinkButton({ label, url }: { label: string; url: string }): React.JSX.Element {
  return (
    <Button size="sm" variant="ghost" onClick={() => void window.orkio.openExternal(url)}>
      {label}
      <ExternalLinkIcon className="size-3.5" />
    </Button>
  )
}

const ruleKey = (r: RememberedRule): string => JSON.stringify([r.projectId, r.tool, r.pattern])

/** "Sempre neste projeto" lembrados dos pedidos de permissão, com Revogar (confirmação na linha). */
function RememberedRules(): React.JSX.Element {
  const rules = useIpcResource('', async () =>
    unwrap(await ipcResult(() => window.orkio.prefs.rememberedRules()))
  )
  const [confirming, setConfirming] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const revoke = async (rule: RememberedRule): Promise<void> => {
    setBusy(true)
    const r = await ipcResult(() =>
      window.orkio.prefs.revokeRule(rule.projectId, { tool: rule.tool, pattern: rule.pattern })
    )
    setBusy(false)
    if (r.ok) {
      rules.set(r.value)
      setConfirming(null)
      setError(null)
    } else {
      setError(r.error.message)
    }
  }

  const list = rules.value
  return (
    <SettingsGroup
      bare
      title="Decisões lembradas"
      description="Quando você responde “Sempre neste projeto” a um pedido de permissão, o Orkio lembra. Revogar faz o Claude Code voltar a perguntar."
    >
      {(error ?? rules.error?.message) && (
        <Alert tone="danger">{error ?? rules.error?.message}</Alert>
      )}
      {list === null ? (
        !rules.error && <Skeleton className="h-16" aria-label="Carregando decisões" />
      ) : list.length === 0 ? (
        <div className="flex flex-col items-center gap-1 rounded-xl border border-dashed border-border-soft px-4 py-6 text-center">
          <p className="text-sm text-foreground">Nenhuma decisão lembrada ainda</p>
          <p className="text-xs text-muted-foreground">
            Quando você escolhe “Sempre neste projeto” num pedido, ela aparece aqui.
          </p>
        </div>
      ) : (
        <ul
          aria-label="Decisões lembradas"
          className="@container flex flex-col divide-y divide-border-soft rounded-xl border border-border-soft bg-card"
        >
          {list.map((rule) => {
            const key = ruleKey(rule)
            const asking = confirming === key
            return (
              <li
                key={key}
                aria-label={`${rule.tool} ${rule.pattern} em ${rule.projectName}`}
                className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-3 py-2.5"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-sm text-foreground">
                    <span className="font-mono text-xs">{rule.tool}</span>
                    {rule.pattern && (
                      <span className="ml-1.5 font-mono text-xs text-muted-foreground">
                        {rule.pattern}
                      </span>
                    )}
                  </span>
                  <span className="truncate text-xs text-subtle-foreground">
                    {rule.projectName} · {formatDateTime(rule.createdAt)}
                  </span>
                </div>
                {asking ? (
                  <div role="group" aria-label="Confirmar" className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Voltar a perguntar?</span>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={busy}
                      onClick={() => void revoke(rule)}
                    >
                      Revogar
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
                      Cancelar
                    </Button>
                  </div>
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => setConfirming(key)}>
                    Revogar
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </SettingsGroup>
  )
}
