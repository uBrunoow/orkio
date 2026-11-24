/**
 * Runtime do agente (modelo e raciocínio do Claude Code): tipos, validação e rótulos. Puro: usado
 * no main (montar a linha de `--model`/`--effort`) e no renderer (seletores e rótulos).
 *
 * - `model` vazio/`default` = não passa `--model` (o padrão do usuário no Claude Code).
 * - `effort` `null` = não passa `--effort`. A flag só vai quando o CLI instalado suporta
 *   (versão ≥ `CLAUDE_EFFORT_VERSION`); essa checagem é do main.
 */

export type AgentRuntimeId = 'claude'

export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
export type Effort = (typeof EFFORTS)[number]

export const EFFORT_LABELS: Record<Effort, string> = {
  low: 'Baixo',
  medium: 'Médio',
  high: 'Alto',
  xhigh: 'Muito alto',
  max: 'Máximo'
}

/** Modelos sugeridos no seletor; qualquer nome que passe `isModelName` também vale. */
export const CLAUDE_MODELS: readonly { id: string; label: string }[] = [
  { id: 'default', label: 'Padrão do Claude Code' },
  { id: 'fable', label: 'Fable' },
  { id: 'opus', label: 'Opus' },
  { id: 'sonnet', label: 'Sonnet' },
  { id: 'haiku', label: 'Haiku' }
]

/** Versão mínima do CLI `claude` que aceita `--effort`. */
export const CLAUDE_EFFORT_VERSION = '2.1.300'

/** Tamanho máximo do nome do modelo (a regex e o IPC usam o mesmo número). */
export const MODEL_NAME_MAX = 61
const MODEL_NAME = new RegExp(`^[a-z][a-z0-9.\\-[\\]]{0,${MODEL_NAME_MAX - 1}}$`)

/** Maior nome de raciocínio (o IPC confere a forma antes do `validateAgent`). */
export const EFFORT_NAME_MAX = Math.max(...EFFORTS.map((e) => e.length))

export interface RuntimeChoice {
  /** `null` = não passa `--model`. */
  model: string | null
  /** `null` = não passa `--effort`. */
  effort: Effort | null
}

export function isModelName(v: unknown): v is string {
  return typeof v === 'string' && MODEL_NAME.test(v)
}

export function isEffort(v: unknown): v is Effort {
  return typeof v === 'string' && (EFFORTS as readonly string[]).includes(v)
}

/**
 * Junta camadas (a mais específica primeiro). Em cada campo vence o primeiro valor definido
 * (≠ `undefined`; `null` também conta). `'default'` vira `null`.
 */
export function resolveRuntime(
  ...layers: (Partial<RuntimeChoice> | null | undefined)[]
): RuntimeChoice {
  let model: string | null = null
  let effort: Effort | null = null
  let modelSet = false
  let effortSet = false
  for (const layer of layers) {
    if (!layer) continue
    if (!modelSet && layer.model !== undefined) {
      model = layer.model
      modelSet = true
    }
    if (!effortSet && layer.effort !== undefined) {
      effort = layer.effort
      effortSet = true
    }
  }
  return {
    model: model === 'default' ? null : model,
    effort
  }
}

export function runtimeLabel(c: RuntimeChoice): string {
  const modelPart =
    c.model === null
      ? 'Padrão do Claude Code'
      : (CLAUDE_MODELS.find((m) => m.id === c.model)?.label ?? c.model)
  return c.effort ? `${modelPart} · ${EFFORT_LABELS[c.effort]}` : modelPart
}
