/**
 * Lógica pura do `pnpm release` (Etapa 6B): próxima versão e CHANGELOG.
 * Testada em test/release.test.ts. Sem acesso a disco ou git (isso fica em release.mjs).
 *
 * CHANGELOG no formato Keep a Changelog, em pt-BR:
 *   ## [Não lançado]
 *   ## [X.Y.Z] - AAAA-MM-DD
 * O formato e o leitor das seções ficam em src/shared/changelog.mts (o mesmo do "O que há de novo"
 * do app); o Node roda o .mts direto (só tipos para tirar).
 */
import {
  CHANGELOG_UNRELEASED,
  changelogLines,
  changelogNotes,
  changelogSectionRange as sectionRange
} from '../src/shared/changelog.mts'

export const UNRELEASED = CHANGELOG_UNRELEASED
export const BUMP_KINDS = ['patch', 'minor', 'major', 'beta']

const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-beta\.(\d+))?$/

/** @param {string} version */
export function parseVersion(version) {
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
 * @param {string} current
 * @param {'patch'|'minor'|'major'|'beta'} kind
 * @param {{ beta?: boolean }} [options]
 */
export function nextVersion(current, kind, options = {}) {
  if (!BUMP_KINDS.includes(kind)) {
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

/**
 * @param {{ major: number, minor: number, patch: number, beta: number | null }} v
 * @param {'patch'|'minor'|'major'} kind
 */
function nextStable(v, kind) {
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
 * @param {Date} now
 */
export function releaseDate(now) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/** @param {string} version */
export function isPrerelease(version) {
  return parseVersion(version).beta !== null
}

/** Conteúdo (sem o título) da seção da versão, aparado. `null` se não existir. */
export function extractNotes(changelog, version) {
  return changelogNotes(changelog, version)
}

function hasEntries(body) {
  return body.split('\n').some((l) => /^\s*[-*]\s+\S/.test(l))
}

/**
 * Move o conteúdo de "[Não lançado]" para "## [versão] - data" e deixa "[Não lançado]" vazio.
 * Lança erro (pt-BR) se a seção não existir, estiver vazia ou a versão já tiver seção.
 * @param {string} changelog
 * @param {string} version
 * @param {string} date AAAA-MM-DD
 */
export function releaseChangelog(changelog, version, date) {
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

/**
 * @param {string[]} argv
 */
export function parseReleaseArgs(argv) {
  const args = argv.filter((a) => a !== '--')
  const beta = args.includes('--beta')
  const kinds = args.filter((a) => !a.startsWith('--'))
  const unknown = args.filter((a) => a.startsWith('--') && a !== '--beta')
  if (unknown.length > 0) throw new Error(`Opção desconhecida: ${unknown.join(', ')}`)
  if (kinds.length !== 1 || !BUMP_KINDS.includes(kinds[0])) {
    throw new Error('Uso: pnpm release <patch|minor|major|beta> [--beta]')
  }
  return { kind: /** @type {'patch'|'minor'|'major'|'beta'} */ (kinds[0]), beta }
}

export const RELEASE_LABEL_PREFIX = 'release:'
/** Rótulo que impede o release de uma PR (docs, CI, ajustes que não vão para o app). */
export const NO_RELEASE_LABEL = 'release:none'
/** Tipo usado quando a PR não tem rótulo `release:*`: todo merge na main vira versão. */
export const DEFAULT_RELEASE_KIND = 'patch'

/**
 * Rótulos de uma PR → tipo de release (`release:patch|minor|major|beta`).
 * Sem rótulo de release: `DEFAULT_RELEASE_KIND` (patch). `release:none`: `null` (não lança).
 * Mais de um tipo, um desconhecido, ou `release:none` junto de um tipo: erro.
 * @param {readonly string[]} labels
 * @returns {'patch'|'minor'|'major'|'beta' | null}
 */
export function releaseKindFromLabels(labels) {
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
  if (kinds.length === 0) return /** @type {'patch'} */ (DEFAULT_RELEASE_KIND)
  if (kinds.length > 1) {
    throw new Error(
      `A PR tem mais de um rótulo de release (${kinds.map((k) => RELEASE_LABEL_PREFIX + k).join(', ')}). Deixe só um.`
    )
  }
  const kind = kinds[0]
  if (!BUMP_KINDS.includes(kind)) {
    throw new Error(
      `Rótulo desconhecido: ${RELEASE_LABEL_PREFIX}${kind}. Use ${BUMP_KINDS.map((k) => RELEASE_LABEL_PREFIX + k).join(', ')} ou ${NO_RELEASE_LABEL}.`
    )
  }
  return /** @type {'patch'|'minor'|'major'|'beta'} */ (kind)
}

/**
 * "[Não lançado]" vazio + nota (título da PR) → a nota vira o item da seção, em "### Mudado".
 * Com itens, ou sem nota, devolve o CHANGELOG como está. Assim um merge sem CHANGELOG escrito
 * ainda lança uma versão com uma linha que diz o que entrou.
 * @param {string} changelog
 * @param {string | undefined | null} note
 */
export function fillUnreleased(changelog, note) {
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

/**
 * O que a PR pede: `release:none` → `{ release: false }`; senão o tipo (patch por padrão), a versão
 * que vai sair e a conferência do CHANGELOG (com `note` preenchendo um "[Não lançado]" vazio).
 * Erro em pt-BR se não houver o que lançar. Não escreve nada.
 * @param {{ labels: readonly string[], currentVersion: string, changelog: string, today: string, note?: string | null }} input
 */
export function planRelease({ labels, currentVersion, changelog, today, note }) {
  const kind = releaseKindFromLabels(labels)
  if (kind === null) return { release: false }
  const version = nextVersion(currentVersion, kind)
  releaseChangelog(fillUnreleased(changelog, note), version, today)
  return { release: true, kind, version, prerelease: isPrerelease(version) }
}
