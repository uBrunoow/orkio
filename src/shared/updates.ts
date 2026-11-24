/**
 * Atualizações automáticas (Etapa 6C): tipos do status mostrado ao renderer e funções puras
 * (versões, recorte do CHANGELOG, notas em blocos simples, URL do DMG). Sem Node/DOM.
 */
import { changelogNotes } from './changelog.mjs'
import { artifactFileName, macDmg } from './release-artifacts.mjs'

/** Repositório público do Orkio, onde ficam os releases (6B); o `publish` do `electron-builder.ts` lê daqui. */
export const RELEASES_REPO = { owner: 'uBrunoow', repo: 'orkio' } as const

export const UPDATE_CHANNELS = ['stable', 'beta'] as const
export type UpdateChannel = (typeof UPDATE_CHANNELS)[number]

/**
 * - `auto`: Windows e macOS assinado (baixa em segundo plano, instala ao sair ou ao reiniciar).
 * - `manual`: macOS sem assinatura (o Squirrel.Mac recusa): só avisa e abre o DMG no navegador.
 * - `disabled`: app não empacotado ou Linux.
 */
export type UpdateMode = 'auto' | 'manual' | 'disabled'

export type UpdatePhase = 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error'

/** Algo que impede reiniciar agora (o app nunca reinicia por cima disso sem a pessoa escolher). */
export interface BusyItem {
  kind: 'claude' | 'flow' | 'notion'
  label: string
}

export interface UpdateStatus {
  mode: UpdateMode
  phase: UpdatePhase
  currentVersion: string
  channel: UpdateChannel
  /** Versão encontrada (disponível, baixando ou baixada). */
  version: string | null
  /** 0–100 durante o download. */
  progress: number | null
  lastCheckAt: string | null
  /** Erro amigável da última verificação (pt-BR). */
  error: string | null
  /** "Atualizar quando terminar" escolhido: instala assim que tudo ficar ocioso. */
  installWhenIdle: boolean
  /** O que está rodando (preenchido enquanto espera ficar ocioso). */
  busy: BusyItem[]
  /** Aviso do canal (ex.: voltou para Estável numa beta mais nova). */
  channelNote: string | null
}

export const UPDATE_INSTALL_MODES = ['if_idle', 'now', 'when_idle', 'cancel_wait'] as const
export type UpdateInstallMode = (typeof UPDATE_INSTALL_MODES)[number]

export type UpdateInstallResult =
  | { state: 'installing' }
  | { state: 'busy'; busy: BusyItem[] }
  | { state: 'waiting'; busy: BusyItem[] }
  | { state: 'cancelled' }
  | { state: 'unavailable'; message: string }

export interface ReleaseNotes {
  version: string
  notes: string
}

// ---------- Versões ----------

interface ParsedVersion {
  core: [number, number, number]
  pre: (string | number)[]
}

export function parseVersion(value: string): ParsedVersion | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(value.trim())
  if (!m) return null
  const pre = m[4] ? m[4].split('.').map((p) => (/^\d+$/.test(p) ? Number(p) : p)) : []
  return { core: [Number(m[1]), Number(m[2]), Number(m[3])], pre }
}

/** Compara versões semver (com pré-release). Inválida conta como menor que qualquer válida. */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  if (!pa || !pb) return pa ? 1 : pb ? -1 : 0
  for (let i = 0; i < 3; i++) {
    const d = pa.core[i]! - pb.core[i]!
    if (d !== 0) return Math.sign(d)
  }
  if (pa.pre.length === 0 || pb.pre.length === 0)
    return pa.pre.length === 0 ? (pb.pre.length === 0 ? 0 : 1) : -1
  for (let i = 0; i < Math.max(pa.pre.length, pb.pre.length); i++) {
    const x = pa.pre[i]
    const y = pb.pre[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    if (x === y) continue
    if (typeof x === 'number' && typeof y === 'number') return Math.sign(x - y)
    if (typeof x === 'number') return -1
    if (typeof y === 'number') return 1
    return x < y ? -1 : 1
  }
  return 0
}

export function isPrerelease(version: string): boolean {
  return (parseVersion(version)?.pre.length ?? 0) > 0
}

// ---------- CHANGELOG ----------

/**
 * Seção de uma versão no CHANGELOG (`## [X.Y.Z] - AAAA-MM-DD`; leitor único em `changelog.ts`, o
 * mesmo das notas do release). Seção vazia ou ausente → `null`.
 */
export function changelogSection(markdown: string, version: string): string | null {
  return changelogNotes(markdown, version.replace(/^v/, '')) || null
}

/** Blocos simples para mostrar as notas com componentes (nada de HTML). */
export type NoteBlock =
  | { type: 'heading'; text: string }
  | { type: 'item'; text: string }
  | { type: 'paragraph'; text: string }

export function noteBlocks(markdown: string): NoteBlock[] {
  const blocks: NoteBlock[] = []
  let paragraph: string[] = []
  const flush = (): void => {
    if (paragraph.length > 0) blocks.push({ type: 'paragraph', text: paragraph.join(' ') })
    paragraph = []
  }
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) {
      flush()
      continue
    }
    const heading = /^#{1,6}\s+(.*)$/.exec(line)
    const item = /^(?:[-*+]|\d+\.)\s+(.*)$/.exec(line)
    if (heading) {
      flush()
      blocks.push({ type: 'heading', text: plainInline(heading[1]!) })
    } else if (item) {
      flush()
      blocks.push({ type: 'item', text: plainInline(item[1]!) })
    } else {
      paragraph.push(plainInline(line))
    }
  }
  flush()
  return blocks.filter((b) => b.text.length > 0)
}

/** Tira a marcação em linha (negrito, código, links → texto). */
function plainInline(text: string): string {
  return text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/(^|\s)[*_]([^*_]+)[*_](?=\s|$|[.,;:!?])/g, '$1$2')
    .trim()
}

// ---------- Download manual (macOS sem assinatura) ----------

/**
 * URL do DMG da arquitetura no repo de releases: o nome vem do manifesto (`release-artifacts.mts`)
 * e precisa estar em `files` (do `latest-mac.yml`). Sem ele: a página do release.
 */
export function macDownloadUrl(version: string, files: readonly string[], arch: string): string {
  const { owner, repo } = RELEASES_REPO
  const tag = `v${version.replace(/^v/, '')}`
  const base = `https://github.com/${owner}/${repo}/releases`
  const dmg = macDmg(arch)
  const name = dmg ? artifactFileName(dmg, version) : null
  const names = files.map((f) => f.split('/').pop() ?? '')
  if (!name || !names.includes(name) || !parseVersion(tag)) {
    return `${base}/tag/${encodeURIComponent(tag)}`
  }
  return `${base}/download/${tag}/${name}`
}

/** Allowlist do shell: só downloads e páginas de versão do repo público de releases. */
export const RELEASES_PATH_PATTERN = new RegExp(
  `^/${RELEASES_REPO.owner}/${RELEASES_REPO.repo}/releases/(download/v[0-9A-Za-z.-]+/[A-Za-z0-9._-]+\\.dmg|tag/v[0-9A-Za-z.-]+)$`
)

// ---------- Erros ----------

/** Mensagem amigável para falhas do feed (nunca a exceção crua, que pode ter URLs). */
export function friendlyUpdateError(error: unknown): string {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error)
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code: unknown }).code)
      : ''
  if (
    /ERR_INTERNET_DISCONNECTED|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ERR_NAME_NOT_RESOLVED|net::/i.test(
      `${code} ${text}`
    )
  )
    return 'Sem conexão com o GitHub. O Orkio tenta de novo mais tarde.'
  if (
    /No published versions|Unable to find latest version|latest.*\.yml.*(404|not found)|HttpError: 404/i.test(
      text
    )
  )
    return 'Ainda não há versão publicada para este canal.'
  if (/rate limit|HttpError: 403|HttpError: 429/i.test(text))
    return 'O GitHub limitou as consultas agora. O Orkio tenta de novo mais tarde.'
  if (/sha512 checksum mismatch|signature|code sign/i.test(text))
    return 'O arquivo baixado não passou na verificação. O Orkio tenta de novo mais tarde.'
  return 'Não foi possível procurar atualizações agora. O Orkio tenta de novo mais tarde.'
}

/** Configurações > Sobre. Links do site só se o build souber o endereço. */
export interface AboutInfo {
  version: string
  links: { site: string; privacy: string; terms: string } | null
}
