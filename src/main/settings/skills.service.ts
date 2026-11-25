/**
 * Fase 4: skills que o Claude Code enxerga num projeto (as do usuário, as da pasta do projeto e as
 * dos plugins, pelo mesmo catálogo da 4B: só nome/descrição) e quais ficam desligadas nele. As
 * desligadas viram `Skill(nome)` no deny do `--settings` das execuções do Orkio no projeto
 * (`run-extras.ts`); no terminal do usuário nada muda.
 */
import { DomainError } from '../errors'
import type { ConfigStore } from '../storage/config-store'
import type { OrkioConfig } from '../config/orkio-config'
import { projectById } from '../config/queries'
import type { CatalogGroup } from '../../shared/agent-run'
import { parseSkillNames, type SkillEntry, type SkillsView } from '../../shared/preferences'

export class SkillsError extends DomainError {
  constructor(code: 'not_found' | 'invalid' | 'read_only', message: string) {
    super(code, message)
    this.name = 'SkillsError'
  }
}

export interface SkillsDeps {
  config: Pick<ConfigStore<OrkioConfig>, 'get' | 'update' | 'readOnly'>
  /** Catálogo do Claude Code (usuário, pasta do projeto, plugins). */
  catalog(projectDir: string): Promise<CatalogGroup[]>
}

const ORIGIN: Record<CatalogGroup['source'], string> = {
  user: 'Seu usuário',
  project: 'Deste projeto',
  plugin: 'Plugin'
}

export class SkillsService {
  constructor(private readonly deps: SkillsDeps) {}

  disabled(projectId: string): string[] {
    return this.deps.config.get().skillsDisabled?.[projectId] ?? []
  }

  async view(projectId: string): Promise<SkillsView> {
    const project = projectById(this.deps.config.get(), projectId)
    if (!project) throw new SkillsError('not_found', 'Projeto não encontrado.')
    const disabled = new Set(this.disabled(projectId))
    const groups = await this.deps.catalog(project.localPath).catch(() => [])
    const skills: SkillEntry[] = []
    for (const g of groups) {
      for (const c of g.commands) {
        if (c.kind !== 'skill' || skills.some((s) => s.name === c.name)) continue
        skills.push({
          name: c.name,
          description: c.description,
          source: g.source,
          origin: g.source === 'plugin' ? `${ORIGIN.plugin} ${g.title}` : ORIGIN[g.source],
          disabled: disabled.has(c.name)
        })
      }
    }
    const seen = new Set(skills.map((s) => s.name))
    return { skills, missing: [...disabled].filter((n) => !seen.has(n)) }
  }

  async setDisabled(projectId: string, names: string[]): Promise<SkillsView> {
    if (!projectById(this.deps.config.get(), projectId)) {
      throw new SkillsError('not_found', 'Projeto não encontrado.')
    }
    if (this.deps.config.readOnly) {
      throw new SkillsError('read_only', 'A configuração está em modo só leitura.')
    }
    const clean = parseSkillNames(names)
    if (!clean) throw new SkillsError('invalid', 'Lista de skills inválida.')
    await this.deps.config.update((c) => {
      const skillsDisabled = { ...(c.skillsDisabled ?? {}) }
      if (clean.length > 0) skillsDisabled[projectId] = clean
      else delete skillsDisabled[projectId]
      const next: OrkioConfig = { ...c, skillsDisabled }
      if (Object.keys(skillsDisabled).length === 0) delete next.skillsDisabled
      return next
    })
    return this.view(projectId)
  }
}
