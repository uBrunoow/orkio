import Link from 'next/link'
import type { Dictionary } from '@/i18n/pt-BR'
import { Logo } from './Logo'
import styles from './chrome.module.css'

export function Footer({ t }: { t: Dictionary }) {
  return (
    <footer className={styles.footer}>
      <div className={`container ${styles.footerInner}`}>
        <div className={styles.footerBrand}>
          <Logo />
          <p className={styles.footerTag}>{t.footer.tagline}</p>
        </div>
        <ul className={styles.footerLinks}>
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
