/**
 * Dados públicos do repositório para o link "Ver no GitHub" (ISR, igual ao release). As estrelas
 * só aparecem a partir de `STARS_MIN`: um número pequeno diz menos que nenhum.
 */
import { GITHUB_API_VERSION } from './contract'

export const STARS_MIN = 25
/** Revalidação (segundos): 15 min, como o release. */
const REPO_REVALIDATE_SECONDS = 900

export interface RepoInfo {
  url: string
  stars: number | null
}

export function repoUrl(repo: string): string {
  return `https://github.com/${repo}`
}

export function formatStars(stars: number): string {
  return stars >= 1000
    ? `${(stars / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`
    : String(stars)
}

export async function getRepoInfo(
  repo: string | null,
  fetchImpl: typeof fetch = fetch
): Promise<RepoInfo | null> {
  if (!repo) return null
  const url = repoUrl(repo)
  try {
    const res = await fetchImpl(`https://api.github.com/repos/${repo}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': GITHUB_API_VERSION,
        'User-Agent': 'orkio-site'
      },
      next: { revalidate: REPO_REVALIDATE_SECONDS }
    } as RequestInit)
    if (!res.ok) return { url, stars: null }
    const data = (await res.json()) as { stargazers_count?: unknown; private?: unknown }
    if (data.private === true) return null
    const n = data.stargazers_count
    return { url, stars: typeof n === 'number' && n >= STARS_MIN ? n : null }
  } catch {
    return { url, stars: null }
  }
}
