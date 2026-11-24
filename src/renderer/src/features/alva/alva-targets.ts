/**
 * Colunas sugeridas na tela alva-flow para cada modelo (puro). O modelo já ligado fica na coluna
 * dele; senão, a coluna pelo papel (`role`), só se ela não tiver fluxo ligado ("Recriar fluxos Alva" troca a
 * ligação da coluna escolhida, então a sugestão nunca aponta para a de outro fluxo).
 */
import { ALVA_TEMPLATE_IDS } from '../../../../shared/alva-templates'
import { stageWithRole, type StageRole } from '../../../../shared/board'

export interface AlvaTargets {
  plan: string | null
  deliver: string | null
  review: string | null
  reviewed: string | null
}

const BY_ROLE: Record<keyof AlvaTargets, StageRole> = {
  plan: 'plan',
  deliver: 'work',
  review: 'review',
  reviewed: 'reviewed'
}

export function suggestAlvaTargets(
  stages: readonly { id: string; name: string; role?: StageRole | undefined }[],
  status: {
    templates: readonly { id: string; stageId: string | null }[]
    boundStages: readonly string[]
  } | null
): AlvaTargets {
  const pick = (key: keyof AlvaTargets): string | null => {
    const current = status?.templates.find((t) => t.id === ALVA_TEMPLATE_IDS[key])
    if (current?.stageId && stages.some((s) => s.id === current.stageId)) return current.stageId
    const stage = stageWithRole(stages, BY_ROLE[key])
    if (!stage) return null
    return status?.boundStages.includes(stage) ? null : stage
  }
  return {
    plan: pick('plan'),
    deliver: pick('deliver'),
    review: pick('review'),
    reviewed: pick('reviewed')
  }
}
