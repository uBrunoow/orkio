/**
 * Regras puras da tela Skills: agrupar por origem, buscar e montar a lista completa de desligadas
 * (o main grava a lista inteira). Sem DOM.
 */
import type { SkillEntry } from '../../../../shared/preferences'
import { normalizeLabel } from '../../../../shared/text'

export interface SkillGroup {
  origin: string
  skills: SkillEntry[]
}

/** Grupos na ordem em que as origens aparecem, só com as skills que batem com a busca. */
export function groupSkills(skills: readonly SkillEntry[], query: string): SkillGroup[] {
  const q = normalizeLabel(query)
  const groups: SkillGroup[] = []
  for (const s of skills) {
    if (q && !normalizeLabel(`${s.name} ${s.description} ${s.origin}`).includes(q)) continue
    let group = groups.find((g) => g.origin === s.origin)
    if (!group) {
      group = { origin: s.origin, skills: [] }
      groups.push(group)
    }
    group.skills.push(s)
  }
  return groups
}

/**
 * Lista completa de desligadas depois de ligar (`enabled`) ou desligar `name`: as desligadas que
 * aparecem e as que sumiram (`missing`) continuam, sem repetir.
 */
export function nextDisabled(
  skills: readonly SkillEntry[],
  missing: readonly string[],
  name: string,
  enabled: boolean
): string[] {
  const current = [...skills.filter((s) => s.disabled).map((s) => s.name), ...missing]
  const without = current.filter((n) => n !== name)
  return [...new Set(enabled ? without : [...without, name])]
}

/** Estado de uma origem inteira: todas ligadas, todas desligadas ou parte. */
export function groupState(group: SkillGroup): 'on' | 'off' | 'partial' {
  const off = group.skills.filter((s) => s.disabled).length
  return off === 0 ? 'on' : off === group.skills.length ? 'off' : 'partial'
}

/** Lista completa de desligadas depois de ligar (`enabled`) ou desligar todas as `names`. */
export function nextDisabledMany(
  skills: readonly SkillEntry[],
  missing: readonly string[],
  names: readonly string[],
  enabled: boolean
): string[] {
  const set = new Set(names)
  const current = [...skills.filter((s) => s.disabled).map((s) => s.name), ...missing]
  const without = current.filter((n) => !set.has(n))
  return [...new Set(enabled ? without : [...without, ...names])]
}
