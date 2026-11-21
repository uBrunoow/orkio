import Link from 'next/link'
import type { Dictionary } from '@/i18n/pt-BR'
import styles from './legal.module.css'
import { Footer } from './Footer'
import { Header } from './Header'

/** Contato das páginas legais (CONTACT_EMAIL na Vercel). Sem ele, um marcador visível. */
export function Contact({ t }: { t: Dictionary }) {
  const email = process.env['CONTACT_EMAIL']?.trim()
  return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? (
    <a href={`mailto:${email}`}>{email}</a>
  ) : (
    <strong>[{t.legal.contactMissing}]</strong>
  )
}

export function LegalPage({
  t,
  title,
  updated,
  children
}: {
  t: Dictionary
  title: string
  updated: string
  children: React.ReactNode
}) {
  return (
    <>
      <a className="skip" href="#conteudo">
        {t.skip}
      </a>
      <Header t={t} home={false} />
      <main id="conteudo" className={`container ${styles.legal}`}>
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.updated}>
          {t.legal.updated} {updated}
        </p>
        {children}
        <p>
          <Link href="/">{t.legal.back}</Link>
        </p>
      </main>
      <Footer t={t} />
    </>
  )
}
