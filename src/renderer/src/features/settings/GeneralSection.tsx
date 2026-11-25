import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import type { DefaultAutonomy, RememberedRule } from '../../../../shared/preferences'
import { ChoiceCards, type ChoiceCard } from '../../components/ChoiceCards'
import { Alert } from '../../components/Alert'
import { PageHeader } from '../../components/PageHeader'
import { PAGE_WIDTH } from '../../components/page-width'
import { RuntimePicker, useSupportsEffort } from '../claude/RuntimePicker'
import { formatDateTime } from '../../lib/format'
import { ipcResult, unwrap, useIpcResource } from '../../lib/ipc'
import type { SettingsSection } from '../../app/routes'
import { SettingsCard } from './SettingsCard'
import { usePreferences } from './usePreferences'

const AUTONOMY_OPTIONS: readonly ChoiceCard<DefaultAutonomy>[] = [
  {
    value: 'edits',
    title: 'Edita sozinho na pasta da tarefa',
    phrase: 'Muda os arquivos da tarefa sem perguntar. O resto segue as regras de permissão.',
    hint: 'Modo de permissão do Claude Code: acceptEdits.'
  },
  {
    value: 'ask',
    title: 'Pergunta antes de editar',
    phrase: 'Cada mudança de arquivo espera você aprovar.',
    hint: 'Modo de permissão do Claude Code: manual (cada edição vira um pedido).'
  }
]

/** Configurações › Geral: padrões das execuções sem agente, decisões lembradas e privacidade. */
export function GeneralSection({
  onOpenSection
}: {
  onOpenSection(section: SettingsSection): void
}): React.JSX.Element {
  const { prefs, error, save } = usePreferences()
  const supportsEffort = useSupportsEffort()

  return (
    <div className={cn('flex flex-col gap-6', PAGE_WIDTH.form)}>
      <PageHeader
        title="Geral"
        subtitle="Como o Claude Code trabalha quando a tarefa não tem agente, e o que o Orkio guarda."
      />
      {error && <Alert tone="danger">{error}</Alert>}

      <SettingsCard
        title="Padrões de sessão"
        description="Modelo e raciocínio das execuções sem agente quando a mensagem não escolhe outro. Os agentes usam o que está no perfil deles."
      >
        {prefs === null ? (
          <Skeleton className="h-7 w-56" aria-label="Carregando" />
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <span id="default-runtime-label" className="text-sm text-foreground">
              Modelo padrão
            </span>
            <RuntimePicker
              value={{ model: prefs.model, effort: prefs.effort }}
              supportsEffort={supportsEffort}
              describedBy="default-runtime-label"
              className="border border-border"
              onChange={(next) =>
                void save({ model: next.model ?? null, effort: next.effort ?? null })
              }
            />
          </div>
        )}
      </SettingsCard>

      <SettingsCard
        title="Como o Claude Code trabalha sem agente"
        description="Só nas execuções sem agente. Os agentes seguem a autonomia do perfil deles."
      >
        <ChoiceCards
          label="Como o Claude Code trabalha sem agente"
          columns={2}
          value={prefs?.autonomy ?? 'edits'}
          disabled={prefs === null}
          options={AUTONOMY_OPTIONS}
          onChange={(autonomy) => void save({ autonomy })}
        />
      </SettingsCard>

      <RememberedRules />

      <SettingsCard title="Privacidade" description="O que fica neste computador e o que sai dele.">
        <ul className="flex list-disc flex-col gap-1.5 pl-4 text-sm text-foreground marker:text-subtle-foreground">
          <li>
            Os tokens do Notion e do GitHub ficam cifrados pelo sistema neste computador e nunca
            voltam para a tela.
          </li>
          <li>
            Quadro, histórico das tarefas, conversas com o Claude Code e as pastas das tarefas ficam
            só aqui.
          </li>
          <li>
            O Orkio não envia uso, conversas nem código para o Orkio. O que sai vai direto para os
            serviços que você conectou (Notion, GitHub e, pelo Claude Code, a Anthropic).
          </li>
          <li>O site do Orkio só entra no login das contas e no bot de revisão do GitHub.</li>
        </ul>
      </SettingsCard>

      <SettingsCard
        title="Atualizações"
        description="Canal, versão e quando o Orkio se atualiza ficam numa seção própria."
      >
        <Button variant="outline" className="self-start" onClick={() => onOpenSection('updates')}>
          Abrir Atualizações
        </Button>
      </SettingsCard>
    </div>
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
    <SettingsCard
      title="Decisões lembradas"
      description="Quando você responde “Sempre neste projeto” a um pedido de permissão, o Orkio lembra. Revogar faz o Claude Code voltar a perguntar."
    >
      {(error ?? rules.error?.message) && (
        <Alert tone="danger">{error ?? rules.error?.message}</Alert>
      )}
      {list === null ? (
        !rules.error && <Skeleton className="h-16" aria-label="Carregando decisões" />
      ) : list.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma decisão lembrada.</p>
      ) : (
        <ul
          aria-label="Decisões lembradas"
          className="@container flex flex-col divide-y divide-border-soft rounded-xl border border-border-soft"
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
    </SettingsCard>
  )
}
