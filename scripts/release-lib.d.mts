// Tipos de scripts/release-lib.mjs (para os testes em TypeScript).
export declare const UNRELEASED: string
export declare const BUMP_KINDS: readonly string[]
export type BumpKind = 'patch' | 'minor' | 'major' | 'beta'
export declare function parseVersion(version: string): {
  major: number
  minor: number
  patch: number
  beta: number | null
}
export declare function nextVersion(
  current: string,
  kind: BumpKind,
  options?: { beta?: boolean }
): string
export declare function isPrerelease(version: string): boolean
export declare function releaseDate(now: Date): string
export declare function extractNotes(changelog: string, version: string): string | null
export declare function releaseChangelog(changelog: string, version: string, date: string): string
export declare function parseReleaseArgs(argv: string[]): { kind: BumpKind; beta: boolean }
export declare const RELEASE_LABEL_PREFIX: string
export declare const NO_RELEASE_LABEL: string
export declare const DEFAULT_RELEASE_KIND: BumpKind
export declare function fillUnreleased(changelog: string, note: string | undefined | null): string
export declare function releaseKindFromLabels(labels: readonly string[]): BumpKind | null
export type ReleasePlan =
  { release: false } | { release: true; kind: BumpKind; version: string; prerelease: boolean }
export declare function planRelease(input: {
  labels: readonly string[]
  currentVersion: string
  changelog: string
  today: string
  note?: string | null
}): ReleasePlan
