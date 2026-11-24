/**
 * Lógica pura do `pnpm release` (Etapa 6B): próxima versão e CHANGELOG.
 * Testada em test/release.test.ts. Sem acesso a disco ou git (isso fica em release.mjs).
 *
 * CHANGELOG no formato Keep a Changelog, em pt-BR:
 *   ## [Não lançado]
 *   ## [X.Y.Z] - AAAA-MM-DD
 * O formato e o leitor das seções ficam em src/shared/changelog.mts (o mesmo do "O que há de novo"
 * do app); o Node roda os .mts direto (só tipos para tirar: nada de enum/namespace).
 */
import {
  CHANGELOG_UNRELEASED as UNRELEASED,
  changelogLines,
  changelogSectionRange as sectionRange
} from '../src/shared/changelog.mts'

export const BUMP_KINDS = ['patch', 'minor', 'major', 'beta'] as const
export type BumpKind = (typeof BUMP_KINDS)[number]

export interface Version {
  major: number
  minor: number
  patch: number
  beta: number | null
}

const isBumpKind = (v: string | undefined): v is BumpKind =>
  (BUMP_KINDS as readonly (string | undefined)[]).includes(v)

const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-beta\.(\d+))?$/

export function parseVersion(version: string): Version {
  const m = VERSION.exec(version)
  if (!m) throw new Error(`Versão inválida: "${version}" (esperado X.Y.Z ou X.Y.Z-beta.N).`)
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    beta: m[4] === undefined ? null : Number(m[4])
  }
}

/**
 * Próxima versão.
 * - patch/minor/major: versão estável. Saindo de um beta, o patch só "fecha" o beta
 *   (1.2.3-beta.2 → 1.2.3); minor/major fecham se o beta já for daquela forma (1.3.0-beta.1 → 1.3.0).
 * - beta: se já é beta, incrementa N; senão, próximo patch com -beta.1.
 * - `{ beta: true }` com patch/minor/major: a versão estável seguinte com -beta.1
 *   (ou N+1 se o beta atual já é dela).
 */
export function nextVersion(
  current: string,
  kind: BumpKind,
  options: { beta?: boolean } = {}
): string {
  if (!isBumpKind(kind)) {
    throw new Error(`Tipo inválido: "${kind}". Use patch, minor, major ou beta.`)
  }
  const v = parseVersion(current)
  const base = `${v.major}.${v.minor}.${v.patch}`
  if (kind === 'beta') {
    if (v.beta !== null) return `${base}-beta.${v.beta + 1}`
    return `${v.major}.${v.minor}.${v.patch + 1}-beta.1`
  }
  const stable = nextStable(v, kind)
  if (!options.beta) return stable
  if (v.beta !== null && stable === base) return `${base}-beta.${v.beta + 1}`
  return `${stable}-beta.1`
}

function nextStable(v: Version, kind: Exclude<BumpKind, 'beta'>): string {
  const pre = v.beta !== null
  if (kind === 'major') {
    return pre && v.minor === 0 && v.patch === 0 ? `${v.major}.0.0` : `${v.major + 1}.0.0`
  }
  if (kind === 'minor') {
    return pre && v.patch === 0 ? `${v.major}.${v.minor}.0` : `${v.major}.${v.minor + 1}.0`
  }
  return pre ? `${v.major}.${v.minor}.${v.patch}` : `${v.major}.${v.minor}.${v.patch + 1}`
}

/**
 * Data da versão no CHANGELOG (AAAA-MM-DD), no fuso local (não UTC: à noite no Brasil o UTC já é o
 * dia seguinte). A mesma no plano mostrado na PR e na versão gravada.
 */
export function releaseDate(now: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

export function isPrerelease(version: string): boolean {
  return parseVersion(version).beta !== null
}

function hasEntries(body: string): boolean {
  return body.split('\n').some((l) => /^\s*[-*]\s+\S/.test(l))
}

/**
 * Move o conteúdo de "[Não lançado]" para "## [versão] - data" e deixa "[Não lançado]" vazio.
 * Lança erro (pt-BR) se a seção não existir, estiver vazia ou a versão já tiver seção.
 * `date` em AAAA-MM-DD.
 */
export function releaseChangelog(changelog: string, version: string, date: string): string {
  const lines = changelogLines(changelog)
  if (sectionRange(lines, version)) {
    throw new Error(`O CHANGELOG já tem a seção [${version}].`)
  }
  const range = sectionRange(lines, UNRELEASED)
  if (!range) throw new Error(`O CHANGELOG não tem a seção "## [${UNRELEASED}]".`)
  const body = lines
    .slice(range.start + 1, range.end)
    .join('\n')
    .trim()
  if (!hasEntries(body)) {
    throw new Error(`A seção [${UNRELEASED}] do CHANGELOG está vazia: descreva as mudanças antes.`)
  }
  const next = [
    ...lines.slice(0, range.start),
    `## [${UNRELEASED}]`,
    '',
    `## [${version}] - ${date}`,
    '',
    body,
    '',
    ...lines.slice(range.end)
  ]
  return next.join('\n').replace(/\n{3,}/g, '\n\n')
}

export function parseReleaseArgs(argv: readonly string[]): { kind: BumpKind; beta: boolean } {
  const args = argv.filter((a) => a !== '--')
  const beta = args.includes('--beta')
  const kinds = args.filter((a) => !a.startsWith('--'))
  const unknown = args.filter((a) => a.startsWith('--') && a !== '--beta')
  if (unknown.length > 0) throw new Error(`Opção desconhecida: ${unknown.join(', ')}`)
  const kind = kinds[0]
  if (kinds.length !== 1 || !isBumpKind(kind)) {
    throw new Error('Uso: pnpm release <patch|minor|major|beta> [--beta]')
  }
  return { kind, beta }
}

export const RELEASE_LABEL_PREFIX = 'release:'
/** Rótulo que impede o release de uma PR (docs, CI, ajustes que não vão para o app). */
export const NO_RELEASE_LABEL = 'release:none'
/** Tipo usado quando a PR não tem rótulo `release:*`: todo merge na main vira versão. */
export const DEFAULT_RELEASE_KIND: BumpKind = 'patch'

/**
 * Rótulos de uma PR → tipo de release (`release:patch|minor|major|beta`).
 * Sem rótulo de release: `DEFAULT_RELEASE_KIND` (patch). `release:none`: `null` (não lança).
 * Mais de um tipo, um desconhecido, ou `release:none` junto de um tipo: erro.
 */
export function releaseKindFromLabels(labels: readonly string[]): BumpKind | null {
  const none = labels.includes(NO_RELEASE_LABEL)
  const kinds = [
    ...new Set(
      labels
        .filter((l) => l.startsWith(RELEASE_LABEL_PREFIX) && l !== NO_RELEASE_LABEL)
        .map((l) => l.slice(RELEASE_LABEL_PREFIX.length))
    )
  ]
  if (none && kinds.length > 0) {
    throw new Error(
      `A PR tem ${NO_RELEASE_LABEL} e ${kinds.map((k) => RELEASE_LABEL_PREFIX + k).join(', ')} ao mesmo tempo. Deixe só um.`
    )
  }
  if (none) return null
  if (kinds.length === 0) return DEFAULT_RELEASE_KIND
  if (kinds.length > 1) {
    throw new Error(
      `A PR tem mais de um rótulo de release (${kinds.map((k) => RELEASE_LABEL_PREFIX + k).join(', ')}). Deixe só um.`
    )
  }
  const kind = kinds[0]
  if (!isBumpKind(kind)) {
    throw new Error(
      `Rótulo desconhecido: ${RELEASE_LABEL_PREFIX}${kind}. Use ${BUMP_KINDS.map((k) => RELEASE_LABEL_PREFIX + k).join(', ')} ou ${NO_RELEASE_LABEL}.`
    )
  }
  return kind
}

/**
 * "[Não lançado]" vazio + nota (título da PR) → a nota vira o item da seção, em "### Mudado".
 * Com itens, ou sem nota, devolve o CHANGELOG como está. Assim um merge sem CHANGELOG escrito
 * ainda lança uma versão com uma linha que diz o que entrou.
 */
export function fillUnreleased(changelog: string, note: string | undefined | null): string {
  const text = (note ?? '').replace(/\s+/g, ' ').trim()
  if (text === '') return changelog
  const lines = changelogLines(changelog)
  const range = sectionRange(lines, UNRELEASED)
  if (!range) return changelog
  const body = lines.slice(range.start + 1, range.end).join('\n')
  if (hasEntries(body)) return changelog
  const item = /[.!?]$/.test(text) ? text : `${text}.`
  const next = [
    ...lines.slice(0, range.start),
    `## [${UNRELEASED}]`,
    '',
    '### Mudado',
    '',
    `- ${item}`,
    '',
    ...lines.slice(range.end)
  ]
  return next.join('\n').replace(/\n{3,}/g, '\n\n')
}

export type ReleasePlan =
  { release: false } | { release: true; kind: BumpKind; version: string; prerelease: boolean }

/**
 * O que a PR pede: `release:none` → `{ release: false }`; senão o tipo (patch por padrão), a versão
 * que vai sair e a conferência do CHANGELOG (com `note` preenchendo um "[Não lançado]" vazio).
 * Erro em pt-BR se não houver o que lançar. Não escreve nada.
 */
export function planRelease({
  labels,
  currentVersion,
  changelog,
  today,
  note
}: {
  labels: readonly string[]
  currentVersion: string
  changelog: string
  today: string
  note?: string | null | undefined
}): ReleasePlan {
  const kind = releaseKindFromLabels(labels)
  if (kind === null) return { release: false }
  const version = nextVersion(currentVersion, kind)
  releaseChangelog(fillUnreleased(changelog, note), version, today)
  return { release: true, kind, version, prerelease: isPrerelease(version) }
}
