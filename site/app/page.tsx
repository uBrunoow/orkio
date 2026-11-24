import { Ambient } from '@/components/Ambient'
import { AppPreview } from '@/components/AppPreview'
import { AgentsCrop, ComposerCrop, FlowCrop, ReviewCrop } from '@/components/Crops'
import { DownloadButton, DownloadCards } from '@/components/Download'
import { Footer } from '@/components/Footer'
import { HeroField } from '@/components/HeroField'
import { Header } from '@/components/Header'
import { BlockIcon, CheckIcon, GitHubMark, ShieldIcon } from '@/components/Icons'
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
          <div className={styles.heroGlow} data-depth="-16" aria-hidden="true" />
          <HeroField />
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
          <div className={styles.stage}>
            <div className={styles.horizon} data-depth="-8" aria-hidden="true" />
            <div className={`container ${styles.previewContainer}`} data-depth="6">
              <AppPreview p={t.preview} />
            </div>
          </div>
        </section>

        <section id="como-funciona" className={styles.section} aria-labelledby="how-title">
          <div className="container">
            <div className={styles.head} data-reveal>
              <h2 id="how-title" className={styles.h2}>
                {t.how.title}
              </h2>
              <p className={styles.sectionLead}>{t.how.lead}</p>
            </div>
            <div className={styles.railWrap} data-reveal>
              <div className={styles.packet} aria-hidden="true">
                <span className={styles.packetChip}>{t.preview.taskId}</span>
              </div>
              <ol className={styles.rail} data-glow>
                {t.how.steps.map((step) => (
                  <li key={step.name} className={styles.stop}>
                    <span className={styles.stopDot} aria-hidden="true" />
                    <h3 className={styles.stopName}>{step.name}</h3>
                    <code className={styles.stopArtifact}>{step.artifact}</code>
                    <p className={styles.stopText}>{step.text}</p>
                    <p className={styles.stopVia}>{step.via}</p>
                  </li>
                ))}
              </ol>
            </div>
            <div className={styles.rules} data-reveal>
              <h3 className={styles.rulesTitle}>{t.how.rulesTitle}</h3>
              <table className={styles.ruleTable}>
                <thead>
                  <tr>
                    <th scope="col">{t.how.rulesWhen}</th>
                    <th scope="col">{t.how.rulesThen}</th>
                  </tr>
                </thead>
                <tbody>
                  {t.how.rules.map((r) => (
                    <tr key={r.when}>
                      <td className={styles.ruleWhen}>
                        <code>{r.when}</code>
                      </td>
                      <td>
                        <span className={styles.ruleThen} data-tone={r.tone}>
                          {r.then}
                        </span>
                        {r.hint && <span className={styles.ruleHint}>{r.hint}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section id="recursos" className={styles.section} aria-labelledby="features-title">
          <div className="container">
            <h2 id="features-title" className={`${styles.h2} ${styles.headAlone}`} data-reveal>
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
                    <div className={styles.featureText} data-reveal>
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
                    <div className={styles.later} data-reveal>
                      <Crop t={t} />
                    </div>
                  </article>
                )
              })}
            </div>
          </div>
        </section>

        <section
          id="seguranca"
          className={`${styles.section} ${styles.band}`}
          aria-labelledby="safety-title"
        >
          <div className={`container ${styles.safety}`}>
            <div className={styles.safetyHead} data-reveal>
              <h2 id="safety-title" className={styles.h2}>
                {t.safety.title}
              </h2>
              <p className={styles.sectionLead}>{t.safety.lead}</p>
              <figure className={styles.terminal} data-glow="fill">
                <figcaption className={styles.terminalBar}>
                  <span className={styles.dots} aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </span>
                  {t.safety.blockedTitle}
                  <span className={styles.liveDot} aria-hidden="true" />
                </figcaption>
                <ul>
                  {t.safety.blocked.map((cmd) => (
                    <li key={cmd}>
                      <span className={styles.prompt} aria-hidden="true">
                        $
                      </span>
                      <code>{cmd}</code>
                      <span className={styles.blockedTag}>
                        <BlockIcon className={styles.blockedIcon} />
                        {t.safety.blockedTag}
                      </span>
                    </li>
                  ))}
                  <li className={styles.cursorLine} aria-hidden="true">
                    $
                  </li>
                </ul>
              </figure>
            </div>
            <dl className={styles.safetyList}>
              {t.safety.points.map((pt) => (
                <div key={pt.title} data-reveal>
                  <dt className={styles.h3}>
                    <ShieldIcon className={styles.pointShield} />
                    {pt.title}
                  </dt>
                  <dd className={styles.muted}>{pt.text}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section id="download" className={styles.section} aria-labelledby="dl-title">
          <div className="container">
            <div className={styles.head} data-reveal>
              <h2 id="dl-title" className={styles.h2}>
                {t.download.title}
              </h2>
              <p className={styles.sectionLead}>{t.download.lead}</p>
            </div>
            <div className={styles.later} data-reveal>
              <DownloadCards d={t.download} release={release} releasesUrl={releasesUrl} />
            </div>
          </div>
        </section>

        <section id="perguntas" className={styles.section} aria-labelledby="faq-title">
          <div className={`container ${styles.faqWrap}`}>
            <h2 id="faq-title" className={styles.h2} data-reveal>
              {t.faq.title}
            </h2>
            <div className={`${styles.faq} ${styles.later}`} data-reveal>
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
          <div className={`container ${styles.closeInner}`} data-reveal>
            <Symbol size={88} className={styles.closeSymbol} animated />
            <h2 id="close-title" className={styles.closeTitle}>
              {t.close.title}
            </h2>
            <p className={styles.sectionLead}>{t.close.lead}</p>
            <DownloadButton d={t.download} release={release} className={styles.closeButton} />
          </div>
        </section>
      </main>
      <Ambient />
      <Footer t={t} repo={repo} releasesUrl={releasesUrl} />
    </>
  )
}
