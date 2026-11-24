/** Perguntas à config com nome (uma regra só para quem pergunta a mesma coisa). */
import type { ProjectFlows } from '../../shared/task-flow'
import type { OrkioConfig, StoredProject } from './orkio-config'

export function projectById(config: OrkioConfig, projectId: string): StoredProject | null {
  return config.projects.find((p) => p.id === projectId) ?? null
}

/** Projetos que as automações acompanham: vinculados a um projeto do Notion e com quadro. */
export function automationProjectIds(config: OrkioConfig): string[] {
  return config.projects.filter((p) => p.notionProject && config.boards[p.id]).map((p) => p.id)
}

/** Fluxos de tarefa do projeto (5A): `flows[projectId]` ou vazio. Leitura padrão. */
export function projectFlows(config: OrkioConfig, projectId: string): ProjectFlows {
  return config.flows[projectId] ?? { flows: [], bindings: [] }
}

/**
 * Único escritor de `flows[projectId]` (fluxos e ligações etapa → fluxo): a config com `next` no
 * lugar, sem ligação inválida. Uma ligação vale só para fluxo que existe, etapa que existe (com o
 * quadro criado) e uma por etapa (a primeira). Quem muda o quadro e os fluxos juntos passa aqui a
 * config já com o quadro novo.
 */
export function withProjectFlows(
  config: OrkioConfig,
  projectId: string,
  next: ProjectFlows
): OrkioConfig {
  const flowIds = new Set(next.flows.map((f) => f.id))
  const stages = config.boards[projectId]?.stages
  const bindings = next.bindings.filter(
    (b, i, all) =>
      flowIds.has(b.flowId) &&
      (!stages || stages.some((s) => s.id === b.stageId)) &&
      all.findIndex((x) => x.stageId === b.stageId) === i
  )
  return { ...config, flows: { ...config.flows, [projectId]: { ...next, bindings } } }
}
