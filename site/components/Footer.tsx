import Link from 'next/link'
import type { Dictionary } from '@/i18n/pt-BR'
import type { RepoInfo } from '@/lib/github-repo'
import { Logo } from './Logo'
import styles from './chrome.module.css'

export function Footer({
  t,
  repo = null,
  releasesUrl = null
}: {
  t: Dictionary
  repo?: RepoInfo | null
  releasesUrl?: string | null
}) {
  return (
    <footer className={styles.footer}>
      <div className={`container ${styles.footerInner}`}>
        <div className={styles.footerBrand}>
          <Logo />
          <p className={styles.footerTag}>{t.footer.tagline}</p>
        </div>
        <ul className={styles.footerLinks}>
          {repo && (
            <li>
              <a href={repo.url}>{t.footer.github}</a>
            </li>
          )}
          {releasesUrl && (
            <li>
              <a href={releasesUrl}>{t.footer.releases}</a>
            </li>
          )}
          <li>
            <Link href="/privacidade">{t.footer.privacy}</Link>
          </li>
          <li>
            <Link href="/termos">{t.footer.terms}</Link>
          </li>
        </ul>
        <p className={styles.copy}>
          © {new Date().getFullYear()} {t.footer.rights}
        </p>
      </div>
    </footer>
  )
}
