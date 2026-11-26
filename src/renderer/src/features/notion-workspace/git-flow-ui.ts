/** Regras puras da seção "Fluxo Git (opcional)" (`GitFlowSection.tsx`). */
import type { GitFlowConfig, GitFlowSetup } from '../../../../shared/git-flow'
import type { NotionColor } from '../../../../shared/notion'

/** Propriedades que podem ser a Etapa Git (seleção ou status). */
export function stageCandidates(setup: GitFlowSetup): GitFlowSetup['properties'] {
  return setup.properties.filter((p) => p.type === 'select' || p.type === 'status')
}

/**
 * O que a seção mostra fora da edição: `loading` (sem dados ainda), `no_property` (nada salvo e o
 * banco não tem seleção/status: só o aviso, sem botão que leve a um formulário vazio) ou `ready`.
 */
export function gitFlowEntry(
  setup: GitFlowSetup | null,
  saved: GitFlowConfig | null
): 'loading' | 'no_property' | 'ready' {
  if (saved) return 'ready'
  if (!setup) return 'loading'
  return stageCandidates(setup).length === 0 ? 'no_property' : 'ready'
}

/** Cor da opção salva no schema atual; `null` se ainda não se sabe (sem dados ou opção sumiu). */
export function savedOptionColor(
  setup: GitFlowSetup | null,
  config: GitFlowConfig,
  optionId: string
): NotionColor | null {
  const prop = setup?.properties.find((p) => p.id === config.stage.id)
  return prop?.options?.find((o) => o.id === optionId)?.color ?? null
}
