import { Download } from '@/components/Download'
import { Footer } from '@/components/Footer'
import { Header } from '@/components/Header'
import { Symbol } from '@/components/Logo'
import { BoardMockup, GateMockup } from '@/components/Mockups'
import { getDictionary } from '@/i18n'
import { getLatestRelease, releasesPageUrl, releasesRepo } from '@/lib/releases'
import styles from './home.module.css'

// O último release é relido a cada 15 min (ISR; igual a RELEASE_REVALIDATE_SECONDS).
export const revalidate = 900

export default async function Home() {
  const t = getDictionary()
  const repo = releasesRepo()
  const release = await getLatestRelease(repo)
  const releasesUrl = repo ? releasesPageUrl(repo) : null

  return (
    <>
      <a className="skip" href="#conteudo">
        {t.skip}
      </a>
      <Header t={t} />
      <main id="conteudo">
        <section className={styles.hero} aria-labelledby="hero-title">
          <div className={`container ${styles.heroInner}`}>
            <Symbol size={112} className={styles.heroSymbol} animated />
            <p className={styles.slogan}>{t.hero.slogan}</p>
            <h1 id="hero-title" className={styles.heroTitle}>
              {t.hero.title}
            </h1>
            <p className={styles.lead}>{t.hero.lead}</p>
            <div className={styles.heroActions}>
              <Download t={t} release={release} releasesUrl={releasesUrl} variant="hero" />
              <a className={styles.secondary} href="#como-funciona">
                {t.hero.secondary}
              </a>
            </div>
            <p className={styles.note}>{t.hero.note}</p>
          </div>
          <div className="container">
            <BoardMockup t={t} />
          </div>
        </section>

        <section id="como-funciona" className={styles.section} aria-labelledby="how-title">
          <div className="container">
            <h2 id="how-title" className={styles.h2}>
              {t.how.title}
            </h2>
            <p className={styles.sectionLead}>{t.how.lead}</p>
            <ol className={styles.steps}>
              {t.how.steps.map((s, i) => (
                <li key={s.name} className={styles.step}>
                  <span className={styles.stepNum} aria-hidden="true">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <h3 className={styles.stepName}>{s.name}</h3>
                  <p>{s.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="automacoes" className={styles.section} aria-labelledby="auto-title">
          <div className={`container ${styles.split}`}>
            <div>
              <h2 id="auto-title" className={styles.h2}>
                {t.automations.title}
              </h2>
              <p className={styles.sectionLead}>{t.automations.lead}</p>
              <h3 className={styles.h3}>{t.automations.flowsTitle}</h3>
              <p className={styles.muted}>{t.automations.flows}</p>
            </div>
            <ul className={styles.rules} aria-label={t.automations.title}>
              {t.automations.rules.map((r) => (
                <li key={r.when} className={styles.rule}>
                  <span>
                    <span className={styles.ruleWord}>Quando</span> {r.when}
                  </span>
                  <span className={styles.ruleArrow} aria-hidden="true">
                    →
                  </span>
                  <span className={styles.ruleTo}>{r.then}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="seguranca" className={styles.section} aria-labelledby="safety-title">
          <div className={`container ${styles.split}`}>
            <div>
              <h2 id="safety-title" className={styles.h2}>
                {t.safety.title}
              </h2>
              <p className={styles.sectionLead}>{t.safety.lead}</p>
              <ul className={styles.points}>
                {t.safety.points.map((p) => (
                  <li key={p.title}>
                    <h3 className={styles.h3}>{p.title}</h3>
                    <p className={styles.muted}>{p.text}</p>
                  </li>
                ))}
              </ul>
            </div>
            <GateMockup t={t} />
          </div>
        </section>

        <section className={styles.section} aria-labelledby="int-title">
          <div className="container">
            <h2 id="int-title" className={styles.h2}>
              {t.integrations.title}
            </h2>
            <ul className={styles.cards}>
              {t.integrations.items.map((i) => (
                <li key={i.name} className={styles.card}>
                  <h3 className={styles.h3}>{i.name}</h3>
                  <p className={styles.muted}>{i.text}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="download" className={styles.section} aria-labelledby="dl-title">
          <div className={`container ${styles.downloadSection}`}>
            <Symbol size={64} className={styles.heroSymbol} />
            <h2 id="dl-title" className={styles.h2}>
              {t.download.title}
            </h2>
            <p className={styles.sectionLead}>{t.download.lead}</p>
            <Download t={t} release={release} releasesUrl={releasesUrl} />
          </div>
        </section>

        <section id="perguntas" className={styles.section} aria-labelledby="faq-title">
          <div className={`container ${styles.faqWrap}`}>
            <h2 id="faq-title" className={styles.h2}>
              {t.faq.title}
            </h2>
            <div className={styles.faq}>
              {t.faq.items.map((f) => (
                <details key={f.q} className={styles.faqItem}>
                  <summary>{f.q}</summary>
                  <p className={styles.muted}>{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>
      </main>
      <Footer t={t} />
    </>
  )
}
