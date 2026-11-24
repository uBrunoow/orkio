import Link from 'next/link'
import type { Dictionary } from '@/i18n/pt-BR'
import { formatStars, type RepoInfo } from '@/lib/github-repo'
import { GitHubMark } from './Icons'
import { Logo } from './Logo'
import styles from './chrome.module.css'

export function Header({
  t,
  home = true,
  repo = null
}: {
  t: Dictionary
  home?: boolean
  repo?: RepoInfo | null
}) {
  const href = (hash: string) => (home ? hash : `/${hash}`)
  return (
    <header className={styles.header}>
      <div className={`container ${styles.headerInner}`}>
        <Link href="/" className={styles.brandLink} aria-label="Orkio — início">
          <Logo />
        </Link>
        <nav aria-label={t.nav.label}>
          <ul className={styles.nav}>
            <li className={styles.navText}>
              <a href={href('#como-funciona')}>{t.nav.how}</a>
            </li>
            <li className={styles.navText}>
              <a href={href('#recursos')}>{t.nav.automations}</a>
            </li>
            <li className={styles.navText}>
              <a href={href('#seguranca')}>{t.nav.safety}</a>
            </li>
            <li className={styles.navText}>
              <a href={href('#perguntas')}>{t.nav.faq}</a>
            </li>
            {repo && (
              <li>
                <a
                  href={repo.url}
                  className={styles.navGithub}
                  aria-label={
                    repo.stars !== null
                      ? `${t.nav.githubLabel}, ${formatStars(repo.stars)} ${t.nav.stars}`
                      : t.nav.githubLabel
                  }
                >
                  <GitHubMark />
                  <span className={styles.navGithubText}>{t.nav.github}</span>
                  {repo.stars !== null && (
                    <span className={styles.stars}>{formatStars(repo.stars)}</span>
                  )}
                </a>
              </li>
            )}
            <li>
              <a href={href('#download')} className={styles.navCta}>
                {t.nav.download}
              </a>
            </li>
          </ul>
        </nav>
      </div>
    </header>
  )
}
