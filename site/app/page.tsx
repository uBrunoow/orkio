import { AppPreview } from '@/components/AppPreview'
import { AgentsCrop, ComposerCrop, FlowCrop, ReviewCrop } from '@/components/Crops'
import { DownloadButton, DownloadCards } from '@/components/Download'
import { Footer } from '@/components/Footer'
import { Header } from '@/components/Header'
import { ArrowIcon, BlockIcon, CheckIcon, GitHubMark } from '@/components/Icons'
import { Symbol } from '@/components/Logo'
import { getDictionary } from '@/i18n'
import { getRepoInfo } from '@/lib/github-repo'
import { getLatestRelease, releasesPageUrl, releasesRepo } from '@/lib/releases'
import styles from './home.module.css'

// Release e repositório relidos a cada 15 min (ISR; igual a RELEASE_REVALIDATE_SECONDS).
export const revalidate = 900

const CROPS = {
  agentes: AgentsCrop,
  fluxos: FlowCrop,
  revisao: ReviewCrop,
  sessao: ComposerCrop
} as const

export default async function Home() {
  const t = getDictionary()
  const repoName = releasesRepo()
  const [release, repo] = await Promise.all([getLatestRelease(repoName), getRepoInfo(repoName)])
  const releasesUrl = repoName ? releasesPageUrl(repoName) : null

  return (
    <>
      <a className="skip" href="#conteudo">
        {t.skip}
      </a>
      <Header t={t} repo={repo} />
      <main id="conteudo">
        <section className={styles.hero} aria-labelledby="hero-title">
          <div className={`container ${styles.heroText}`}>
            <h1 id="hero-title" className={styles.heroTitle}>
              {t.hero.title}
            </h1>
            <div className={styles.heroSide}>
              <p className={styles.lead}>{t.hero.lead}</p>
              <div className={styles.heroActions}>
                <DownloadButton d={t.download} release={release} showVersion={false} />
                {repo && (
                  <a className={styles.ghost} href={repo.url}>
                    <GitHubMark />
                    {t.hero.github}
                  </a>
                )}
              </div>
              <p className={styles.note}>
                {release ? `${t.download.version} ${release.version}. ` : ''}
                {t.hero.note}
              </p>
            </div>
          </div>
          <div className={`container ${styles.previewContainer}`}>
            <AppPreview p={t.preview} />
          </div>
        </section>

        <section id="como-funciona" className={styles.section} aria-labelledby="how-title">
          <div className="container">
            <div className={styles.head}>
              <h2 id="how-title" className={styles.h2}>
                {t.how.title}
              </h2>
              <p className={styles.sectionLead}>{t.how.lead}</p>
            </div>
            <ol className={styles.rail}>
              {t.how.steps.map((step) => (
                <li key={step.name} className={styles.stop}>
                  <span className={styles.stopDot} aria-hidden="true" />
                  <h3 className={styles.stopName}>{step.name}</h3>
                  <p className={styles.muted}>{step.text}</p>
                </li>
              ))}
            </ol>
            <div className={styles.rules}>
              <h3 className={styles.h3}>{t.how.rulesTitle}</h3>
              <ul className={styles.ruleList}>
                {t.how.rules.map((r) => (
                  <li key={r.when} className={styles.rule}>
                    <span className={styles.ruleWhen}>Quando: {r.when}</span>
                    <ArrowIcon className={styles.ruleArrow} />
                    <span className={styles.ruleThen}>{r.then}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section id="recursos" className={styles.section} aria-labelledby="features-title">
          <div className="container">
            <h2 id="features-title" className={`${styles.h2} ${styles.headAlone}`}>
              {t.features.title}
            </h2>
            <div className={styles.features}>
              {t.features.items.map((f, i) => {
                const Crop = CROPS[f.id as keyof typeof CROPS]
                return (
                  <article
                    key={f.id}
                    className={styles.feature}
                    data-flip={i % 2 === 1 || undefined}
                    aria-labelledby={`feature-${f.id}`}
                  >
                    <div className={styles.featureText}>
                      <h3 id={`feature-${f.id}`} className={styles.featureTitle}>
                        {f.title}
                      </h3>
                      <p className={styles.muted}>{f.text}</p>
                      <ul className={styles.points}>
                        {f.points.map((pt) => (
                          <li key={pt}>
                            <CheckIcon className={styles.pointIcon} />
                            {pt}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <Crop t={t} />
                  </article>
                )
              })}
            </div>
          </div>
        </section>

        <section id="seguranca" className={styles.section} aria-labelledby="safety-title">
          <div className={`container ${styles.safety}`}>
            <div>
              <h2 id="safety-title" className={styles.h2}>
                {t.safety.title}
              </h2>
              <p className={styles.sectionLead}>{t.safety.lead}</p>
              <figure className={styles.blocked}>
                <figcaption className={styles.blockedTitle}>{t.safety.blockedTitle}</figcaption>
                <ul>
                  {t.safety.blocked.map((cmd) => (
                    <li key={cmd}>
                      <BlockIcon className={styles.blockedIcon} />
                      <code>{cmd}</code>
                    </li>
                  ))}
                </ul>
              </figure>
            </div>
            <dl className={styles.safetyList}>
              {t.safety.points.map((pt) => (
                <div key={pt.title}>
                  <dt className={styles.h3}>{pt.title}</dt>
                  <dd className={styles.muted}>{pt.text}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section className={styles.section} aria-labelledby="tools-title">
          <div className="container">
            <div className={styles.head}>
              <h2 id="tools-title" className={styles.h2}>
                {t.tools.title}
              </h2>
              <p className={styles.sectionLead}>{t.tools.lead}</p>
            </div>
            <dl className={styles.tools}>
              {t.tools.items.map((tool) => (
                <div key={tool.name}>
                  <dt className={styles.toolName}>{tool.name}</dt>
                  <dd className={styles.muted}>{tool.text}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section id="download" className={styles.section} aria-labelledby="dl-title">
          <div className="container">
            <div className={styles.head}>
              <h2 id="dl-title" className={styles.h2}>
                {t.download.title}
              </h2>
              <p className={styles.sectionLead}>{t.download.lead}</p>
            </div>
            <DownloadCards d={t.download} release={release} releasesUrl={releasesUrl} />
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

        <section className={styles.close} aria-labelledby="close-title">
          <div className={`container ${styles.closeInner}`}>
            <Symbol size={88} className={styles.closeSymbol} animated />
            <h2 id="close-title" className={styles.closeTitle}>
              {t.close.title}
            </h2>
            <p className={styles.sectionLead}>{t.close.lead}</p>
            <DownloadButton d={t.download} release={release} className={styles.closeButton} />
          </div>
        </section>
      </main>
      <Footer t={t} repo={repo} releasesUrl={releasesUrl} />
    </>
  )
}
