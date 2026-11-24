/** Perguntas à config com nome (uma regra só para quem pergunta a mesma coisa). */
import type { OrkioConfig, StoredProject } from './orkio-config'

export function projectById(config: OrkioConfig, projectId: string): StoredProject | null {
  return config.projects.find((p) => p.id === projectId) ?? null
}

/** Projetos que as automações acompanham: vinculados a um projeto do Notion e com quadro. */
export function automationProjectIds(config: OrkioConfig): string[] {
  return config.projects.filter((p) => p.notionProject && config.boards[p.id]).map((p) => p.id)
}
