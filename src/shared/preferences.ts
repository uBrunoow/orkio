/**
 * Fase 4: preferências do app que o main aplica (Configurações › Geral, Notificações, Atalhos,
 * Skills). Ficam na config não secreta (campos opcionais, sem migração). Puro: sem Node/DOM.
 */
import { isEffort, isModelName, type Effort } from './agent-runtime'
import { isRecord } from './guards'

/** Como o Claude Code trabalha nas execuções sem agente (os agentes têm a própria autonomia). */
export const DEFAULT_AUTONOMIES = ['edits', 'ask', 'read_only'] as const
export type DefaultAutonomy = (typeof DEFAULT_AUTONOMIES)[number]

/** Atalho global para trazer o Orkio para a frente (lista fechada: nada de acelerador livre). */
export const GLOBAL_SHORTCUTS = [
  'CommandOrControl+Shift+O',
  'CommandOrControl+Alt+O',
  'CommandOrControl+Shift+Space'
] as const
export type GlobalShortcut = (typeof GLOBAL_SHORTCUTS)[number]

export interface NotificationPrefs {
  /** Aviso do sistema (pedido de aprovação, pergunta, regra com aviso). */
  system: boolean
  /** Com som. */
  sound: boolean
  /** Projetos sem aviso do sistema (o sino continua contando). */
  muted: string[]
}

export interface AppPreferences {
  autonomy: DefaultAutonomy
  /** Padrão das sessões sem agente nem escolha na mensagem (`null` = do Claude Code). */
  model: string | null
  effort: Effort | null
  notifications: NotificationPrefs
  /** `null` = desligado. */
  globalShortcut: GlobalShortcut | null
}

export const DEFAULT_PREFERENCES: AppPreferences = {
  autonomy: 'edits',
  model: null,
  effort: null,
  notifications: { system: true, sound: true, muted: [] },
  globalShortcut: null
}

const PROJECT_ID = /^[A-Za-z0-9-]{1,100}$/

/** Preferências lidas da config ou vindas do renderer; campo inválido volta ao padrão. */
export function parsePreferences(value: unknown): AppPreferences {
  const v = isRecord(value) ? value : {}
  const n = isRecord(v['notifications']) ? v['notifications'] : {}
  const muted = Array.isArray(n['muted'])
    ? [
        ...new Set(
          n['muted'].filter((p): p is string => typeof p === 'string' && PROJECT_ID.test(p))
        )
      ].slice(0, 200)
    : []
  return {
    autonomy: (DEFAULT_AUTONOMIES as readonly unknown[]).includes(v['autonomy'])
      ? (v['autonomy'] as DefaultAutonomy)
      : 'edits',
    model: isModelName(v['model']) && v['model'] !== 'default' ? v['model'] : null,
    effort: isEffort(v['effort']) ? v['effort'] : null,
    notifications: {
      system: n['system'] !== false,
      sound: n['sound'] !== false,
      muted
    },
    globalShortcut: (GLOBAL_SHORTCUTS as readonly unknown[]).includes(v['globalShortcut'])
      ? (v['globalShortcut'] as GlobalShortcut)
      : null
  }
}

/** Mudança vinda da tela: só a forma; o main junta com o atual e passa por `parsePreferences`. */
export function isPreferencesPatch(value: unknown): value is Partial<AppPreferences> {
  if (!isRecord(value)) return false
  const known = new Set(['autonomy', 'model', 'effort', 'notifications', 'globalShortcut'])
  return Object.keys(value).every((k) => known.has(k))
}

/** Decisão "sempre neste projeto" lembrada de um pedido de permissão. */
export interface RememberedRule {
  projectId: string
  projectName: string
  tool: string
  pattern: string
  createdAt: string
}

/** Skill que o Claude Code enxerga, com o estado no projeto. */
export interface SkillEntry {
  name: string
  description: string
  source: 'user' | 'project' | 'plugin'
  /** Grupo da origem (ex.: "Seu usuário", "Plugin alva-flow"). */
  origin: string
  disabled: boolean
}

export interface SkillsView {
  skills: SkillEntry[]
  /** Desligadas que não apareceram na lista (removidas/renomeadas): continuam negadas. */
  missing: string[]
}

/** Nome de skill aceito para negar (`Skill(nome)` nas regras do CLI). */
export const SKILL_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,99}$/
export const SKILLS_DISABLED_MAX = 200

export function isSkillName(value: unknown): value is string {
  return typeof value === 'string' && SKILL_NAME_PATTERN.test(value)
}

export function parseSkillNames(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > SKILLS_DISABLED_MAX) return null
  if (!value.every(isSkillName)) return null
  return [...new Set(value)]
}

/** Uso do disco do Orkio (Diagnóstico). */
export interface StorageUsage {
  runsBytes: number
  runsCount: number
  /** Execuções guardadas por tarefa (as mais antigas saem). */
  runsKeptPerTask: number
  worktrees: number
  agentMemoryBytes: number
}
