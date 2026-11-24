/**
 * v11 → v12: projetos com os modelos Alva ganham os modelos que faltam ("Alva: revisão
 * publicada"), as cópias antigas dos modelos (mesmo id) viram a versão da v12 (guardando antes a
 * cópia atual como `<id>-anterior`, "<nome> (cópia anterior)", sem coluna) e Revisando/Revisado
 * ganham os fluxos padrão só se a coluna não tiver fluxo ligado. Fluxos e ligações do usuário
 * nunca mudam. Modelos e regras CONGELADOS na versão da v12 (`v11-alva-templates.json`): mudar os
 * modelos de hoje não muda esta migração ("Recriar fluxos Alva" é o caminho para os atuais).
 */
import { isRecord, rawStages, stageIdByName } from './frozen'
import V12_ALVA_TEMPLATES from './v11-alva-templates.json'

type RawFlow = Record<string, unknown> & { id: string; name: string }
type RawBinding = Record<string, unknown> & { stageId: string; flowId: string }

export interface AlvaMigrationNote {
  projectId: string
  changes: string[]
}

const TEMPLATES = V12_ALVA_TEMPLATES as unknown as readonly RawFlow[]
const TEMPLATE_IDS = new Set(TEMPLATES.map((t) => t.id))
const DEFAULT_STAGES: readonly { flowId: string; stage: string }[] = [
  { flowId: 'alva-revisao', stage: 'Revisando' },
  { flowId: 'alva-revisado', stage: 'Revisado' }
]

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

function freeId(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base
  let n = 2
  while (taken.has(`${base}-${n}`)) n++
  return `${base}-${n}`
}

function upgrade(
  pf: Record<string, unknown> & { flows: RawFlow[]; bindings: RawBinding[] },
  stages: readonly { id: string; name: string }[]
): { flows: Record<string, unknown>; changes: string[] } | null {
  if (!pf.flows.some((f) => TEMPLATE_IDS.has(f.id))) return null
  const changes: string[] = []
  const byId = new Map(TEMPLATES.map((t) => [t.id, t]))
  const flows: RawFlow[] = []
  const backups: RawFlow[] = []
  const taken = new Set(pf.flows.map((f) => f.id))
  for (const f of pf.flows) {
    const t = byId.get(f.id)
    if (!t || stableJson(t) === stableJson(f)) {
      flows.push(f)
      continue
    }
    const backup = {
      ...f,
      id: freeId(`${f.id}-anterior`, taken),
      name: `${f.name} (cópia anterior)`
    }
    taken.add(backup.id)
    backups.push(backup)
    changes.push(
      `Cópia anterior de “${f.name}” guardada como “${backup.name}” (sem coluna)`,
      `Fluxo “${t.name}” atualizado para a versão nova do modelo Alva`
    )
    flows.push(structuredClone(t))
  }
  flows.push(...backups)
  for (const t of TEMPLATES) {
    if (!flows.some((f) => f.id === t.id)) {
      flows.push(structuredClone(t))
      changes.push(`Fluxo “${t.name}” criado (modelo Alva)`)
    }
  }
  const bindings: RawBinding[] = [...pf.bindings]
  for (const d of DEFAULT_STAGES) {
    const stageId = stageIdByName(stages, d.stage)
    if (!stageId) continue
    if (bindings.some((b) => b.stageId === stageId || b.flowId === d.flowId)) continue
    bindings.push({ stageId, flowId: d.flowId, enabled: true, mode: 'on_enter' })
    const name = byId.get(d.flowId)?.name ?? d.flowId
    const stage = stages.find((s) => s.id === stageId)?.name ?? d.stage
    changes.push(`Coluna “${stage}” ganhou o fluxo “${name}” (ao entrar)`)
  }
  return changes.length > 0 ? { flows: { ...pf, flows, bindings }, changes } : null
}

/** Sobre os dados crus (o `validateConfig` normaliza depois). */
export function migrateV11(
  data: Record<string, unknown>,
  onNote?: (note: AlvaMigrationNote) => void
): Record<string, unknown> {
  const rawFlows = data['flows']
  if (!isRecord(rawFlows)) return data
  const boards = isRecord(data['boards']) ? data['boards'] : {}
  const flows: Record<string, unknown> = {}
  for (const [projectId, raw] of Object.entries(rawFlows)) {
    flows[projectId] = raw
    if (!isRecord(raw) || !Array.isArray(raw['flows']) || !Array.isArray(raw['bindings'])) continue
    const pfFlows = raw['flows'].filter(
      (f): f is RawFlow => isRecord(f) && typeof f['id'] === 'string'
    )
    const pfBindings = raw['bindings'].filter(
      (b): b is RawBinding =>
        isRecord(b) && typeof b['stageId'] === 'string' && typeof b['flowId'] === 'string'
    )
    // Itens sem id ficam como estavam (o validateConfig decide); só os reconhecíveis mudam.
    if (pfFlows.length !== raw['flows'].length || pfBindings.length !== raw['bindings'].length) {
      continue
    }
    const r = upgrade(
      { ...raw, flows: pfFlows, bindings: pfBindings },
      rawStages(boards[projectId])
    )
    if (!r) continue
    flows[projectId] = r.flows
    onNote?.({ projectId, changes: r.changes })
  }
  return { ...data, flows }
}
