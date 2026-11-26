/**
 * Tela dos servidores (puro): rascunho do formulário ↔ cadastro, problemas por campo (as mesmas
 * regras do main, `serverProblems`) e o texto do estado de cada servidor da tarefa.
 */
import {
  DEFAULT_PORT_ENV,
  DEFAULT_SERVER_URL,
  serverProblems,
  type ServerDef,
  type ServerField,
  type ServerView
} from '../../../../shared/servers'
import type { StatusTone } from '../../components/StatusToken'

export interface ServerDraft {
  id: string
  name: string
  command: string
  cwd: string
  portEnv: string
  url: string
  /** Uma variável por linha: `NOME=valor`. */
  env: string
}

export function newServerId(random: () => number = Math.random): string {
  return `s-${Math.floor(random() * 36 ** 8)
    .toString(36)
    .padStart(8, '0')}`
}

export function emptyDraft(id: string): ServerDraft {
  return { id, name: '', command: '', cwd: '', portEnv: '', url: '', env: '' }
}

export function draftOf(def: ServerDef): ServerDraft {
  return {
    id: def.id,
    name: def.name,
    command: def.command,
    cwd: def.cwd ?? '',
    portEnv: def.portEnv ?? '',
    url: def.url ?? '',
    env: Object.entries(def.env ?? {})
      .map(([k, v]) => `${k}=${v}`)
      .join('\n')
  }
}

/** Linhas `NOME=valor` → objeto; `null` = alguma linha sem `=`. Linhas vazias não contam. */
export function parseEnvText(text: string): Record<string, string> | null {
  const out: Record<string, string> = {}
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const eq = line.indexOf('=')
    if (eq <= 0) return null
    out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim()
  }
  return out
}

export function defOf(d: ServerDraft): ServerDef {
  const def: ServerDef = { id: d.id, name: d.name.trim(), command: d.command.trim() }
  const cwd = d.cwd.trim().replace(/\/+$/, '')
  if (cwd && cwd !== '.') def.cwd = cwd
  const portEnv = d.portEnv.trim()
  if (portEnv && portEnv !== DEFAULT_PORT_ENV) def.portEnv = portEnv
  const url = d.url.trim()
  if (url && url !== DEFAULT_SERVER_URL) def.url = url
  const env = parseEnvText(d.env)
  if (env && Object.keys(env).length > 0) def.env = env
  return def
}

export type DraftProblems = Partial<Record<ServerField, string>>

/** Problemas do rascunho no meio do cadastro (`others` = os outros servidores, na ordem). */
export function draftProblems(d: ServerDraft, all: readonly ServerDef[]): DraftProblems {
  const out: DraftProblems = {}
  if (parseEnvText(d.env) === null) out.env = 'Uma variável por linha, no formato NOME=valor.'
  const index = all.findIndex((s) => s.id === d.id)
  const list = index >= 0 ? all.map((s, i) => (i === index ? defOf(d) : s)) : [...all, defOf(d)]
  const at = index >= 0 ? index : list.length - 1
  for (const p of serverProblems(list)) {
    if (p.index === at && out[p.field] === undefined) out[p.field] = p.message
  }
  return out
}

export function hasProblems(p: DraftProblems): boolean {
  return Object.keys(p).length > 0
}

/** Troca (ou acrescenta) o servidor no cadastro. */
export function withServer(all: readonly ServerDef[], def: ServerDef): ServerDef[] {
  return all.some((s) => s.id === def.id)
    ? all.map((s) => (s.id === def.id ? def : s))
    : [...all, def]
}

/** Uma linha com o que não é o padrão: pasta, variável da porta e o modelo da URL. */
export function serverDetails(def: ServerDef): string {
  return [
    def.cwd ? `pasta ${def.cwd}` : 'raiz do projeto',
    `porta em ${def.portEnv ?? DEFAULT_PORT_ENV}`,
    ...(def.env ? [`${Object.keys(def.env).length} variável(is)`] : [])
  ].join(' · ')
}

export function serverStateText(s: ServerView): { label: string; tone: StatusTone } {
  switch (s.state) {
    case 'starting':
      return { label: 'Subindo', tone: 'running' }
    case 'ready':
      return { label: 'Rodando', tone: 'success' }
    case 'no_port':
      return { label: 'Sem resposta na porta', tone: 'warning' }
    case 'exited':
      return {
        label: s.exitCode === null ? 'Parou sozinho' : `Parou sozinho (código ${s.exitCode})`,
        tone: 'danger'
      }
    case 'stopped':
      return { label: 'Parado', tone: 'neutral' }
  }
}
