/**
 * "Como deve rodar?" (Fase 1): a configuração de execução de uma tarefa. A coluna dá o padrão
 * (`orkio-config.runSetup[projeto][etapa]`), a tarefa troca o que quiser (SQLite
 * `task_run_setup`), e o que não foi escolhido em nenhum dos dois vem do Orkio. Quem implementa é
 * o agente atribuído à tarefa (8A, com a regra da coluna de lá); aqui ficam o modo, o modelo, quem
 * revisa e o pedido de evidência.
 *
 * Puro (main e renderer): tipos, textos, validação e a resolução "herdado da coluna X".
 */
import { parseAgentKey, type AgentKey } from './agent'
import { isModelName } from './agent-runtime'
import { BUILTIN_AGENT_KEYS } from './agent-presets'
import { isRecord } from './guards'

export const RUN_MODES = ['quick', 'approval', 'steps'] as const
export type RunMode = (typeof RUN_MODES)[number]

export function isRunMode(v: unknown): v is RunMode {
  return typeof v === 'string' && (RUN_MODES as readonly string[]).includes(v)
}

/** Primeira linha em linguagem comum; `steps` é o termo técnico um passo mais fundo. */
export const RUN_MODE_TEXT: Record<RunMode, { label: string; phrase: string; steps: string }> = {
  quick: {
    label: 'Rodar uma vez',
    phrase: 'O Claude faz, você confere o diff e a PR sai. Bom para quase tudo.',
    steps: 'Implementa → revisão → você confere o diff → push e PR'
  },
  approval: {
    label: 'Com aprovação',
    phrase: 'A spec e o plano passam por você antes de mexer no código.',
    steps: 'Spec → sua aprovação → plano → sua aprovação → implementa → revisão → diff → PR'
  },
  steps: {
    label: 'Quebrar em passos',
    phrase: 'Um objetivo grande vira fatias pequenas, feitas uma de cada vez.',
    steps: 'Plano em fatias → sua aprovação → uma fatia por vez → revisão → diff → PR'
  }
}

/** Revisor "ninguém": a tarefa roda sem o passo de revisão. */
export const NO_REVIEWER = 'none'

/**
 * O que a coluna ou a tarefa escolheu. Campo ausente = herda (da coluna, depois do Orkio).
 * `reviewer: 'none'` = sem revisão.
 */
export interface RunSetup {
  mode?: RunMode
  /** Modelo de quem implementa (vence o do agente; o passo com modelo próprio vence este). */
  model?: string
  reviewer?: AgentKey | typeof NO_REVIEWER
  evidence?: boolean
}

export const RUN_SETUP_FIELDS = ['mode', 'model', 'reviewer', 'evidence'] as const
export type RunSetupField = (typeof RUN_SETUP_FIELDS)[number]

/** Valores resolvidos (`null` = nada escolhido em lugar nenhum). */
export interface ResolvedRunSetup {
  mode: RunMode | null
  model: string | null
  reviewer: AgentKey | null
  evidence: boolean
}

export type SetupOrigin = 'task' | 'column' | 'app'

export interface EffectiveRunSetup {
  values: ResolvedRunSetup
  from: Record<RunSetupField, SetupOrigin>
}

/** Padrão do Orkio: revisão pelo Revisor embutido, sem evidência, modelo do agente. */
export const APP_RUN_SETUP: ResolvedRunSetup = {
  mode: null,
  model: null,
  reviewer: BUILTIN_AGENT_KEYS.reviewer,
  evidence: false
}

export function resolveRunSetup(
  task: RunSetup | null | undefined,
  column: RunSetup | null | undefined
): EffectiveRunSetup {
  const pick = <K extends RunSetupField>(
    key: K
  ): { value: RunSetup[K] | undefined; from: SetupOrigin } => {
    if (task?.[key] !== undefined) return { value: task[key], from: 'task' }
    if (column?.[key] !== undefined) return { value: column[key], from: 'column' }
    return { value: undefined, from: 'app' }
  }
  const mode = pick('mode')
  const model = pick('model')
  const reviewer = pick('reviewer')
  const evidence = pick('evidence')
  return {
    values: {
      mode: mode.value ?? APP_RUN_SETUP.mode,
      model: model.value ?? APP_RUN_SETUP.model,
      reviewer: reviewer.value === NO_REVIEWER ? null : (reviewer.value ?? APP_RUN_SETUP.reviewer),
      evidence: evidence.value ?? APP_RUN_SETUP.evidence
    },
    from: { mode: mode.from, model: model.from, reviewer: reviewer.from, evidence: evidence.from }
  }
}

/** "Herdado da coluna X" / "Escolhido para esta tarefa" / "Padrão do Orkio". */
export function setupOriginText(from: SetupOrigin, columnName: string | null): string {
  switch (from) {
    case 'task':
      return 'Escolhido para esta tarefa'
    case 'column':
      return columnName ? `Herdado da coluna ${columnName}` : 'Herdado da coluna'
    case 'app':
      return 'Padrão do Orkio'
  }
}

/** O autor nunca revisa a si mesmo. */
export function reviewerProblem(
  implementer: AgentKey | null,
  reviewer: AgentKey | null
): string | null {
  if (implementer && reviewer && implementer === reviewer) {
    return 'Quem implementa não pode revisar o próprio trabalho. Escolha outro revisor.'
  }
  return null
}

/**
 * Configuração vinda do renderer ou do disco: só os campos conhecidos e válidos. `null` = algum
 * campo presente com valor inválido (o IPC recusa; a leitura da config descarta a coluna).
 */
export function parseRunSetup(v: unknown): RunSetup | null {
  if (!isRecord(v)) return null
  const out: RunSetup = {}
  if (v['mode'] !== undefined) {
    if (!isRunMode(v['mode'])) return null
    out.mode = v['mode']
  }
  if (v['model'] !== undefined) {
    if (!isModelName(v['model'])) return null
    out.model = v['model']
  }
  if (v['reviewer'] !== undefined) {
    if (v['reviewer'] !== NO_REVIEWER && !parseAgentKey(v['reviewer'])) return null
    out.reviewer = v['reviewer'] as string
  }
  if (v['evidence'] !== undefined) {
    if (typeof v['evidence'] !== 'boolean') return null
    out.evidence = v['evidence']
  }
  return out
}

/** Padrões por coluna de um projeto (`etapa → RunSetup`); entradas inválidas somem. */
export function parseColumnSetups(v: unknown): Record<string, RunSetup> {
  const out: Record<string, RunSetup> = {}
  if (!isRecord(v)) return out
  for (const [stageId, raw] of Object.entries(v).slice(0, 50)) {
    const setup = parseRunSetup(raw)
    if (stageId && setup && Object.keys(setup).length > 0) out[stageId] = setup
  }
  return out
}

/** O que roda quando a tarefa entra na coluna (ou em "Rodar agora"). */
export type SetupRuns =
  | { kind: 'native'; mode: RunMode }
  /** Fluxo ligado à coluna (5A/5B), ex.: um modelo Alva. */
  | { kind: 'column_flow'; flowId: string; name: string }
  /** Fluxo preferido do agente (8A), que substitui o da coluna. */
  | { kind: 'agent_flow'; flowId: string; name: string }

/** Tela da tarefa: a configuração, de onde vem cada item e o que vai rodar. */
export interface TaskSetupView {
  projectId: string
  taskId: string
  stage: { id: string; name: string } | null
  /** O que a tarefa trocou (o resto herda). */
  task: RunSetup
  /** Padrão da coluna atual. */
  column: RunSetup
  effective: EffectiveRunSetup
  /** Quem implementa: o agente atribuído (8A). `manual: false` = veio da regra da coluna. */
  implementer: { key: AgentKey; name: string; manual: boolean } | null
  runs: SetupRuns | null
  /** Com fluxo ativo a configuração fica travada (vale a cópia do início). */
  locked: boolean
  /** Conflito a resolver antes de rodar (ex.: o revisor é quem implementa). */
  problem: string | null
}

/** Padrões das colunas de um projeto (tela Tarefas › "Como as colunas rodam"). */
export interface ColumnSetupsView {
  projectId: string
  stages: {
    id: string
    name: string
    role: string | null
    setup: RunSetup
    /** Fluxo ligado à coluna (sem modo nativo, ele roda ao entrar). */
    flow: { id: string; name: string } | null
  }[]
}

export const TASK_SETUP_MESSAGES = {
  locked: 'Espere o fluxo atual terminar para mudar como a tarefa roda.',
  invalid: 'Configuração inválida.',
  noStage: 'Coluna não encontrada no quadro deste projeto.'
} as const
