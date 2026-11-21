import Link from 'next/link'
import type { Dictionary } from '@/i18n/pt-BR'
import { Logo } from './Logo'
import styles from './chrome.module.css'

export function Header({ t, home = true }: { t: Dictionary; home?: boolean }) {
  const href = (hash: string) => (home ? hash : `/${hash}`)
  return (
    <header className={styles.header}>
      <div className={`container ${styles.headerInner}`}>
        <Link href="/" className={styles.brandLink} aria-label="Orkio — início">
          <Logo />
        </Link>
        <nav aria-label={t.nav.label}>
          <ul className={styles.nav}>
            <li>
              <a href={href('#como-funciona')}>{t.nav.how}</a>
            </li>
            <li>
              <a href={href('#automacoes')}>{t.nav.automations}</a>
            </li>
            <li>
              <a href={href('#seguranca')}>{t.nav.safety}</a>
            </li>
            <li>
              <a href={href('#perguntas')}>{t.nav.faq}</a>
            </li>
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
