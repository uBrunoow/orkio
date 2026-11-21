/**
 * Lógica pura do `pnpm release` (Etapa 6B): próxima versão e CHANGELOG.
 * Testada em test/release.test.ts. Sem acesso a disco ou git (isso fica em release.mjs).
 *
 * CHANGELOG no formato Keep a Changelog, em pt-BR:
 *   ## [Não lançado]
 *   ## [X.Y.Z] - AAAA-MM-DD
 * O auto-update (6C) e o release.yml leem as seções nesse formato.
 */

export const UNRELEASED = 'Não lançado'
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

/** @param {string} version */
export function isPrerelease(version) {
  return parseVersion(version).beta !== null
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Linhas de uma seção `## [titulo]` até a próxima `## `. `null` se não existir. */
function sectionRange(lines, title) {
  const head = new RegExp(`^## \\[${escape(title)}\\](\\s|$)`)
  const start = lines.findIndex((l) => head.test(l))
  if (start < 0) return null
  let end = lines.findIndex((l, i) => i > start && /^## /.test(l))
  if (end < 0) end = lines.length
  return { start, end }
}

/** Conteúdo (sem o título) da seção da versão, aparado. `null` se não existir. */
export function extractNotes(changelog, version) {
  const lines = changelog.replace(/\r\n/g, '\n').split('\n')
  const range = sectionRange(lines, version)
  if (!range) return null
  const body = lines
    .slice(range.start + 1, range.end)
    .join('\n')
    .trim()
  return body
}

/** A seção tem pelo menos um item de lista? (subtítulos vazios não contam) */
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
  const lines = changelog.replace(/\r\n/g, '\n').split('\n')
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
 * Argumentos do `pnpm release`: `<patch|minor|major|beta> [--beta]`.
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
