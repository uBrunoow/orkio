'use client'

import { useEffect, useState } from 'react'
import type { Dictionary } from '@/i18n/pt-BR'

type DownloadCopy = Dictionary['download']
import {
  detectPlatform,
  suggestDownload,
  type ClientPlatform,
  type DownloadFile,
  type DownloadKind,
  type LatestRelease
} from '@/lib/releases'
import { DownloadIcon } from './Icons'
import styles from './download.module.css'

type UAData = {
  platform?: string
  getHighEntropyValues?: (hints: string[]) => Promise<{ architecture?: string }>
}

/** Sistema deste computador (só no navegador; `null` antes de detectar ou sem JavaScript). */
function usePlatform(): ClientPlatform | null {
  const [platform, setPlatform] = useState<ClientPlatform | null>(null)
  useEffect(() => {
    const nav = navigator as Navigator & { userAgentData?: UAData }
    const ua = nav.userAgentData
    const base = {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      uaDataPlatform: ua?.platform
    }
    let active = true
    // Arquitetura só nos navegadores Chromium (Client Hints); nos outros fica desconhecida.
    const run = async (): Promise<void> => {
      let architecture: string | undefined
      try {
        architecture = (await ua?.getHighEntropyValues?.(['architecture']))?.architecture
      } catch {
        architecture = undefined
      }
      if (active) setPlatform(detectPlatform({ ...base, architecture }))
    }
    void run()
    return () => {
      active = false
    }
  }, [])
  return platform
}

function megabytes(bytes: number): string | null {
  return bytes > 0 ? `${Math.round(bytes / 1024 / 1024)} MB` : null
}

function publishedDate(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' })
}

export function DownloadButton({
  d,
  release,
  className,
  showVersion = true
}: {
  d: DownloadCopy
  release: LatestRelease | null
  className?: string | undefined
  showVersion?: boolean
}) {
  const platform = usePlatform()
  const suggested = platform && release ? suggestDownload(platform, release.files) : null
  return (
    <div className={`${styles.button} ${className ?? ''}`}>
      {suggested ? (
        <a className={styles.primary} href={suggested.url} data-testid="download-suggested">
          <DownloadIcon />
          {d.suggested} {d.labels[suggested.kind]}
        </a>
      ) : (
        <a className={styles.primary} href="#download">
          <DownloadIcon />
          {d.hero}
        </a>
      )}
      {release && showVersion && (
        <p className={styles.version}>
          {d.version} {release.version}
        </p>
      )}
    </div>
  )
}

const SYSTEMS: { id: 'mac' | 'windows' | 'linux'; kinds: DownloadKind[] }[] = [
  { id: 'mac', kinds: ['mac-arm64', 'mac-x64'] },
  { id: 'windows', kinds: ['windows'] },
  { id: 'linux', kinds: ['linux-appimage', 'linux-deb'] }
]

export function DownloadCards({
  d,
  release,
  releasesUrl
}: {
  d: DownloadCopy
  release: LatestRelease | null
  releasesUrl: string | null
}) {
  const platform = usePlatform()
  const files = release?.files ?? {}
  const suggested = platform && release ? suggestDownload(platform, files) : null
  const any = SYSTEMS.some((sys) => sys.kinds.some((k) => files[k]))

  if (!release || !any) {
    return (
      <div className={styles.empty}>
        <p>{releasesUrl ? d.unavailable : d.soon}</p>
        {releasesUrl && (
          <a className={styles.primary} href={releasesUrl}>
            {d.all}
          </a>
        )}
      </div>
    )
  }

  const date = publishedDate(release.publishedAt)
  return (
    <div className={styles.cardsWrap}>
      <ul className={styles.cards} aria-label={d.others}>
        {SYSTEMS.map((sys) => {
          const copy = d.systems[sys.id]
          const list = sys.kinds.map((k) => files[k]).filter((f): f is DownloadFile => !!f)
          const mine = !!suggested && sys.kinds.includes(suggested.kind)
          return (
            <li key={sys.id} className={styles.card} data-mine={mine || undefined} data-glow="fill">
              <div className={styles.cardHead}>
                <h3 className={styles.system}>{copy.name}</h3>
                {mine && <span className={styles.mine}>{d.forYou}</span>}
              </div>
              {list.length === 0 ? (
                <p className={styles.note}>{sys.id === 'linux' ? d.linux : ''}</p>
              ) : (
                <ul className={styles.files}>
                  {list.map((f) => {
                    const size = megabytes(f.size)
                    const primary = mine && f === suggested
                    return (
                      <li key={f.kind}>
                        <a
                          className={styles.file}
                          data-primary={primary || undefined}
                          href={f.url}
                          aria-label={`${d.suggested} ${d.labels[f.kind]}${size ? `, ${size}` : ''}`}
                        >
                          <span className={styles.fileName}>
                            {(copy.files as Record<string, string>)[f.kind]}
                          </span>
                          <span className={styles.fileMeta}>
                            {f.name}
                            {size && <span className={styles.size}>{size}</span>}
                          </span>
                          <DownloadIcon className={styles.fileIcon} />
                        </a>
                      </li>
                    )
                  })}
                </ul>
              )}
              <p className={styles.note}>{copy.note}</p>
            </li>
          )
        })}
      </ul>
      <p className={styles.release}>
        {d.version} {release.version}
        {date ? `, ${d.published} ${date}.` : '.'} <a href={release.url}>{d.all}</a>
      </p>
    </div>
  )
}
